/**
 * Canonical reply text → what one delivery channel can actually render.
 *
 * The model writes ONE canonical reply (it may use light markdown: links,
 * images, `**bold**`, `__italic__`, `~~strike~~`, `# headings`). No customer
 * channel renders markdown, and they do not even agree with each other:
 *
 *   plain     Messenger, Instagram (DM + comments), SMS — text only. Every
 *             marker is removed; a link becomes `label: url`.
 *   whatsapp  WhatsApp's own inline markup — `*bold*`, `_italic_`, `~strike~`
 *             (https://faq.whatsapp.com/539178204879377). Markdown is
 *             translated to it rather than stripped; a heading becomes a bold
 *             line.
 *
 * Each platform adapter owns the choice of target for its channel
 * (`renderReply`); the pipeline renders immediately before sending and
 * persists the rendered text, so the stored row is what the customer saw.
 *
 * Deliberately conservative where a marker is ambiguous in prose: a SINGLE
 * `*` or `_` is left alone (prices like «3*2», handles like «@my_shop»), so
 * only the paired double forms are treated as markup.
 */
import { stripMarkdownLinks } from './markdownLinks';

export type ReplyRenderTarget = 'plain' | 'whatsapp';

const BOLD_RE = /\*\*([^*\n]+?)\*\*/g;
const ITALIC_RE = /__([^_\n]+?)__/g;
const STRIKE_RE = /~~([^~\n]+?)~~/g;
/** A markdown heading: 1–6 `#` at line start followed by a space. */
const HEADING_RE = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;

export function renderReplyForChannel(text: string, target: ReplyRenderTarget): string {
    if (!text) return text;
    let out = stripMarkdownLinks(text);
    if (target === 'whatsapp') {
        out = out
            .replace(HEADING_RE, '*$1*')
            .replace(BOLD_RE, '*$1*')
            .replace(ITALIC_RE, '_$1_')
            .replace(STRIKE_RE, '~$1~');
    } else {
        out = out
            .replace(HEADING_RE, '$1')
            .replace(BOLD_RE, '$1')
            .replace(ITALIC_RE, '$1')
            .replace(STRIKE_RE, '$1');
    }
    return out;
}
