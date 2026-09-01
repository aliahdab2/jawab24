/**
 * Admin Invoices service — issue, render, archive and send a manual invoice.
 *
 * The rail Stripe never touches. A merchant who pays by bank transfer, through
 * Sham Cash, or via a reseller is activated by `manualUpgrade`, which sends
 * nothing; this service produces the document that activation never had.
 *
 * Deliberately NOT wired into `manualUpgrade`. Issuing an invoice is a
 * bookkeeping act with its own number series and its own audit trail, and the
 * amount actually collected is frequently not the plan's list price (InMedia's
 * annual Pro was 790 USD). Coupling them would either invent a number for every
 * courtesy extension or force an admin to guess an amount at grant time.
 */

import { createHash } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
    invoices,
    invoiceDocuments,
    users,
    plans,
    subscriptions,
    partners,
    adminAuditLogs,
} from '../../db/schema';
import { config } from '../../config';
import { NotFoundError, ValidationError, ConflictError } from '../../utils/errors';
import { invoiceHtml, type InvoiceLang, type InvoiceSeller, type InvoiceView } from '../../utils/invoiceTemplate';
import { renderInvoicePdf } from '../invoicePdf';
import { adminUsersService } from './users';
import { brandLogoDataUri } from '../../utils/brandLogo';

export interface CreateInvoiceInput {
    lang: InvoiceLang;
    customerName: string;
    customerContact?: string | null;
    customerEmail?: string | null;
    customerAddress?: string | null;
    lineDescription: string;
    lineDetail?: string | null;
    quantityLabel: string;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    currency: string;
    subtotalCents: number;
    vatCents: number;
    planId?: string | null;
    paymentNote?: string | null;
}

/** The seller block, assembled from config once per render. */
function seller(): InvoiceSeller {
    const c = config.invoicing;
    return {
        displayName: c.displayName,
        legalName: c.legalName,
        legalForm: c.legalForm,
        registrationNumber: c.registrationNumber,
        addressLines: c.addressLines,
        contactEmail: c.contactEmail,
        website: c.website,
    };
}

function vatNoteFor(lang: InvoiceLang): string {
    return lang === 'ar' ? config.invoicing.vatNoteAr : config.invoicing.vatNoteEn;
}

/** `JW24-2026-7` → `JW24-2026-007`. Zero-padded so a printed series sorts and
 *  reads as a series rather than as unrelated numbers. */
export function formatInvoiceNumber(series: string, year: number, seq: number): string {
    return `${series}-${year}-${String(seq).padStart(3, '0')}`;
}

/**
 * Advisory-lock key for the (series, year) counter.
 *
 * `pg_advisory_xact_lock` takes a bigint; hashing the pair into one keeps the
 * lock scoped to the series being allocated, so two series (or two years) never
 * block each other. Released automatically at commit or rollback — there is no
 * unlock path to forget.
 */
function counterLockKey(series: string, year: number): string {
    return `${series}:${year}`;
}

