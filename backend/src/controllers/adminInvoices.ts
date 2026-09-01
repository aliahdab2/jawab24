/**
 * Admin invoice endpoints — issue, preview, download, send, void, list.
 *
 * Its own controller rather than more methods on admin.ts: invoicing is a
 * distinct responsibility with its own service, and admin.ts is already the
 * catch-all it should stop being (AI_INSTRUCTIONS §10.9).
 *
 * Every route here is admin-only; that is enforced by the preHandler chain in
 * routes/admin.ts, not re-checked per handler, so there is exactly one place
 * that can get it wrong.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { adminInvoicesService } from '../services/admin/invoices';
import { CreateInvoiceSchema, SendInvoiceSchema, VoidInvoiceSchema } from '../utils/validation';
import { AppError } from '../utils/errors';
import type { AuthenticatedRequest } from '../middleware/auth';

/** One shape for every failure path here. `AppError`s carry a message written
 *  for a human operator and a status the client can act on; anything else is a
 *  bug and must not leak its text to the browser. */
function fail(request: FastifyRequest, reply: FastifyReply, error: unknown, logMessage: string, fallback: string) {
    if (error instanceof AppError && error.statusCode !== 500) {
        return reply.status(error.statusCode).send({ success: false, error: error.message });
    }
    request.log.error(error, logMessage);
    return reply.status(500).send({ success: false, error: fallback });
}

class AdminInvoicesController {
    /** GET /admin/users/:userId/invoices/prefill */
    async prefill(request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) {
        try {
            const data = await adminInvoicesService.prefillForUser(request.params.userId);
            return reply.send({ success: true, data });
        } catch (error) {
            return fail(request, reply, error, 'Admin invoice prefill failed', 'Failed to load invoice defaults');
        }
    }

    /** GET /admin/users/:userId/invoices */
    async list(request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) {
        try {
            const data = await adminInvoicesService.listForUser(request.params.userId);
            return reply.send({ success: true, data });
        } catch (error) {
            return fail(request, reply, error, 'Admin invoice list failed', 'Failed to list invoices');
        }
    }

    /**
     * POST /admin/users/:userId/invoices/preview
     *
     * Renders from unsaved input and allocates NOTHING. Streaming the bytes
     * back instead of persisting is what lets the number series stay gapless:
     * an admin can look at the document as often as they like before deciding
     * to issue one.
     */
    async preview(request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) {
        const parsed = CreateInvoiceSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid request' });
        }
        try {
            const pdf = await adminInvoicesService.previewInvoice(parsed.data);
            return reply
                .header('Content-Type', 'application/pdf')
                .header('Content-Disposition', 'inline; filename="invoice-preview.pdf"')
                // A preview is a render of what the admin has typed right now.
                // Caching it would show a stale document after an edit.
                .header('Cache-Control', 'no-store')
                .send(pdf);
        } catch (error) {
            return fail(request, reply, error, 'Admin invoice preview failed', 'Failed to render the invoice preview');
        }
    }

    /** POST /admin/users/:userId/invoices — allocates a number. Not idempotent
     *  by design: two calls are two invoices, because that is what a second
     *  deliberate click means for a numbered document. */
    async create(request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) {
        const parsed = CreateInvoiceSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid request' });
        }
        const adminUserId = (request as AuthenticatedRequest).user?.userId;
        try {
            const data = await adminInvoicesService.createInvoice(request.params.userId, parsed.data, adminUserId);
            request.log.info(
                { adminUserId, targetUserId: request.params.userId, invoiceId: data.id, number: data.number },
                'Admin issued invoice',
            );
            return reply.status(201).send({ success: true, data });
        } catch (error) {
            return fail(request, reply, error, 'Admin invoice creation failed', 'Failed to issue the invoice');
        }
    }

    /** GET /admin/invoices/:invoiceId/pdf — the ARCHIVED bytes, never a
     *  re-render. See the invoice_documents table comment. */
    async download(request: FastifyRequest<{ Params: { invoiceId: string } }>, reply: FastifyReply) {
        try {
            const doc = await adminInvoicesService.getDocument(request.params.invoiceId);
            return reply
                .header('Content-Type', 'application/pdf')
                .header('Content-Disposition', `inline; filename="${doc.number}.pdf"`)
                // Private: this is a financial document behind an admin session,
                // and no shared cache should ever hold a copy.
                .header('Cache-Control', 'private, no-store')
                .send(doc.bytes);
        } catch (error) {
            return fail(request, reply, error, 'Admin invoice download failed', 'Failed to load the invoice');
        }
    }

    /** POST /admin/invoices/:invoiceId/send */
    async send(request: FastifyRequest<{ Params: { invoiceId: string } }>, reply: FastifyReply) {
        const parsed = SendInvoiceSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid request' });
        }
        const adminUserId = (request as AuthenticatedRequest).user?.userId;
        try {
            const data = await adminInvoicesService.sendInvoice(request.params.invoiceId, parsed.data, adminUserId);
            request.log.info({ adminUserId, invoiceId: request.params.invoiceId, number: data.number }, 'Admin sent invoice');
            return reply.send({ success: true, data });
        } catch (error) {
            return fail(request, reply, error, 'Admin invoice send failed', 'Failed to send the invoice');
        }
    }

    /** POST /admin/invoices/:invoiceId/void */
    async void(request: FastifyRequest<{ Params: { invoiceId: string } }>, reply: FastifyReply) {
        const parsed = VoidInvoiceSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid request' });
        }
        const adminUserId = (request as AuthenticatedRequest).user?.userId;
        try {
            const data = await adminInvoicesService.voidInvoice(request.params.invoiceId, parsed.data.reason, adminUserId);
            request.log.info({ adminUserId, invoiceId: request.params.invoiceId, number: data.number }, 'Admin voided invoice');
            return reply.send({ success: true, data });
        } catch (error) {
            return fail(request, reply, error, 'Admin invoice void failed', 'Failed to void the invoice');
        }
    }
}

export const adminInvoicesController = new AdminInvoicesController();
