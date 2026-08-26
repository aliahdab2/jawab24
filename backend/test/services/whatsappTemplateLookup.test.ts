import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config', () => ({
    config: { facebook: { graphApiVersion: 'v23.0', appId: 'app-1', appSecret: 'SUPER_SECRET' } },
}));

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import axios from 'axios';
import { whatsappService } from '../../src/services/whatsapp';

/**
 * `getMessageTemplateStatus` — the REQUEST CONTRACT with Meta's template edge.
 *
 * Why this file exists: the sender suite mocks `whatsappService` wholesale, so it
 * only proves the sender *called* the lookup. Nothing asserted what was actually
 * sent to Graph — and the original implementation filtered on `name`, which this
 * edge does not support. Graph silently ignores an unknown query parameter, so
 * the call degraded into "the first page of every template on the WABA" and every
 * one of those mocked tests stayed green while a merchant with a populated WABA
 * would read back `null` → `unknown` → a permanent `whatsapp_template_pending`.
 *
 * Two invariants are locked down here:
 *   1. the documented filter (`name_or_content`) is the one we send
 *   2. a template past the first page is still found, and the token stays in the
 *      Authorization header rather than riding along in a `paging.next` URL
 */
const WABA = 'waba-1';
const TOKEN = 'tok-abc';
const NAME = 'jawab24_order_confirmed_ar_v1';

function page(rows: Array<{ name: string; language: string; status: string }>, after?: string) {
    return { data: { data: rows, paging: after ? { cursors: { after } } : {} } };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('getMessageTemplateStatus', () => {
    it('filters with name_or_content — the parameter this edge actually supports', async () => {
        vi.mocked(axios.get).mockResolvedValue(page([{ name: NAME, language: 'ar', status: 'APPROVED' }]));

        await expect(whatsappService.getMessageTemplateStatus(WABA, TOKEN, NAME, 'ar')).resolves.toBe('APPROVED');

        const [, options] = vi.mocked(axios.get).mock.calls[0];
        expect(options?.params).toMatchObject({ name_or_content: NAME });
        // `name` is not a filter on this edge; sending it filters nothing.
        expect(options?.params).not.toHaveProperty('name');
    });

    it('sends the token as a bearer header, never in the query string', async () => {
        vi.mocked(axios.get).mockResolvedValue(page([{ name: NAME, language: 'ar', status: 'APPROVED' }]));

        await whatsappService.getMessageTemplateStatus(WABA, TOKEN, NAME, 'ar');

        const [url, options] = vi.mocked(axios.get).mock.calls[0];
        expect(options?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
        expect(url).not.toContain(TOKEN);
        expect(JSON.stringify(options?.params)).not.toContain(TOKEN);
    });

    // The failure this prevents: an agency WABA, or a store migrating in from
    // another provider, already carries enough templates to push ours off page 1.
    it('follows the cursor to find a template that is not on the first page', async () => {
        vi.mocked(axios.get)
            .mockResolvedValueOnce(page([{ name: 'someone_elses_tpl', language: 'ar', status: 'APPROVED' }], 'cursor-1'))
            .mockResolvedValueOnce(page([{ name: NAME, language: 'ar', status: 'APPROVED' }]));

        await expect(whatsappService.getMessageTemplateStatus(WABA, TOKEN, NAME, 'ar')).resolves.toBe('APPROVED');

        expect(axios.get).toHaveBeenCalledTimes(2);
        expect(vi.mocked(axios.get).mock.calls[1][1]?.params).toMatchObject({ after: 'cursor-1' });
    });

    it('stops at the last page and reports the template as absent', async () => {
        vi.mocked(axios.get).mockResolvedValue(page([{ name: 'other', language: 'ar', status: 'APPROVED' }]));

        await expect(whatsappService.getMessageTemplateStatus(WABA, TOKEN, NAME, 'ar')).resolves.toBeNull();
        expect(axios.get).toHaveBeenCalledTimes(1);   // no cursor ⇒ no second page
    });

    // `name_or_content` is a SEARCH: it also matches templates whose BODY contains
    // the string. Returning a near-miss would report someone else's review state.
    it('requires an exact name and language match, not just a search hit', async () => {
        vi.mocked(axios.get).mockResolvedValue(page([
            { name: NAME, language: 'en', status: 'APPROVED' },          // right name, wrong language
            { name: `${NAME}_draft`, language: 'ar', status: 'APPROVED' }, // substring hit
        ]));

        await expect(whatsappService.getMessageTemplateStatus(WABA, TOKEN, NAME, 'ar')).resolves.toBeNull();
    });

    // A runaway cursor must not page an entire agency WABA on every notification.
    it('gives up after a bounded number of pages', async () => {
        vi.mocked(axios.get).mockResolvedValue(page([{ name: 'other', language: 'ar', status: 'APPROVED' }], 'endless'));

        await expect(whatsappService.getMessageTemplateStatus(WABA, TOKEN, NAME, 'ar')).resolves.toBeNull();
        expect(axios.get).toHaveBeenCalledTimes(5);
    });
});
