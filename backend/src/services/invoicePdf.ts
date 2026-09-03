/**
 * Invoice PDF renderer — HTML in, PDF bytes out, via headless Chromium.
 *
 * ## Why Chromium and not a PDF library
 *
 * The document is bilingual and its primary language is Arabic. Arabic is not a
 * matter of picking a font: it needs bidirectional reordering and contextual
 * glyph shaping, which the drawing-primitive PDF libraries (pdfkit, pdf-lib)
 * leave to the caller. Chromium already does both correctly — it is the engine
 * the invoice template was designed and proofed against — and the backend image
 * already ships the Noto Arabic and Latin faces it needs, installed for the
 * post-card compositor (see backend/Dockerfile).
 *
 * ## Lifecycle
 *
 * A browser is launched per render and closed in `finally`. That is deliberate:
 * invoices are issued a handful of times a month, so the ~300ms launch is
 * irrelevant, while a resident Chromium in the API container would hold tens of
 * megabytes and add a crash surface to a process whose job is answering
 * requests. Nothing here is on a merchant-facing hot path — AI_INSTRUCTIONS §17
 * governs reply latency, and an admin issuing an invoice is not that.
 *
 * ## Failure posture
 *
 * Rendering failure must be loud and contained. It throws a typed error the
 * controller maps to a 5xx; it never returns a partial or placeholder document,
 * because a wrong invoice is worse than no invoice. The import of
 * `puppeteer-core` is lazy so that a backend missing the Chromium binary still
 * BOOTS — only invoice rendering fails, and it says why.
 */

import { existsSync } from 'fs';
import { config } from '../config';
import { captureError } from '../utils/sentryHelpers';
import { AppError } from '../utils/errors';

export class InvoiceRenderError extends AppError {
    constructor(message: string) {
        super(message, 500, 'INVOICE_RENDER_FAILED');
    }
}

/**
 * Where the browser binary lives.
 *
 * An explicit CHROMIUM_PATH always wins — that is how a developer on macOS
 * points at their own Chrome, and how a future base-image change is fixed
 * without a release. With nothing set, the known Alpine layouts are probed in
 * order rather than one path being ASSUMED: the `chromium` package has shipped
 * the binary at more than one of these across Alpine versions, and guessing
 * wrong would mean invoicing is broken in production until someone tries to
 * issue one.
 *
 * Never bundled — `puppeteer-core` deliberately downloads no browser, which is
 * what keeps `npm install` from pulling ~150MB per developer and per gate run.
 */
const CHROMIUM_CANDIDATES = [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/lib/chromium/chrome',
];

function resolveExecutablePath(): string {
    const configured = config.invoicing.chromiumPath;
    if (configured) {
        // Trust an explicit setting even if it does not exist yet: the operator
        // said so, and a misleading "falling back to..." would hide their typo.
        return configured;
    }
    const found = CHROMIUM_CANDIDATES.find((p) => existsSync(p));
    if (!found) {
        throw new InvoiceRenderError(
            `No Chromium binary found. Set CHROMIUM_PATH, or install one at: ${CHROMIUM_CANDIDATES.join(', ')}`,
        );
    }
    return found;
}

/** Hard ceiling on a render. A hung browser must not hold an admin request
 *  open indefinitely; the launch and the PDF call each get their own budget. */
const RENDER_TIMEOUT_MS = 20_000;

export async function renderInvoicePdf(html: string): Promise<Buffer> {

    // Lazy, and inside the try: a missing module must surface as an
    // InvoiceRenderError like every other failure here, not as an unhandled
    // import crash at require time.
    let puppeteer: typeof import('puppeteer-core');
    try {
        puppeteer = await import('puppeteer-core');
    } catch (err) {
        captureError(err, 'Invoice PDF renderer unavailable', { tags: { service: 'invoice-pdf', stage: 'import' } });
        throw new InvoiceRenderError('PDF renderer is unavailable (puppeteer-core not installed)');
    }

    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    let executablePath = '';
    try {
        executablePath = resolveExecutablePath();
        browser = await puppeteer.launch({
            executablePath,
            timeout: RENDER_TIMEOUT_MS,
            args: [
                // Required: the container runs as an unprivileged user with no
                // user-namespace support, so Chromium's sandbox cannot start.
                // Acceptable here and ONLY here because the HTML we render is
                // our own template with escaped values — never merchant-supplied
                // markup, never a remote URL.
                '--no-sandbox',
                '--disable-setuid-sandbox',
                // /dev/shm is 64MB in Docker by default; Chromium exhausts it
                // and dies with an opaque crash. Route shared memory to /tmp.
                '--disable-dev-shm-usage',
                '--disable-gpu',
                // No network is needed: fonts resolve through fontconfig and the
                // logo is a data URI. Blocking it removes a whole class of
                // hangs and makes rendering deterministic and offline.
                '--disable-extensions',
            ],
        });

        const page = await browser.newPage();
        // `networkidle0` would wait for requests that never happen. The document
        // is fully self-contained, so `load` is both sufficient and immediate.
        await page.setContent(html, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS });
        // Fonts are the one asynchronous thing left: without this the first page
        // can rasterize before the Arabic face is ready and fall back to tofu —
        // the silent failure the Dockerfile's font note warns about.
        //
        // The callback is serialized and runs in the BROWSER, where `document`
        // exists; the backend tsconfig has no DOM lib, so the shape is declared
        // here rather than reached for with `any`.
        type FontFacesReady = { document: { fonts: { ready: Promise<unknown> } } };
        await page.evaluate(() => (globalThis as unknown as FontFacesReady).document.fonts.ready);

        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            // Margins live in the template's @page rule so the HTML preview and
            // the PDF agree; overriding them here would silently desynchronize
            // what an admin sees from what the customer receives.
            preferCSSPageSize: true,
            timeout: RENDER_TIMEOUT_MS,
        });

        const buffer = Buffer.from(pdf);
        if (buffer.length === 0 || !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
            // Cheap proof we produced what we claim. The merchant-email
            // attachment validator sniffs the same magic bytes and would reject
            // this later anyway — failing here names the real cause.
            throw new InvoiceRenderError('Renderer returned bytes that are not a PDF');
        }
        return buffer;
    } catch (err) {
        if (err instanceof InvoiceRenderError) throw err;
        captureError(err, 'Invoice PDF render failed', { tags: { service: 'invoice-pdf', stage: 'render' }, extra: { executablePath } });
        throw new InvoiceRenderError('Failed to render the invoice PDF');
    } finally {
        // Never leave a browser process behind. A leak here accumulates until
        // the container is OOM-killed, and the symptom (the API dying hours
        // later) would point nowhere near invoicing.
        if (browser) {
            await browser.close().catch((err) => captureError(err, 'Invoice PDF browser close failed', { tags: { service: 'invoice-pdf', stage: 'close' } }));
        }
    }
}