class AdminInvoicesService {
    /**
     * Issue an invoice: allocate the next number, render the PDF, and archive
     * both — atomically.
     *
     * ## Why the render happens INSIDE the transaction
     *
     * It is the only way to make "a numbered invoice always has its document"
     * and "the series has no gaps" true at the same time. Allocating first and
     * rendering after would leave a numbered row with no PDF whenever Chromium
     * fails; rendering first is impossible because the number is printed ON the
     * document. So the transaction holds for the ~1s a render takes, serialized
     * per series by an advisory lock.
     *
     * That cost is affordable precisely here and would not be elsewhere:
     * invoices are issued a few times a month by one admin. A second admin
     * issuing concurrently waits a second. Nothing merchant-facing touches this
     * path — §17's latency budget governs replies, not bookkeeping.
     */
    async createInvoice(
        userId: string,
        input: CreateInvoiceInput,
        adminUserId: string | undefined,
    ): Promise<{ id: string; number: string; sha256: string; byteLength: number }> {
        const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
        if (!user) throw new NotFoundError('User not found');

        const totalCents = input.subtotalCents + input.vatCents;
        const series = config.invoicing.series;
        const issueDate = new Date();
        const year = issueDate.getUTCFullYear();

        return db.transaction(async (tx) => {
            // Serialize allocation for this (series, year). Everything below
            // runs under it, so the max+1 read cannot race another issuer.
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${counterLockKey(series, year)}, 0))`);

            const [last] = await tx
                .select({ seq: invoices.seq })
                .from(invoices)
                .where(and(eq(invoices.series, series), eq(invoices.year, year)))
                .orderBy(desc(invoices.seq))
                .limit(1);
            const seq = (last?.seq ?? 0) + 1;
            const number = formatInvoiceNumber(series, year, seq);

            const view: InvoiceView = {
                lang: input.lang,
                number,
                issueDate,
                seller: seller(),
                customerName: input.customerName,
                customerContact: input.customerContact,
                customerEmail: input.customerEmail,
                customerAddress: input.customerAddress,
                lineDescription: input.lineDescription,
                lineDetail: input.lineDetail,
                quantityLabel: input.quantityLabel,
                periodStart: input.periodStart,
                periodEnd: input.periodEnd,
                currency: input.currency,
                subtotalCents: input.subtotalCents,
                vatCents: input.vatCents,
                totalCents,
                vatNote: vatNoteFor(input.lang),
                logoDataUri: await brandLogoDataUri(),
                paymentNote: input.paymentNote,
            };

            const pdf = await renderInvoicePdf(invoiceHtml(view));
            const sha256 = createHash('sha256').update(pdf).digest('hex');

            const [row] = await tx.insert(invoices).values({
                number,
                series,
                year,
                seq,
                userId,
                customerName: input.customerName,
                customerEmail: input.customerEmail ?? null,
                customerContact: input.customerContact ?? null,
                customerAddress: input.customerAddress ?? null,
                lang: input.lang,
                currency: input.currency.toUpperCase(),
                planId: input.planId ?? null,
                lineDescription: input.lineDescription,
                lineDetail: input.lineDetail ?? null,
                periodStart: input.periodStart ?? null,
                periodEnd: input.periodEnd ?? null,
                subtotalCents: input.subtotalCents,
                vatCents: input.vatCents,
                totalCents,
                vatNote: vatNoteFor(input.lang),
                issueDate,
                status: 'issued',
                createdByAdminUserId: adminUserId,
            }).returning({ id: invoices.id });

            await tx.insert(invoiceDocuments).values({
                invoiceId: row.id,
                mimeType: 'application/pdf',
                byteLength: pdf.length,
                bytes: pdf,
                sha256,
            });

            await tx.insert(adminAuditLogs).values({
                adminUserId,
                targetUserId: userId,
                action: 'invoice_issued',
                newValue: {
                    invoiceId: row.id,
                    number,
                    lang: input.lang,
                    currency: input.currency.toUpperCase(),
                    subtotalCents: input.subtotalCents,
                    vatCents: input.vatCents,
                    totalCents,
                    sha256,
                },
            });

            return { id: row.id, number, sha256, byteLength: pdf.length };
        });
    }

    /** Render a document from unsaved input WITHOUT allocating a number.
     *  This is what makes a gapless series possible: an admin can look before
     *  committing, and an abandoned preview costs nothing. */
    async previewInvoice(input: CreateInvoiceInput): Promise<Buffer> {
        const view: InvoiceView = {
            lang: input.lang,
            number: formatInvoiceNumber(config.invoicing.series, new Date().getUTCFullYear(), 0)
                .replace(/-0+$/, '-•••'),
            issueDate: new Date(),
            preview: true,
            seller: seller(),
            customerName: input.customerName,
            customerContact: input.customerContact,
            customerEmail: input.customerEmail,
            customerAddress: input.customerAddress,
            lineDescription: input.lineDescription,
            lineDetail: input.lineDetail,
            quantityLabel: input.quantityLabel,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            currency: input.currency,
            subtotalCents: input.subtotalCents,
            vatCents: input.vatCents,
            totalCents: input.subtotalCents + input.vatCents,
            vatNote: vatNoteFor(input.lang),
            logoDataUri: await brandLogoDataUri(),
            paymentNote: input.paymentNote,
        };
        return renderInvoicePdf(invoiceHtml(view));
    }

    /** The archived bytes. Never re-rendered — see the invoice_documents
     *  table comment for why the obligation is "as sent", not "as regenerated". */
    async getDocument(invoiceId: string): Promise<{ bytes: Buffer; number: string; byteLength: number }> {
        const [row] = await db
            .select({
                bytes: invoiceDocuments.bytes,
                byteLength: invoiceDocuments.byteLength,
                number: invoices.number,
            })
            .from(invoiceDocuments)
            .innerJoin(invoices, eq(invoices.id, invoiceDocuments.invoiceId))
            .where(eq(invoiceDocuments.invoiceId, invoiceId))
            .limit(1);
        if (!row) throw new NotFoundError('Invoice document not found');
        return row;
    }

    async listForUser(userId: string) {
        // Never selects `bytes` — that is the entire reason the document lives
        // in its own table.
        return db
            .select({
                id: invoices.id,
                number: invoices.number,
                lang: invoices.lang,
                currency: invoices.currency,
                totalCents: invoices.totalCents,
                status: invoices.status,
                issueDate: invoices.issueDate,
                sentAt: invoices.sentAt,
                customerName: invoices.customerName,
            })
            .from(invoices)
            .where(eq(invoices.userId, userId))
            .orderBy(desc(invoices.issueDate));
    }

    /**
     * Email the invoice to the merchant, with the PDF attached.
     *
     * Delivery, attachment hashing, the `email_sends` row and the
     * `merchant_email_sent` audit entry are all the existing merchant-email
     * path's job — this method composes the message and stamps the result back
     * onto the invoice. Nothing about sending mail is reimplemented here.
     */
    async sendInvoice(
        invoiceId: string,
        input: { subject: string; body: string; cc?: string[]; bcc?: string[]; idempotencyKey?: string },
        adminUserId: string | undefined,
    ): Promise<{ emailSendId?: string; number: string }> {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
        if (!invoice) throw new NotFoundError('Invoice not found');
        if (invoice.status === 'void') {
            throw new ConflictError('This invoice is void and cannot be sent');
        }

        const doc = await this.getDocument(invoiceId);

        const result = await adminUsersService.sendMerchantEmail(
            invoice.userId,
            {
                subject: input.subject,
                body: input.body,
                cc: input.cc,
                bcc: input.bcc,
                attachments: [{
                    // Filename carries the number, so a mailbox search for the
                    // invoice number finds the attachment too.
                    filename: `${invoice.number}.pdf`,
                    content: doc.bytes.toString('base64'),
                }],
                idempotencyKey: input.idempotencyKey,
            },
            adminUserId,
        );

        await db.update(invoices)
            .set({
                status: 'sent',
                sentAt: new Date(),
                emailSendId: result.emailSendId ?? null,
                updatedAt: new Date(),
            })
            .where(eq(invoices.id, invoiceId));

        return { emailSendId: result.emailSendId, number: invoice.number };
    }

    /**
     * Void an invoice. The row and its number STAY — a gap in the series is an
     * audit finding, a voided invoice is a normal event. Nothing here deletes.
     */
    async voidInvoice(invoiceId: string, reason: string, adminUserId: string | undefined) {
        const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
        if (!invoice) throw new NotFoundError('Invoice not found');
        if (invoice.status === 'void') throw new ConflictError('Invoice is already void');
        if (!reason.trim()) throw new ValidationError('A reason is required to void an invoice');

        await db.transaction(async (tx) => {
            await tx.update(invoices)
                .set({ status: 'void', voidedAt: new Date(), voidReason: reason.trim(), updatedAt: new Date() })
                .where(eq(invoices.id, invoiceId));
            await tx.insert(adminAuditLogs).values({
                adminUserId,
                targetUserId: invoice.userId,
                action: 'invoice_voided',
                previousValue: { status: invoice.status, number: invoice.number },
                newValue: { status: 'void', number: invoice.number, reason: reason.trim() },
            });
        });

        return { number: invoice.number };
    }

    /**
     * Everything the composer needs to open pre-filled: the customer's details,
     * their current plan and period, and the reseller to copy.
     *
     * Prefill is a SUGGESTION, never a commitment — the admin edits all of it
     * before issuing. Which is the point: the amount actually collected is
     * routinely not the plan's list price.
     */
    async prefillForUser(userId: string) {
        const [row] = await db
            .select({
                userId: users.id,
                userName: users.name,
                userEmail: users.email,
                planId: plans.id,
                planName: plans.name,
                planPrice: plans.price,
                planReplies: plans.maxAiRepliesPerMonth,
                periodStart: subscriptions.currentPeriodStart,
                periodEnd: subscriptions.currentPeriodEnd,
                paymentMethod: subscriptions.paymentMethod,
                partnerEmail: partners.email,
                partnerName: partners.name,
            })
            .from(users)
            .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
            .leftJoin(plans, eq(plans.id, subscriptions.planId))
            .leftJoin(partners, eq(partners.id, users.partnerId))
            .where(eq(users.id, userId))
            .limit(1);
        if (!row) throw new NotFoundError('User not found');
        return row;
    }
}

export const adminInvoicesService = new AdminInvoicesService();
