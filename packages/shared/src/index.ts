// Shared Types for Jawab24

import type { MerchantProvenanceMap } from './businessProfileMerge';
import type { PresentFields } from './catalogKbMatch';
import { matchStructuredFieldLinesInKb } from './catalogKbMatch';
import { businessPhoneList } from './businessInfoPrompt';
import type { BusinessPhone } from './businessPhone';

// --- Validation schemas (single source of truth across backend + frontend) ---
export { UpdateSettingsSchema, type UpdateSettingsInput } from './schemas/settings';

// --- Flag Reason Translations ---
export { default as flagReasonEn } from './i18n/en/flagReason.json';
export { default as flagReasonAr } from './i18n/ar/flagReason.json';

// --- Notification payload contract (backend push tag + frontend deep-link route) ---
export {
    NOTIFICATION_TARGET_KEYS,
    resolveNotificationTargetKey,
    type NotificationTargetKey,
} from './notifications';

// --- Flag Reason Structured Metadata ---
/**
 * Structured parameters/debug info attached to a flag_reason. Keyed by the
 * reason code so multi-flag rows (comma-separated flag_reason) can carry
 * per-reason data. Rows with only plain keys (angry_customer, low_confidence,
 * etc.) leave flag_meta NULL.
 *
 * Example: flag_reason = "dm_failed,low_confidence",
 *          flag_meta   = { dm_failed: { bucket: "unknown", code: 10, fbMessage: "..." } }
 */
export interface FlagMeta {
    dm_failed?: {
        bucket: 'customer_refused' | 'window_expired' | 'transient' | 'our_fault' | 'thread_owned_elsewhere' | 'unknown';
        code?: number;
        subcode?: number;
        fbMessage?: string;
    };
    sla_no_reply?: {
        minutes: number;
    };
    // KB-gap flags carry the customer question the AI couldn't answer from the
    // knowledge base, captured at flag time. The inbox shows it so the merchant
    // knows exactly what to add to Business Info — the conversation may have
    // moved on (e.g. a later "تمام"/"شكراً"), so the flagged question can't be
    // reconstructed from the latest message alone. Same shape across all three;
    // only the one(s) actually flagged are populated.
    info_not_in_kb?: { question: string };
    price_not_in_kb?: { question: string };
    phone_not_in_kb?: { question: string };
    // Informational marker on OUTGOING rows only: the ai-worker's truncation
    // retry auto-shortened this reply before delivery. Drives a quiet inbox
    // badge; deliberately never set alongside needs_attention.
    reply_shortened?: Record<string, never>;
    // Informational marker on OUTGOING rows only: this reply was delivered with an
    // image attached (Post Reply image card). Drives a quiet "image attached" badge
    // in the comment + message threads so the merchant can tell the reply carried an
    // image; deliberately never set alongside needs_attention.
    reply_image?: Record<string, never>;
    // Informational marker on OUTGOING rows only: this reply was delivered with a
    // Post Reply CTA link button (Messenger button template / image-card button).
    // Carries the merchant-authored label + URL so the comment + message threads can
    // render the button the customer actually received — without it the app has no
    // record a button was sent; deliberately never set alongside needs_attention.
    reply_cta?: { label: string; url: string };
    // Open-ended: future flags can add their own namespaced meta here.
    [key: string]: Record<string, unknown> | undefined;
}

/**
 * Flags meaning "the answer wasn't in the knowledge base" — the merchant should
 * add it to Business Info. Each carries the customer's unanswered question in
 * flag_meta (see FlagMeta). Single source of truth shared by the backend
 * (capture, buildKbGapFlagMeta) and the frontend (display, getKbGapQuestion).
 */
export const KB_GAP_FLAGS = ['info_not_in_kb', 'price_not_in_kb', 'phone_not_in_kb'] as const;
export type KbGapFlag = (typeof KB_GAP_FLAGS)[number];

// --- Utilities ---
export {
    isValidTimezone,
    safeTimezone,
    formatTimeInZone,
    formatUtcOffset,
    detectTimezone,
    resolveStoredTimezone,
    getTimezoneOptions,
    utcOffsetMinutes,
} from './timezone';
export { normalizeArabic } from './utils/arabic-normalize';
export type { NormalizeOptions } from './utils/arabic-normalize';
export type {
  FactWeekdaysValue,
  FactTimeRangeValue,
  FactStructuredFieldValue,
  FactStructuredValues,
} from './factSchedule';
export { sanitizeUserInput } from './utils/sanitize';
export { sanitizeKbContent } from './utils/sanitize-kb';
export { isSafeRedirectPath } from './utils/redirect';
export { matchesKeyword, testKeywordsMatch, parseKeywords } from './utils/keyword-matching';
export { parseFlagReason, hasAnyFlag } from './utils/flag-reason';
export { matchCatalogLinesInKb, matchStructuredFieldLinesInKb, removeKbLines } from './catalogKbMatch';
export { detectCatalogLikePatterns } from './kbContentClassifier';
export type { CatalogReason, CatalogDetection } from './kbContentClassifier';
export { reconcileCatalogProposals } from './catalogReconcile';
export type { ReconcileExistingItem, ReconcileProposalItem, ReconcileKind, ReconcileResult } from './catalogReconcile';
export { postsScanEligibility } from './catalogScanEligibility';
export type { PostsScanBlocker, PostsScanEligibility, PostsScanEligibilityInput } from './catalogScanEligibility';
export { MARKETPLACE_BILLED_CODES, isMarketplaceBilledCode } from './marketplaceBilledCodes';
export type { MarketplaceBilledCode } from './marketplaceBilledCodes';
// presentFieldsFromProfile is defined in this file (needs unwrapBusinessProfile).
export type { CatalogMatchItem, KbLineMatch, KbLineMatchConfidence, StructuredFieldKind, PresentFields, StructuredFieldLineMatch } from './catalogKbMatch';
export { PHONE_REGEX, EMAIL_REGEX, isValidPhone, isValidEmail, isValidContact, isValidHttpUrl, normalizeHttpUrl, detectContactType, isArabicPhone, normalizeArabicIndic, extractPhones, extractPhoneFromText, extractPhonesFromText, extractCustomerPhones, samePhoneNumber, phoneDigitsTail, SMS_BLOCKED_DIAL_PREFIXES, isSmsBlockedPhone } from './utils/validation';
export type { ExtractedPhone } from './utils/validation';

// --- SSE Event Types ---
export * from './sse-events';

// --- E-commerce Tool Types ---
export * from './ecommerce-tools';

// --- Rich Messaging Types ---
/**
 * A single card in a Messenger/Instagram Generic Template carousel.
 * Used for rich product replies (images + prices + actions).
 *
 * Meta limits: title ≤ 80 chars, subtitle ≤ 80 chars, up to 3 buttons,
 * up to 10 cards per carousel. Callers are responsible for truncation.
 */
export interface ProductCard {
    title: string;
    subtitle: string;
    imageUrl: string;
    productUrl: string;
    buttons?: Array<{
        type: 'web_url' | 'postback';
        title: string;
        url?: string;
        payload?: string;
    }>;
}

// --- Message Types ---
export interface Message {
  id: string;
  pageId: string;
  platformMessageId: string;
  senderId: string;
  senderName: string | null;
  message: string;
  direction: 'incoming' | 'outgoing';
  replied: boolean;
  replyText: string | null;
  replyMethod: 'template' | 'ai' | 'manual' | 'post_reply' | null;
  createdAt: string | Date | null;
  createdTime?: string | Date | null;
  repliedAt?: string | Date | null;
  needsAttention?: boolean;
  flagReason?: string | null;
  flagMeta?: FlagMeta | null;
  aiIntent?: string | null;
  aiOriginalReply?: string | null;
  resolved?: boolean;
  platform?: 'facebook' | 'instagram' | 'whatsapp';
  attachmentType?: string | null;
  /** Store-then-enrich lifecycle for attachment rows: null | 'pending' | 'done' | 'failed'.
   *  See messages table schema + nonTextHandler. */
  enrichmentStatus?: string | null;
}

// --- Comment Types ---
export interface Comment {
  id: string;
  message: string;
  fromName: string | null;
  fromId?: string | null;
  replied: boolean | null;
  replyText: string | null;
  replyMethod: 'template' | 'ai' | 'manual' | 'post_reply' | string | null;
  detectedLanguage: string | null;
  pageId: string | null;
  createdAt: string | Date | null;
  repliedAt?: string | Date | null;
  postId: string | null;
  facebookCommentId?: string;
  /** Facebook: post ID (e.g. "123_456"); Instagram: full permalink URL or null */
  postPermalink?: string | null;
  needsAttention?: boolean;
  flagReason?: string | null;
  flagMeta?: FlagMeta | null;
  aiIntent?: string | null;
  aiOriginalReply?: string | null;
  resolved?: boolean | null;
  postMessage?: string | null;
  source?: 'facebook' | 'instagram';
}

// --- Business Profile Types ---
//
// Stage 2.6 (2026-05-23) split this into two parallel sub-objects on the
// same `pages.business_profile` JSONB column:
//
//   business_profile = {
//     merchant:    BusinessProfile  // editor-write-only, AI prompt reads ONLY this
//     suggestions: BusinessProfile  // FB-sync-only, surfaced as "Import from Facebook" buttons
//   }
//
// The split is the regression-prevention gate: stale FB data physically
// cannot reach the AI's BUSINESS_INFO prompt block, because the prompt
// formatter reads only `merchant`. The chunker (used to feed raw KB to
// the AI as text) reads BOTH sub-objects merged (merchant wins on
// conflict), preserving today's behavior for pages whose merchant never
// visited the editor.
//
// During the migration rollout window the column may still contain the
// legacy flat shape (no `merchant`/`suggestions` keys). Readers should
// treat that case as `{ merchant: {}, suggestions: <flat data> }` —
// conservative default, matches the migration's heuristic for FB-default
// rows. See `backend/migrations/0109_split_business_profile.sql`.
//
// Older `phone: string` kept on the inner shape as deprecated for backwards
// compatibility — the migration coerces it into `phones[0]`. Once all rows
// are migrated, `phone` can be removed.
//
// `hours` keeps its `Record<string, string[]>` shape (one entry per day,
// array of canonical strings like `["09:00-18:00"]` / `["closed"]` /
// `["all day"]`). Multi-window was never used in prod (verified
// 2026-05-23) but the array form is preserved so the existing renderers
// keep working. The Stage 2.6 form emits length-1 arrays. Multi-window
// is Stage 2.6.1 if needed.
export interface BusinessProfile {
  name?: string;
  category?: string;
  about?: string;
  /** @deprecated since Stage 2.6 — use `phones[0]`. Coerced on next sync. */
  phone?: string;
  /**
   * Ordered, primary first. v1 enforces length ≤ 10 server-side.
   *
   * An entry is a bare string when it has no description, and a
   * `{number, description}` object when the merchant said what the line is for
   * («الإدارة — عند الطلب فقط»). That "iff" is the CANONICAL-FORM INVARIANT —
   * read `businessPhone.ts` before touching either shape, and never write this
   * field without `normalizePhoneEntries`.
   *
   * Read it with `businessPhoneEntries` (entries) or `businessPhoneList`
   * (numbers only) — never destructure the raw array.
   */
  phones?: BusinessPhone[];
  /** The business's contact email. schema.org `ContactPoint.email`. */
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  country?: string;
  /** Canonical day → ["HH:MM-HH:MM" | "closed" | "all day"]. */
  hours?: Record<string, string[]>;
  channels?: {
    preferred?: 'dm' | 'whatsapp' | 'phone';
    /** The merchant's WhatsApp contact number(s). Historically a single
     *  string; the /business editor writes an array since any of the listed
     *  numbers can be on WhatsApp independently. Readers must accept both —
     *  normalize with `whatsappNumbers()` from `businessInfoPrompt`. */
    whatsapp?: string | string[];
  };
  language_hint?: 'ar' | 'en' | 'auto';
  /**
   * Free-text policy fields, ≤500 chars each, validated server-side.
   * Each is optional; missing fields appear as `[NOT_PROVIDED]` in the
   * prompt's BUSINESS_INFO block so the AI refuses rather than inventing.
   */
  policies?: {
    shipping?: string;
    returns?: string;
    payment?: string;
    booking?: string;
  };
}

/**
 * Stage 2.6 container shape for `pages.business_profile`. Splits merchant-
 * confirmed data from FB-suggested data so the AI prompt-injection layer
 * can read only what the merchant has explicitly typed (regression-proof
 * by construction: stale FB data physically can't reach the prompt).
 *
 * During the rollout window readers may also encounter the legacy flat
 * `BusinessProfile` shape. Use `unwrapBusinessProfile()` to normalize.
 */
export interface BusinessProfileContainer {
  /** Editor-write + auto-promoted FB data. The AI's BUSINESS_INFO prompt block reads ONLY this. */
  merchant?: BusinessProfile;
  /** FB-sync-only. Raw snapshot of the last FB sync; surfaced in the editor as "Review & Confirm" cues. */
  suggestions?: BusinessProfile;
  /**
   * Stage 2.6.1 sidecar map of per-field provenance for the `merchant`
   * half. Tracks whether each field came from FB sync (auto-promoted) or
   * the merchant editor (manually typed/cleared). See
   * {@link MerchantProvenanceMap} for state semantics, including the
   * "cleared ≠ never-seen" invariant.
   */
  merchantProvenance?: MerchantProvenanceMap;
}

/**
 * Stored JSONB may be in the new container shape, the legacy flat shape,
 * or null. Use {@link unwrapBusinessProfile} to normalize before reading.
 */
export type StoredBusinessProfile = BusinessProfileContainer | BusinessProfile | null | undefined;

function isContainer(p: unknown): p is BusinessProfileContainer {
  return !!p && typeof p === 'object' && ('merchant' in p || 'suggestions' in p);
}

// Hardening guard for the Drizzle + postgres.js jsonb double-encoding (parked
// for a separate hygiene PR). Drizzle's reader auto-parses string values, so
// this branch is dead for any read going through the ORM — but it protects
// any future direct-postgres.js read path from silently demoting the entire
// container into `suggestions`.
function parseIfStringified(p: unknown): unknown {
  if (typeof p !== 'string') return p;
  try { return JSON.parse(p); } catch { return null; }
}

/**
 * Normalize stored business_profile JSONB to the container shape.
 * Legacy flat rows are treated as FB-default (data goes under `suggestions`,
 * `merchant` is empty) — matches the migration's conservative default for
 * rows where we can't tell if the merchant ever edited them.
 */
export function unwrapBusinessProfile(stored: StoredBusinessProfile): BusinessProfileContainer {
  if (!stored) return {};
  const parsed = parseIfStringified(stored);
  if (!parsed) return {};
  if (isContainer(parsed)) return parsed;
  return { merchant: {}, suggestions: parsed as BusinessProfile };
}

/**
 * Merged view of merchant + suggestions for callers that need "everything
 * we know about this business" — used by the chunker to feed raw KB to
 * the AI. Merchant values win on conflict. Does NOT reach the structured
 * BUSINESS_INFO prompt block (that path reads only `merchant`).
 */
export function mergedBusinessProfile(stored: StoredBusinessProfile): BusinessProfile {
  const { merchant = {}, suggestions = {} } = unwrapBusinessProfile(stored);
  return { ...suggestions, ...merchant };
}

/**
 * Which structured fields the merchant holds as CONFIRMED values — the input
 * to `matchStructuredFieldLinesInKb`. Unwraps the stored container and reads
 * only `merchant` (the authoritative half). Single source of truth so the
 * "is this field present?" predicate can't diverge between the catalog page's
 * open-the-sheet check and the cleanup sheet's build-proposals step.
 *
 * ⚠️ Pass the RAW stored profile (the `{merchant,suggestions}` container or the
 * legacy flat shape) — NOT `mergedBusinessProfile(...)`. This reads only the
 * confirmed `merchant` half; a merged/flat value unwraps to empty `merchant`
 * and field-cleanup would silently never fire (no error, just a dead feature).
 */
export function presentFieldsFromProfile(stored: StoredBusinessProfile): PresentFields {
  const { merchant = {} } = unwrapBusinessProfile(stored);
  // Guard blank contents: [''] / [' '] is not a real phone, {sat:[]} is not
  // real hours — treat them as absent (matches the address `.trim()` check).
  // `businessPhoneList` already drops blanks and normalizes every phone shape,
  // so this reads through it rather than re-deriving the rule (the two used to
  // disagree: this one ignored the legacy singular `phone` entirely).
  const phoneNumbers = businessPhoneList(merchant);
  return {
    address: !!merchant.address?.trim(),
    phone: phoneNumbers.length > 0,
    hours: !!merchant.hours && Object.values(merchant.hours).some((v) => Array.isArray(v) && v.length > 0),
  };
}

/**
 * Is there a Business Info line that duplicates a CONFIRMED structured field,
 * i.e. is the cleanup offer worth showing at all?
 *
 * Both triggers ask this exact question — the fact-save in `/business` (C-F1)
 * and the post-import pass in `CatalogManager` — so it lives here rather than
 * being spelled out at each call site: the two drifting apart is how one of
 * them ends up never firing. Answering `false` costs nothing; the sheet is
 * only ever an OFFER and every line reaches it unchecked (D-038).
 */
export function hasFieldLinesToClean(
  kbText: string | null | undefined,
  stored: StoredBusinessProfile,
): boolean {
  if (!kbText?.trim()) return false;
  return matchStructuredFieldLinesInKb(kbText, presentFieldsFromProfile(stored)).length > 0;
}

// --- Page Types ---
export interface PageReplyBreakdown {
  ai: number;
  template: number;
  postReply: number;
}

export interface Page {
  id: string;
  name: string;
  facebookPageId: string | null;
  autoReplyEnabled: boolean | null;
  // Instagram fields
  instagramAccountId?: string | null;
  instagramUsername?: string | null;
  instagramProfilePicUrl?: string | null;
  instagramAutoReplyEnabled?: boolean | null;
  // WhatsApp fields
  whatsappPhoneNumberId?: string | null;
  whatsappBusinessAccountId?: string | null;
  whatsappDisplayPhoneNumber?: string | null;
  whatsappAutoReplyEnabled?: boolean | null;
  /**
   * TRUE when the number was onboarded via Meta's Coexistence flow and so is
   * STILL live in the merchant's WhatsApp Business app. Load-bearing on
   * reconnect: re-running Embedded Signup on the migration path would register
   * the number against the Cloud API and take it off their phone permanently.
   */
  whatsappCoexistence?: boolean | null;
  // E-commerce store linked to this page
  ecommerceStoreId?: string | null;
  /**
   * Whether the linked store ACTUALLY answers policy questions (delivery,
   * payment, returns) in replies — i.e. it is still active AND has synced
   * policy text. Derived server-side to mirror `getStoreContextForAI`, which
   * returns nothing for an inactive store or an empty `policiesSummary`.
   *
   * Never infer this from `ecommerceStoreId` alone: the id survives a
   * platform-side uninstall (`deactivateStore` blanks tokens but deliberately
   * keeps the link so a reconnect restores it), and a live store can sync with
   * no policies at all. In both cases the id is set while the model receives
   * nothing — so UI keyed on the id tells the merchant "your store answers
   * this" and the customer then gets "I don't know".
   */
  storeAnswersPolicies?: boolean;
  // KB fields — present on the DETAIL shape (`GET /pages/:id`). The list shape
  // omits them by construction; see `PageListItem` below.
  knowledgeBase?: string | null;
  suggestedKnowledgeBase?: string | null;
  /**
   * "Has the merchant actually provided business info?" — computed server-side
   * with the shared `isBusinessInfoProvided` predicate and returned by the LIST
   * endpoint in place of the raw text. Absent on single-page reads, which carry
   * the text itself.
   */
  kbFilled?: boolean;
  kbVersion?: number;
  kbActiveVersion?: number;
  kbUpdatedAt?: string | Date | null;
  // Business profile
  businessProfile?: BusinessProfile;
  businessProfileUpdatedAt?: string | Date | null;
  // Per-page overrides of the workspace lead config. null/absent = inherit the
  // workspace's settings.leadStages / settings.leadFields. Set = full replacement
  // for this page (see resolveEffectiveLeadStages / resolveEffectiveLeadFields).
  leadStages?: LeadStagesConfig | null;
  leadFields?: LeadCustomFieldDef[] | null;
  /**
   * Per-page persona override. null/absent OR an empty record = inherit the
   * workspace's settings.brandVoiceNotesMulti; a record with language keys is
   * this page's own persona (resolved via resolveBrandVoiceNotes' pageOverride
   * parameter — language pick + sourceLang bookkeeping identical to the
   * workspace field).
   */
  brandVoiceNotesMulti?: Record<string, string> | null;
  // Per-page reply-mode override. null/absent = inherit settings.replyMode
  // (see resolveEffectiveReplyMode).
  replyMode?: string | null;
  // Connection status (true if Facebook access token is valid)
  isConnected?: boolean;
  // True when a WhatsApp business token is stored (Embedded Signup completed)
  whatsappConnected?: boolean;
  // IDENTITY: this card is the Instagram-direct kind (Instagram Login, no
  // Facebook Page) — true whether the stored token is live OR cleared to the
  // '' was-connected sentinel by the refresh sweep. Key card rendering on THIS,
  // never on the liveness flag below: liveness dies exactly when the reconnect
  // UI must still say "this is an Instagram card".
  instagramDirect?: boolean;
  // LIVENESS: a non-empty Instagram Login token is currently stored.
  instagramDirectConnected?: boolean;
  // True when WhatsApp WAS connected and the token has since died (Meta forces a
  // 60-day expiry on Embedded Signup tokens). Distinct from "never connected":
  // only this state should raise the reconnect banner.
  whatsappNeedsReconnect?: boolean;
  // When the stored WhatsApp business token expires. Null = unknown or no expiry.
  whatsappTokenExpiresAt?: string | Date | null;
  // Defensive auto-pause: set to 'send_rejected' when the bot was paused after
  // hitting the consecutive-send-failure threshold (Page restricted/unpublished
  // by Meta, permission lost mid-flight). Cleared when the customer re-enables
  // auto-reply. See docs/page-auto-pause.md.
  autoPauseReason?: 'send_rejected' | null;
  autoPausedAt?: string | Date | null;
  // Merchant soft-hid this disconnected page. Never present on pages returned by
  // GET /pages (the controller filters archived rows out) — it reaches the client
  // only through admin payloads. Reconnecting via Facebook clears it.
  archivedAt?: string | Date | null;
  // Computed/joined fields
  commentsCount?: number;
  repliesCount?: number;
  // Per-method auto-reply breakdown — sums to `repliesCount`.
  breakdown?: PageReplyBreakdown;
  replyRate?: number;
  lastActivity?: number;
  // True when at least one post/media on this page has a Post Reply configured
  // (trigger_reply set, either mode). Powers the dashboard "try Post Reply" nudge.
  hasPostReplyTrigger?: boolean;
  // Number of merchant-authored catalog items (products/services/courses/...).
  // A page with items counts as having an answer source (needsBusinessInfo,
  // setup checklist) even with an empty free-text KB.
  catalogItemsCount?: number;
  createdAt: string | Date | null;
}

/**
 * A row as returned by the LIST endpoint (`GET /pages?view=list`).
 *
 * Separate type, not `Partial<Page>`, deliberately: the three heavy fields are
 * **absent by construction**, so reading them here must be a COMPILE error, not
 * a silent `undefined`. That distinction is not academic — a save seeded from a
 * row that merely lacked `businessProfile` is a full replace that tombstones
 * every other merchant-confirmed fact. Typing both shapes as `Page` is what let
 * that path exist unnoticed (self-review, 2026-08-18).
 *
 * Need the text or the profile? Fetch the page by id (`pagesApi.getById`),
 * which returns the full `Page`.
 */
export type PageListItem = Omit<
  Page,
  'knowledgeBase' | 'suggestedKnowledgeBase' | 'businessProfile'
> & {
  /** Server-computed replacement for the text; always present on this shape. */
  kbFilled: boolean;
};

/**
 * A row as returned by the DETAIL read (`GET /pages/:id`) — the three heavy
 * fields REQUIRED (nullable, but present).
 *
 * ⭐ This is the half that gives `PageListItem` its teeth. On `Page` those
 * fields are optional, so a list row is still structurally assignable to
 * `Page` — omitting an optional property satisfies it. Anything that actually
 * needs the text or the profile must therefore ask for `PageDetail`, which a
 * `PageListItem` CANNOT satisfy. Use it on every prop, parameter and helper
 * that reads or writes business-info content; leave `Page` for the identity-
 * shaped callers that neither read nor write it.
 */
export type PageDetail = Page &
  Required<Pick<Page, 'knowledgeBase' | 'suggestedKnowledgeBase'>> & {
    businessProfile: BusinessProfile;
  };

// --- Native catalog (merchant-authored offerings, store-less pages) ---
/** Generic offering kind. Verticals extend this union — never add per-vertical tables/screens. */
export type CatalogItemType = 'product' | 'service' | 'course' | 'vehicle' | 'custom';

export const CATALOG_ITEM_TYPES: CatalogItemType[] = ['product', 'service', 'course', 'vehicle', 'custom'];

/** Hard per-page cap on catalog items — enforced at write time (403 CATALOG_LIMIT_REACHED).
 *  Sized so the whole catalog always fits the AI prompt block without retrieval. */
export const MAX_CATALOG_ITEMS_PER_PAGE = 300;

/** Input cap for the catalog import's extract call (frontend textarea + backend
 *  Zod agree via this constant). Mirrors the KB / file-extractor output cap, so
 *  anything a merchant can paste or upload fits in one extraction. */
export const MAX_CATALOG_IMPORT_CHARS = 16_000;

/** Fact-engine caps. Shared because the SERVER enforces them and the CLIENT has
 *  to tell the merchant which one they hit — a second copy in the frontend is
 *  how the two silently drift apart. Same reasoning as the catalog caps above.
 *  Generous relative to reality: BAMBO's real directory is ~240 rows in ONE
 *  collection, and a page with more than a handful of distinct fact KINDS is a
 *  signal to look at, not a case to serve. */
export const MAX_COLLECTIONS_PER_PAGE = 12;
export const MAX_ROWS_PER_COLLECTION = 500;
/** A list's name, capped by `fact_collections.label varchar(120)`. Here for the
 *  same reason: the naming/rename sheet must stop the merchant AT the limit and
 *  say so, which it cannot do from a literal that only the column and the Zod
 *  schema know about. */
export const MAX_LIST_LABEL_LENGTH = 120;
/** A fact-row attribute VALUE. The entity editor renders note fields (ملاحظة)
 *  as an open textarea — a paragraph surface, not a label:value chip — so this
 *  is a paragraph cap. 600 matches the catalog description cap; total prompt
 *  cost stays bounded by the renderer's FACT_BLOCK_MAX_CHARS regardless.
 *  (Was 100 via the catalog attr schema: real merchant notes at ~150 chars
 *  failed with a misleading «check price and dates» error, 2026-08-16.) */
export const MAX_FACT_ATTR_VALUE_LENGTH = 600;
/** A fact-row attribute LABEL («ملاحظة», «التوقيت») — a chip, kept short. */
export const MAX_FACT_ATTR_LABEL_LENGTH = 30;
/** Per-row cap on attributes. 12, NOT the catalog's 6: the entity form itself
 *  offers up to 12 fields (and 12 structured shadows) — a lower server cap
 *  would silently slice off what the form accepted. */
export const MAX_FACT_ROW_ATTRIBUTES = 12;

/** A label+value detail on a catalog item ("المدة: ٦ أسابيع", "سنة الصنع: 2019").
 *  Free text by design — the AI consumes these only as rendered prompt TEXT, so
 *  labels need no stable key semantics; the UI merely SUGGESTS per-type labels. */
export interface CatalogItemAttribute {
  label: string;
  value: string;
}

/** Per-item cap on attributes — keeps the form and the prompt line scannable. */
export const MAX_CATALOG_ITEM_ATTRIBUTES = 6;

/** One thing a business offers, entered by the merchant (no e-commerce store needed).
 *  Rendered into the AI's <product_catalog> prompt block; never exposed via AI tools. */
export interface CatalogItem {
  id: string;
  pageId: string;
  type: CatalogItemType;
  name: string;
  description: string | null;
  /** Decimal string (numeric column). null = "price on request". */
  price: string | null;
  currency: string | null;
  /** Merchant-uploaded photo (Release 2); shown to customers as a DM card. */
  imageUrl: string | null;
  isAvailable: boolean;
  /** 'YYYY-MM-DD' calendar dates (course cohort start / offer expiry). A passed
   *  endsAt hides the item from the AI prompt; the UI shows an "Ended" badge. */
  startsAt: string | null;
  endsAt: string | null;
  attributes: CatalogItemAttribute[] | null;
  sortOrder: number;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
}

// --- Catalog verticals (business-type shaping) ---
/** Coarse business vertical for a page's catalog. Shapes DEFAULTS only (preselected
 *  item type, extractor hint) — never the data model. One generic engine underneath;
 *  a vertical must never grow its own tables, screens, or required fields. */
export type CatalogVertical =
  | 'electronics'
  | 'fashion'
  | 'vehicles'
  | 'education'
  | 'restaurant'
  | 'beauty'
  | 'real_estate'
  | 'home_goods'
  | 'services'
  | 'other';

export const CATALOG_VERTICALS: CatalogVertical[] = [
  'electronics', 'fashion', 'vehicles', 'education', 'restaurant',
  'beauty', 'real_estate', 'home_goods', 'services', 'other',
];

/** The item type a new/extracted item defaults to under each vertical
 *  (merchant can always switch — the type chips stay). */
export const CATALOG_VERTICAL_DEFAULT_TYPE: Record<CatalogVertical, CatalogItemType> = {
  electronics: 'product',
  fashion: 'product',
  vehicles: 'vehicle',
  education: 'course',
  restaurant: 'product',
  beauty: 'service',
  real_estate: 'custom',
  home_goods: 'product',
  services: 'service',
  other: 'product',
};

/** Where the effective vertical came from — merchant override, the Facebook
 *  page category, or the fallback when neither resolves. */
export type CatalogVerticalSource = 'merchant' | 'facebook' | 'default';

/**
 * Map a Facebook page category (Graph API string, e.g. "Computer company",
 * "Car dealership") to a catalog vertical. Keyword-based on purpose — Meta has
 * ~1,500 free-form category labels and localizes them, so exact tables rot.
 * Specific verticals are tested before generic ones ("Mobile phone repair
 * service" → electronics, not services). Returns null when nothing matches.
 */
export function verticalFromFbCategory(category: string | null | undefined): CatalogVertical | null {
  if (!category) return null;
  const c = category.toLowerCase();
  const rules: Array<[CatalogVertical, RegExp]> = [
    ['vehicles', /\b(car|cars|auto|automotive|vehicle|motorcycle|motorbike|dealership)\b|سيارات|دراجات/],
    ['education', /education|school|tutor|training|course|institute|university|college|learning|coaching|kindergarten|تدريب|تعليم|معهد|دورات|مدرسة|جامعة/],
    ['electronics', /computer|electronic|phone|mobile|laptop|software|gadget|appliance repair|حاسب|حاسوب|كمبيوتر|جوال|هاتف|إلكترون|الكترون/],
    ['restaurant', /restaurant|cafe|café|coffee|food|bakery|catering|dessert|pizzeria|shawarma|grill|مطعم|كافيه|مقهى|حلويات|مأكولات|مخبز/],
    ['beauty', /beauty|salon|spa|barber|cosmetic|makeup|nail|hair|تجميل|صالون|حلاق|مكياج/],
    ['fashion', /clothing|fashion|apparel|shoe|footwear|boutique|jewelry|jewellery|accessor|bags?\b|ملابس|أزياء|أحذية|مجوهرات|إكسسوار|اكسسوار|حقائب/],
    ['real_estate', /real estate|property|realtor|عقار/],
    ['home_goods', /furniture|home goods|home decor|homeware|household|kitchenware|أثاث|مفروشات|ديكور/],
    ['services', /service|repair|maintenance|cleaning|agency|consult|design|marketing|photograph|صيانة|خدمات|تصوير|تنظيف/],
  ];
  for (const [vertical, re] of rules) {
    if (re.test(c)) return vertical;
  }
  return null;
}

// --- Post Reply picker ---
/** A post surfaced in the Post Reply picker, merged with its stored trigger state.
 *  `platformPostId` is the Graph object id (used to find-or-create the internal row
 *  via POST /posts/ensure before configuring).
 *
 *  Despite the name (kept because `GET /pages/:id/published-posts` is shipped API the
 *  mobile app calls), the list can ALSO carry a Facebook page's still-scheduled posts —
 *  but only when the client opts in with `includeScheduled` (see
 *  `PublishedPostsQuery`), because a shipped app build that predates this field renders
 *  a scheduled post as a published one with no date. `scheduledPublishTime` set = not
 *  live yet, and `createdTime`/`commentsCount` are null for those (a scheduled post has
 *  no publish date and can have no comments). */
export interface PublishedPost {
  platformPostId: string;
  source: 'facebook' | 'instagram';
  message: string | null;
  imageUrl: string | null;
  createdTime: string | null;
  commentsCount: number | null;
  hasTrigger: boolean;
  triggerType?: 'keyword' | 'all' | null;
  /** True when this came from the scheduled edge, i.e. the post is not live yet. This —
   *  not `scheduledPublishTime` — is what makes a post pending: Graph can return a
   *  scheduled post with no `scheduled_publish_time`, and inferring "published" from the
   *  missing timestamp would render it as live with no date and no warning. */
  isScheduled?: boolean;
  /** ISO time this post is scheduled to publish; null for already-published posts (and
   *  for the rare pending post Graph reports without a time — check `isScheduled`).
   *  Facebook-only — the Instagram Graph API exposes no scheduled-media edge. */
  scheduledPublishTime?: string | null;
}

export interface PublishedPostsResponse {
  posts: PublishedPost[];
  nextCursor: string | null;
  /** True when the list is knowingly incomplete — a Graph read failed, or the
   *  scheduled edge hit its ceiling. The picker must SAY so: degrading a failed read
   *  to a silent empty list is how a token problem gets read as "I have no posts". */
  partial?: boolean;
}

/** A Graph object id as it crosses our API (`platformPostId`, `contentId`).
 *
 *  Real ids are numeric or `{pageId}_{postId}`; this check is deliberately wider than
 *  that (ids are Meta's to change) and only rejects what could not be one: empty,
 *  over-long, or carrying a character that would let the value steer a URL — `/`, `?`,
 *  `#`, `%`, whitespace. Service call sites still `encodeURIComponent` the id; this is
 *  the cheap boundary check that turns junk into a 400 instead of a wasted Graph call. */
export function isPlausiblePlatformPostId(value: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

// --- Instagram Types ---
export interface InstagramMedia {
  id: string;
  pageId: string;
  instagramMediaId: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS';
  caption?: string | null;
  permalink?: string | null;
  thumbnailUrl?: string | null;
  autoReplyEnabled: boolean | null;
  createdTime?: string | Date | null;
  createdAt: string | Date | null;
}

export interface InstagramComment {
  id: string;
  mediaId: string;
  instagramCommentId: string;
  message: string;
  fromId?: string | null;
  fromUsername?: string | null;
  replied: boolean | null;
  replyText?: string | null;
  replyMethod?: 'template' | 'ai' | 'manual' | 'post_reply' | null;
  detectedLanguage?: string | null;
  createdTime?: string | Date | null;
  repliedAt?: string | Date | null;
  createdAt: string | Date | null;
  needsAttention?: boolean;
  flagReason?: string | null;
  flagMeta?: FlagMeta | null;
  aiIntent?: string | null;
}

// --- Template Types ---
export interface Template {
  id: string;
  name: string;
  message: string;
  active: boolean | null;
  usageCount?: number;
}

// Reusable email templates for the admin waitlist broadcast UI.
// Defined as code-as-data on the backend; the frontend fetches them and
// inserts the variant matching the admin's UI language into Subject + Body.
//
// Two body shapes are supported, mutually exclusive in practice:
//   1. bodyEn/bodyAr        — plain text. The backend wraps these in a generic
//                             HTML shell (waitlistEmailTemplate) before sending.
//   2. htmlBodyEn/htmlBodyAr — full custom HTML email. Sent as-is, the only
//                             substitution is {{UNSUBSCRIBE_URL}} per recipient.
//                             When set, the admin UI shows a read-only preview
//                             instead of an editable body field, and the broadcast
//                             endpoint picks the variant matching the recipient's
//                             resolved language (KB → dashboardLanguage → 'ar').
export interface WaitlistEmailTemplate {
  id: string;
  name: string;
  subjectEn: string;
  subjectAr: string;
  bodyEn: string;
  bodyAr: string;
  htmlBodyEn?: string;
  htmlBodyAr?: string;
}

// --- Rule Types ---
export interface Rule {
  id: string;
  name: string;
  keywords: string[] | null;
  templateId: string | null;
  priority: number | null;
  active: boolean | null;
  matchCount?: number;
}

// --- Dashboard Stats Types ---
export interface DashboardStats {
  totalComments: number;
  autoReplies: number;
  aiReplies: number;
  avgResponseTime: string;
  replyRate: number;
  activePages: number;
}

// --- Pricing & Subscription Types ---
export interface Plan {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  price: number; // monthly price in cents
  yearlyPrice: number | null; // yearly price in cents; null = no yearly option
  // True only when the plan has a yearly Stripe price configured. The UI must
  // not offer yearly billing without it — the backend refuses (400
  // YEARLY_NOT_AVAILABLE) instead of silently billing the monthly price.
  yearlyAvailable: boolean;
  currency: string;
  interval: 'month' | 'year';
  // Limits
  maxPages: number | null;
  maxAiRepliesPerMonth: number | null;
  maxProducts: number | null;
  // Features
  facebookEnabled: boolean;
  instagramEnabled: boolean;
  ecommerceEnabled: boolean;
  whatsappEnabled: boolean;
  prioritySupport: boolean;
  // Trial
  trialDays: number;
  // Regional pricing
  regionalPricing?: Record<string, number>;
  // Status
  isActive: boolean;
  isPublic: boolean; // false = hidden from the public /pricing grid, still purchasable via direct link
  isDefault: boolean;
  sortOrder: number;
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused';

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  plan?: Plan; // Joined plan data
  status: SubscriptionStatus;
  stripeCustomerId?: string | null;
  paymentMethod?: string | null; // 'stripe' | 'paypal' | 'manual' | 'shopify'
  /** Set when paymentMethod='shopify': the *.myshopify.com domain whose App
   * Pricing subscription this row mirrors. */
  shopifyShopDomain?: string | null;
  trialEndsAt?: string | Date | null;
  currentPeriodStart: string | Date;
  currentPeriodEnd?: string | Date | null;
  canceledAt?: string | Date | null;
  cancelReason?: string | null;
  createdAt: string | Date;
}

export interface Usage {
  id: string;
  userId: string;
  periodStart: string | Date;
  periodEnd: string | Date;
  aiRepliesCount: number;
  totalCommentsProcessed: number;
  totalMessagesProcessed: number;
  dailyBreakdown?: Record<string, { ai: number }>;
}

export interface UsageSummary {
  currentPeriod: {
    start: string;
    end: string;
  };
  aiReplies: {
    used: number;
    limit: number | null; // null = unlimited
    remaining: number | null;
    percentUsed: number;
  };
  pages: {
    used: number;
    limit: number | null;
    remaining: number | null;
  };
  /**
   * Non-expiring AI reply credit balance from one-time top-up purchases.
   * Consumed only after the monthly plan quota is exhausted. May be negative
   * if a partially-consumed pack was refunded.
   *
   * Optional in the type for backward-compatibility during the rollout window
   * (older clients/mocks won't have it). Backend always returns it as of PR 1.
   */
  topup?: {
    balance: number;
    /** Sum of replies_added across all succeeded top-up purchases (lifetime). */
    lifetimePurchased: number;
  };
  subscription: {
    plan: Plan;
    status: SubscriptionStatus;
    trialDaysRemaining?: number;
    renewsAt?: string;
    hasStripeCustomer?: boolean;
    /** 'shopify' = billing lives in Shopify admin: the frontend must route
     * plan changes there and never into Stripe checkout/top-ups (D-G). */
    paymentMethod?: string;
    /** Deep link into Shopify admin plan management. Present only for
     * shopify-billed workspaces when the app handle is configured.
     *
     * ⚠️ Superseded by `marketplaceBilling.manageUrl` and no longer read by any
     * web frontend code — but deliberately still emitted, for the same reason as
     * `sallaBilled` below: the mobile app ships a BUNDLED frontend that lags the
     * web build by several releases, and an older build reads THIS field to build
     * the Shopify deep link. Dropping it because "nothing uses it" would silently
     * strand Shopify merchants on an old app with a banner and no way to manage
     * their plan. Retire it only once no supported app build reads it. */
    shopifyManageUrl?: string;
    /** true = a Salla merchant, whose paid plans must be billed through Salla
     * (apps-policy Article 5). Every Stripe surface — plan select, checkout,
     * top-ups — must be suppressed; the backend refuses them with code
     * SALLA_BILLED. Omitted (not `false`) when the rule does not apply.
     *
     * ⚠️ Superseded by `marketplaceBilling` but deliberately still emitted: the
     * mobile app ships a BUNDLED frontend that lags the web build by several
     * releases, so removing this field would silently un-suppress Stripe for
     * Salla merchants on an older app — an Article-5 violation with a delisting
     * risk. Retire it only once no supported app build reads it. */
    sallaBilled?: boolean;
    /** Set when a MARKETPLACE owns this account's paid plans instead of Stripe —
     * Shopify App Pricing, Salla Article 5, or the Zid App Market. Supersedes
     * `sallaBilled` and generalizes it: the frontend suppresses Stripe surfaces
     * whenever this is present, and sends the merchant to `manageUrl` when there
     * is one. Omitted when Stripe is the account's rail. */
    marketplaceBilling?: {
      marketplace: 'shopify' | 'salla' | 'zid';
      /** Where the merchant manages their plan. Absent when the marketplace has
       * no self-serve destination we can name (Salla today, Zid until its App
       * Market URL is configured) — absent means "suppress, but show no link",
       * never "do not suppress". */
      manageUrl?: string;
    };
  };
}

// --- API Response Types ---
export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  /** Stable machine code for clients to switch on. */
  code?: 'ai_limit_reached' | 'page_limit_reached' | 'subscription_inactive';
  limit?: number;
  used?: number;
  remaining?: number;
  /** ISO timestamp when the current usage period resets. Set when `code` is 'ai_limit_reached'. */
  resetsAt?: string;
  /**
   * True when allowance comes from the user's top-up balance rather than their
   * monthly plan quota. Set by canUseAiReplies when plan quota is exhausted (or
   * subscription is past_due/canceled) but topup_balance > 0.
   */
  usingTopup?: boolean;
  /** Current top-up balance when `usingTopup` is true. */
  topupBalance?: number;
}

// --- AI Worker Types ---
export interface AiGenerateJobData {
  commentId?: string; // Optional if just testing
  comment: string;
  language?: string;
  context?: Record<string, any>;
  type: 'reply' | 'moderation';
}

export const AI_QUEUE_NAME = 'ai-generation-queue';

// --- Reply Queue Types ---
export interface ReplyJobData {
  // Job identification
  jobType: 'facebook_comment' | 'facebook_message' | 'instagram_comment' | 'instagram_message' | 'whatsapp_message';
  requestId?: string; // Correlate with webhook request for tracing

  // Source identification
  pageId: string;           // Facebook/Instagram page ID (from webhook)
  postId?: string;          // For comments only (Facebook post ID or Instagram media ID)
  commentId?: string;       // Facebook/Instagram comment ID
  parentId?: string;        // Set when comment is a reply to another comment (sub-comment)
  sharedPostUrl?: string;   // URL of a shared post attached to a DM (for post context enrichment)
  sharedPostId?: string;    // Numeric post/media ID from webhook payload (more reliable than URL parsing)
  messageId?: string;       // Facebook/Instagram message ID (for DMs)
  senderId?: string;        // User who sent the comment/message
  senderName?: string;      // Display name of sender
  text: string;             // The actual comment/message content

  // Facebook Graph API `message_tags` — structured record of each user/page tag
  // inside a comment (offset, length, type, id). Used to skip peer-to-peer friend
  // tagging and precisely strip tagged spans before language detection. Undefined
  // for Instagram, DMs, and pre-upgrade jobs.
  //
  // Shape mirrors `backend/src/utils/commentText.ts#FacebookMessageTag`. Kept
  // inline here because the shared package is the base layer and cannot import
  // from `backend/`. If you change one, change both.
  messageTags?: { id: string; name: string; type: 'user' | 'page'; offset: number; length: number }[];

  // Metadata
  receivedAt: string;       // ISO timestamp when webhook received
  replyDelay?: number;      // Delay in seconds before processing (from user settings)
  handoffRetries?: number;  // How many times this job has been re-enqueued due to handoff pause
  // How many times this job has been re-enqueued (parked) because the AI was
  // temporarily unavailable (OpenAI insufficient_quota / ai-worker circuit open).
  // Kept SEPARATE from handoffRetries so quota-parked jobs don't trip the
  // handoff stale-backlog suppression (a 15-min-old unanswered message SHOULD
  // still get a reply once quota returns). Bounded by config.ai.parkMaxRetries.
  aiRetryCount?: number;
  // How many times this DM job has been re-enqueued (parked) while a sibling
  // attachment from the same sender is still being enriched (vision / Whisper /
  // shared-post fetch), so the reply consolidates the real content instead of
  // answering the bare text first. Kept SEPARATE from handoffRetries for the same
  // reason as aiRetryCount: parking here must NOT trip handoff stale-backlog
  // suppression, and these jobs must NOT be promoted by "Resume Smart Reply"
  // (promoteDelayedJobs filters on handoffRetries > 0). Bounded in messageProcessor
  // by MAX_ATTACHMENT_RETRIES, after which it replies to the text alone.
  attachmentRetries?: number;
}

export interface ReplyJobResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  replyText?: string;
  replyMethod?: 'template' | 'ai' | 'post_reply';
  error?: string;
  needsAttention?: boolean;
  flagReason?: string;
  flagMeta?: FlagMeta;
  aiIntent?: string;
  /** When set, the worker should re-enqueue this job with the given delay (ms) */
  handoffDelayMs?: number;
  /** When set, a sibling attachment is still enriching — the worker should
   *  re-enqueue this DM job with the given delay (ms), carrying attachmentRetries+1. */
  attachmentPendingDelayMs?: number;
}

export const REPLY_QUEUE_NAME = 'reply-processing-queue';

/** Default handoff pause duration (minutes) when a user manually replies to a customer */
export const DEFAULT_HANDOFF_PAUSE_MINUTES = 15;

// Re-exported from ./constants so they can be consumed by ./schemas/* without
// circular imports back into this module.
export {
    MAX_TEMPLATE_MESSAGE_LENGTH,
    MAX_BRAND_VOICE_LENGTH,
    DEFAULT_AI_MODEL,
    PLACEHOLDER_TIMEZONE,
    ALLOWED_AI_MODELS,
    isAllowedAiModel,
    type AllowedAiModel,
    POST_REPLY_MAX_KEYWORDS,
    POST_REPLY_MAX_KEYWORD_LEN,
    POST_REPLY_MAX_REPLY_LEN,
    POST_REPLY_IMAGE_MAX_BYTES,
    POST_REPLY_IMAGE_MIME_TYPES,
    POST_REPLY_CARD_CAPTION_MAX,
    POST_REPLY_BUTTON_LABEL_MAX,
    POST_REPLY_BUTTON_TEXT_MAX,
    READ_MORE_PAYLOAD_PREFIX,
    buildReadMorePayload,
    parseReadMorePayload,
} from './constants';

// --- Phase 6.5 P1 diagnostic counters ---
export {
    createAiMetrics,
    withAiMetrics,
    normalizeModelTag,
    type AiMetrics,
    type AiMetricsRedis,
    type AiMetricsStage,
    type CreateAiMetricsOptions,
    type FailedBeforeLogClass,
} from './aiMetrics';

// --- OpenAI abort/timeout classification (keep aiTimeout.ts the only definition) ---
export { isTimeoutAbort, classifyTimeoutAbort } from './aiTimeout';

// --- AI reply quota runway (plan cap + top-up balance) — keep aiQuota.ts the only definition ---
export {
    resolveAiQuotaStatus,
    AI_QUOTA_NEAR_WALL_RATIO,
    type AiQuotaState,
    type AiQuotaInput,
    type AiQuotaStatus,
} from './aiQuota';

/** Bump when the system prompt changes — used by both ai-worker (telemetry) and backend (cache key). */
// v39: lightweight date awareness — inject today's date (merchant timezone) into the
// prompt so the model stops relaying clearly-past KB/post dates as upcoming. NO
// deterministic guard / flag / deflection (that was v38, reverted in #314 for
// over-deflecting on date-heavy KBs). v38 is intentionally skipped to avoid colliding
// with the reverted deploy's cache/log rows.
// v40: Arabic dialect mirroring — the few-shot examples were accidentally all
// Levantine, so the model copied that and replied Syrian to e.g. Algerian customers
// (a real churn case). Fix: (1) balance the example dialects (Gulf/Egyptian/Levantine/
// Maghrebi/MSA) and add Maghrebi/Darija anchors so no single dialect dominates;
// (2) an explicit rule to mirror the customer's dialect — MSA only when the message is
// dialect-neutral, never default to Levantine — reinforced per-call in the dynamic
// suffix; (3) neutralized the Levantine tokens previously embedded in the per-call
// style directives. The deflection example is kept in MSA so we don't re-seed the
// exact phrase that leaked in prod. Known limit: the model reliably mirrors Gulf/
// Egyptian/Levantine but falls back to MSA for low-resource Maghrebi/Darija output
// (a model-capability ceiling, not a prompt gap).
// v41: info-missing deflection no longer promises a callback. The few-shot
// examples (4, 7, 8, 14) and rule 5 / self-check previously taught "the team
// will contact you / سيتواصلون معك / I'll check and get back to you" — an
// implicit human follow-up the merchant can't reliably action across every AI
// conversation, so it became a false promise. Now: when info isn't in KB, point
// the customer to a contact channel from BUSINESS_INFO (so THEY reach out), or
// be honest "I don't have that right now" with NO callback. Genuine cancel/
// refund/exchange handoff (example 6b) is unchanged — those legitimately route
// to the team and are flagged urgent.
// v42: align the callback promise with what actually escalates to a human. A
// reply that sets needsAttention=true fires a merchant notification regardless
// of topic, but cancel/refund/exchange AND angry_customer raise an URGENT alert
// that gets reliably actioned — so "the team will follow up" is honest for an
// angry/serious customer too, not only the 3 request types. v41's example 6
// (angry + refund) replied "give me order details" with no follow-up promise,
// leaving an urgently-escalated customer with nothing reassuring; example 6 now
// demonstrates the team follow-up (matching example 6b). No rule changed — rule
// 5's no-callback restriction only covers info-missing questions, not angry
// complaints. Info-missing deflection (v41 behavior) is unchanged.
// v43: closed-list / anti-leading-affirmation rule (confidence-mistakes section).
// Pairs with raising the whole-KB-in-context threshold to 16000: injecting the
// whole KB fixed EXISTENCE and PRICE fabrications, but a LEADING yes/no about an
// attribute ("is the English course online?") still got a sycophantic "yes" 5/5
// even with the full KB — a framing/agreeableness bias, NOT retrieval (the same
// question asked neutrally, "online or in-person?", was correct 5/5). New rule:
// do NOT affirm an attribute just because the customer framed it that way; when KB
// enumerates the attribute (an "online courses" list, "delivery zones"), treat the
// list as EXHAUSTIVE — an item not in it does NOT have the attribute, say so
// confidently. Verified on the Damascus institute fixture (Cat 51): leading
// English/makeup online flipped 0/5 → 5/5 correct, and generalizes cross-vertical
// (electronics delivery-to-Jeddah probe passes). Necessary-but-insufficient note:
// the rule is strongest when the KB enumerates the attribute; a structured offerings
// index with explicit flags remains the durable fix for loosely-written KBs.
// v44: removed the hardcoded dialect demonstration examples (Maghrebi answer +
// Maghrebi deflection) and the gratuitous Egyptian reply on a dialect-neutral
// customer message. Hardcoded dialects in few-shot examples get parroted onto
// customers from other countries; the dialect-MIRRORING rule (kept, reinforced
// per-call) is what should drive this. Examples now show FORMAT/tone only and
// mirror the customer's own dialect — not a fixed dialect to copy.
// v45: WARMED the info-missing deflection wording WITHOUT reverting the no-callback
// rule (the #335/#341 rule — don't promise a callback on routine info_not_in_kb,
// an empty promise at scale — STANDS). The problem was the COLD wording: a clipped
// "I don't have it" + a wall of phone numbers. Now: acknowledge warmly in the
// customer's OWN dialect (mirrored, never a hardcoded one), redirect to ONE contact
// channel naturally (never a number-wall), still no callback promise. Also
// de-Levantined the rule-level seed phrase (هالمعلومة → هذه المعلومة, MSA tone-only).
// Bump invalidates exact + semantic caches holding the cold phone-dump replies.
//
// v46: re-layered the system prompt for OpenAI prompt caching (promptBuilder.ts) — the full
// KB / business-info / catalog are hoisted into a per-page-stable block right after
// STATIC_SYSTEM_PREFIX, ahead of the per-call content (language, date, chunks, post), so the
// KB sits in the cacheable prefix and is billed at the cached rate on repeat traffic instead
// of full rate every call. No field content/sanitization changed — only assembly order — but
// the prompt the model sees is reordered, so the cache is invalidated for a clean cutover.
// v47: few-shot hardening — removed the stale "بعد العيد" (after Eid) relative-date demo, and
// made the Example 11 clarifier vertical-neutral (خدمة/باقة → خيار, "services" → "offerings").
// v48: a comment on a post is now answered about the item in that post instead of a generic
// "which product?". Two minimal changes, both in the per-call block (no few-shot/static-prefix
// edit): (1) the comment channel directive now points the model at [current_post] as
// authoritative business info — mirroring the existing DM-on-post directive; (2) the
// [current_post] block is emitted whenever a post is present, no longer gated on the page
// having KB/chunks, so empty-KB merchants get the post in the system prompt (it used to survive
// only as the thin user-prompt label). No dialect handling added — the customer's own words
// remain the only dialect source. Bump invalidates caches holding the old "which product?"
// comment replies.
// v49: classifier accuracy — (1) OFFENSIVE now requires actual profanity/slurs/sexual
// harassment/threats and is judged on the CURRENT message (a benign message is not OFFENSIVE
// just because earlier turns were), fixing benign greetings/help-requests being suppressed
// as OFFENSIVE (lost leads); (2) friendly social openers ("how are you?") count as GREETING.
// Done via intent-definition edits + inline "→ INTENT" classification examples only (no new
// full few-shot blocks — verified redundant by the eval). NOTE: an earlier draft also broadened
// SPAM_OR_IRRELEVANT to "personal/off-topic requests" (poems etc.), but that nudged bare
// punctuation on engagement-CTA posts toward SPAM (losing legit engagement replies), so it was
// dropped — off-topic personal messages get a normal reply. Bump invalidates the prompt cache.
// v50: anti-robotic — restate the "end on the answer, no offer-to-help sign-off" rule at the TAIL
// of the per-call system block (buildPerCallBlock) for recency, with a stronger clause on long
// threads (the multi-turn drift that makes ~12-14% of replies end with a bot-like closing). The
// cacheable STATIC_SYSTEM_PREFIX is unchanged; this bump only invalidates the internal exact-reply
// cache so the new tail reminder isn't shadowed by stale cached replies.
// v51: gender-aware Arabic addressing, scoped to ARABIC DMs ONLY. The per-call block gains a name
// line + an ARABIC GENDER directive that matches masculine/feminine forms inferred from the name +
// the customer's self-reference, falling back to neutral phrasing when unclear. Deliberately NOT in
// the cacheable STATIC_SYSTEM_PREFIX: every other language, every comment, and every business gets a
// byte-identical prompt to v50 (guarded by blast-radius unit tests). Comments stay neutral. The exact
// cache is name-bucketed for DMs and the semantic cache is bypassed for DMs (see ai.ts) so a reply
// gendered for one customer is never served to another — flush caches on deploy.
// v52: SOURCE fix for the offer-closing bot-tell — the prompt was contradicting itself, so the ban
// lost to competing demonstrations/directives (root-caused 2026-07-05, eval Cat 61 #677). Three
// changes, all in the cacheable STATIC_SYSTEM_PREFIX / styleMap: (1) the GENERAL RESPONSE RULES no
// longer say "sometimes ask a question back" (which licensed the tic against the same block's
// offer-closing ban) — a question-back is now explicitly only-when-needed; (2) the `enthusiastic`
// style directive dropped "ask back naturally when more info would help" (a positive license the
// model followed over the negative ban) and now matches the disciplined `professional` phrasing;
// (3) two new few-shot examples DEMONSTRATE a clean flat ending — a warm mid-thread answer and an
// info-not-in-KB answer that stop on the answer (demonstrations beat rules; the prompt previously
// had no positive pattern for the common case). Prefix bytes change → cache invalidated by the bump.
// v53: the model now REPORTS its v51 gender decision as structured output — three new required JSON
// fields (`gender` m/f/unknown = the grammatical gender the reply actually addresses, `gender_basis`
// self/name/unclear = what it was decided from, `used_name` = reply embeds the customer's name in any
// script). Field definitions live in the shared RESPONSE FORMAT block (structure is grammar-enforced
// by strict structured outputs); the semantic instruction stays in the Arabic-DM per-call directive.
// The backend uses the labels to learn a fleet-wide first-name→gender consensus map and re-buckets
// the DM exact cache by learned gender (`g:m`/`g:f`) instead of per-name (`n:<hash>`) for confident
// names, restoring cross-sender cache sharing lost in v51. This bump is LOAD-BEARING for the cache:
// it atomically retires every v52 name-bucketed key so old entries can never collide with the new
// bucket semantics. Save-side is gated by the reply's own labels (never the map), so a cache hit
// stays behaviorally indistinguishable from a fresh generation.
// v54: QUANTITY MATH — prod finding from متجر إجدابيا self-test (2026-07-21). An Arabic dual-suffix
// order («كيسين» = two bags) had its quantity silently dropped: the bot totaled ONE unit (37+10=47)
// instead of two (2×37+10=84) on a PURCHASE_INTENT turn, while explicit number-words («اثنين X»)
// multiplied fine. Fix: an explicit QUANTITY RULE on the PURCHASE_INTENT step (dual suffixes,
// counting words, implied person-counts) + few-shot Example 14 demonstrating the multiplication
// (demonstrations beat rules). Eval Cat 65 pins it.
// (2) BOT IDENTITY — the prompt had NO stance on "are you human/a bot?", so the model improvised
// INCOHERENTLY: it lied "yes, I'm a real person" in English while confessing «مساعد ذكي» / «خدمة
// دردشة آلية» in Arabic (same bot, opposite answers, and the Arabic confessions slip past Check 6's
// regex → they reached customers on v53). Root-cause fix: one IDENTITY rule in GENERAL RESPONSE
// RULES giving a single cross-language stance — you're "part of the page team"; never claim human,
// never reveal automation. Rule-only (no few-shot example, no validator strip — owner ruling
// 2026-07-21). Eval Cat 66 pins it.
// Deliberately NOT addressed (owner ruling, 2026-07-21): mid-conversation «كيف أقدر أساعدك؟»
// re-greetings are left to the model — no phrase bans, no extra examples, no validator strips.
// v55: NEVER SHIPPED — reserved for the catalog-authority work while it sat uncommitted on
// feat/business-surface; that work landed as v57 instead (main had already moved to v56 by the
// time it was rebased). The gap is harmless: the version is only a cache-key namespace.
// v56: VERIFIED CART TOTALS — prod finding from متجر إجدابيا real traffic (2026-07-22). The model
// computed CORRECT totals («39 + توصيل 10 = المجموع 49») but Check 1 grounds every number against
// LITERAL KB values, so a derived total can never pass: the correct answer was swapped for the
// «تواصل معنا على أرقامنا» deflection at the exact moment of purchase, while the SAME question one
// turn earlier passed only because PURCHASE_INTENT skips the guard (intent asymmetry = symptom).
// Fix is trust-but-verify (owner ruling: structured self-report over hand-grown heuristics): a new
// required `price_math` JSON field — [{total, terms:[{unit, qty}]}] — where the model shows its
// arithmetic; replyValidator (Check 1b) verifies every unit against literal KB values and the sum,
// and verified totals/products EXTEND the accepted set for that reply only. Additive-only by
// construction: a hallucinated addend or wrong sum earns nothing, absent/malformed price_math
// degrades to the pre-v56 guard. Subtraction (discount math) is deliberately inexpressible — see
// verifiedPriceMathValues. Plus a TOTALS prompt rule: itemize-then-total, never deflect a total
// question whose components are all in KB. Eval Cat 68 replays the prod conversation.
// v57: CATALOG AUTHORITY — the two-store split (volatile facts → catalog, stable facts → KB)
// needs one winner when they disagree: merchants historically pasted price lists into the KB
// text, so after migrating to the catalog the SAME product can carry an old price in
// <business_knowledge> and the current one in <product_catalog>. New AUTHORITY paragraph in
// the <product_catalog> instruction (promptBuilder): for items listed in the catalog, its
// price/availability/dates override conflicting narrative text; items not in the catalog keep
// the KB as source. Cat 67 pins both directions (catalog wins on conflict; KB-only item still
// answered) AND the structured-facts↔narrative precedence that case 411 asserted but never
// actually tested with a disagreement (owner accuracy principle, 2026-07-14/22).
// v58: NATURALNESS PASS — owner ruling 2026-07-24: «ما بدي قيد المودل — بدي شي طبيعي بس ما
// يكون في تكرار». Prod: «أنا من فريق الصفحة» parroted 25×/4 pages; one page sent 38k persona
// greeting stems, 77% of its greeting-family replies landing in CONTINUOUS (<10 min)
// conversations. NO anti-repetition rules added — four natural moves instead:
// (1) REMOVE the copyable identity example from the IDENTITY rule (systemPrompt) — deletion,
//     the stance (team member, never claim human, never reveal automation) unchanged.
// (2) CODE: Check 6 canned fallback → small channel-neutral pool (replyValidator
//     SELF_ID_FALLBACKS; «الفريق» not «الصفحة» — WhatsApp shares the path).
//     [Pool REMOVED 2026-08-01, no version bump (code-only): a canned identity line
//     answers "who are you?" whatever the customer asked (prod, Jawab24 page —
//     «موقعكم الالكتروني» ×4 → «معك أحد أعضاء الفريق…»). Exhausted strips now return
//     EMPTY + `self_identification_exhausted`; both pipelines FLAG the row
//     `held_self_identification` and send nothing. ⚠️ The empty reply is only HALF the
//     signal — openai.ts's empty-reply guard must let it through (isHeldEmptyReply),
//     or the flag is swallowed and the withhold silently degrades to ai_empty_reply.
//     Ruling + the three traps: D-055. Partial strips unchanged.]
// (3) INFORM: the clock — minutesSinceLastMessage plumbed backend→worker (platform-generic,
//     computed from messages.created_at; WhatsApp-ready) and rendered as a fact + meaning
//     line IN THE USER PROMPT adjacent to the message («[Time since the previous message:
//     3 days — the customer is RETURNING…]»). ⚠️ Placement is the finding: the SAME line in
//     the system prompt was ignored across three replay iterations — message-adjacent, the
//     3-days+open-order return got a true resume («جاهزة نكمل طلبك ونوصلك زوز قطع…») per the
//     owner's resume ruling. Same attention lesson as customerContext. Only set on the
//     with-history path, which skips ALL reply caches — no cache-key changes needed.
//     Companion: the STEP-2 GREETING rule was unconditional («Greet back naturally») — the
//     very rule forcing the reset; now context-aware (new customer → greet; mid-conversation
//     / returning → pick the conversation back up, never reset to "how can I help?").
// (4) REFRAME: brand voice injected as identity («this is WHO YOU ARE — speak as this person
//     naturally would») instead of "guidelines to follow" — actors don't copy-paste their
//     lines; instruction-executors do. Mid-conversation CRITICAL do-not-repeat sentence kept
//     BYTE-IDENTICAL (eval #158 A/B: extending it broke offer non-repetition — never fold
//     text into that sentence).
// Explicit rules (opener/closer rotation etc.) remain LAST RESORT, preserved un-applied in
// .planning/patches/v58-prompt-work-2026-07-24.patch, only if prod metrics still show
// repetition after this pass.
// v59: IDENTITY SELF-REPORT (Check 6 root-cause fix, 2026-07-24). Diagnosed via eval
// #236: Check 6's regex treated ANY «ذكاء اصطناعي» mention as an automation reveal, so a
// faithful Galaxy-S24 spec answer («كاميرا مع ذكاء اصطناعي») was nuked to the self-id
// fallback pool — live in prod for every merchant selling AI-featured products, and
// invisible because Check 6 mutated replies silently. "Who is the AI in this sentence?"
// is a meaning question a regex can't answer (an interim pronoun heuristic needed dialect
// patches within the hour — the marker-list treadmill). The model now answers it itself:
// new structured flag `self_identified_as_automation` (set only when the reply describes
// the RESPONDER as automated, never for product AI features); the validator strips the
// ambiguous vocabulary (AI terms + روبوت — robot vacuums are PRODUCTS) only when that flag
// is set, keeps truly decisive strings unconditional (brand, "chatbot", EN "bot" outside
// "robot", plus a closed MSA/English first-person tripwire «أنا روبوت»/"I'm a bot" — owned,
// bounded, never dialect-extended: dialect reveals ride the flag), and records every swap
// with a validator-added `self_identification_stripped` flag — deliberately merchant-visible
// (flag_reason chip + needs-attention + cache-blocked), never a silent mutation again.
// v60 (2026-07-25): the DM addressing line now carries the customer's WHOLE profile
// name instead of its first whitespace token, and asks the model to pick the address
// form itself. First-token truncation addressed a customer as «يا أبو» (prod — the
// kunya «أبو حسان» minus the part that makes it a name) and does the same to «عبد
// الرحمن». Arabic-DM-with-a-name traffic only; every other prompt is byte-identical.
// v61 — BUSINESS_INFO carries the merchant's WhatsApp contact
// (`channels.whatsapp`). The field had existed on the type since Stage 2.6 but
// was read by NOTHING: no prompt, no backend, no worker. B1 gives it a fact row,
// so it now has to reach the model or the merchant fills in a value that can
// never be told to anyone. Emitted PRESENT-ONLY (no [NOT_PROVIDED] counterpart)
// so the prompt is byte-identical for every merchant who hasn't set one.
// ⚠️ This block was authored as v60 on the B1 branch while #502 independently
// took v60 on main for the name-truncation fix above. Renumbered to v61 on merge:
// PROMPT_VERSION keys the semantic cache, so shipping two different prompts under
// one version would have served #502's cached replies for this change.
// v62 is RESERVED, deliberately skipped here: the in-flight G1a fact-collections
// work (<business_lists> block) is already authored as v62 and not yet merged.
// Taking v62 for this change would force that branch to renumber, and the v60/v61
// collision above is what happens when two prompts share one version — the cache
// serves the other change's replies. A GAP is harmless (the value is a cache key
// and a telemetry tag, never compared for order); a DUPLICATE is not.
// v63 — the no-answer reply carries the page's own voice instead of a stock
// sentence. "هذه المعلومة غير متوفرة لدي حالياً" shipped as the literal `reply` of
// few-shot Example 4, so the model reproduced it: seen twice in one prod
// conversation (إجدابيا, 2026-07-28) answering «موجود مخمليه بودي» / «مخمريه» in
// flat MSA, on a page whose own Business Info opens with «التحدث باللهجة الليبية
// مع الزباين». Two failures in one string — it reads as a machine, and it drops
// the merchant's persona.
// The operative variable was NOT how many times the sentence appeared in the
// prompt. On entering the info_not_in_kb path the model looks for a successful
// example OF THAT PATH, and the only Arabic one was that sentence. So the fix is
// to make that single example worth imitating: it is now a PRODUCT question (the
// failure mode that actually occurs — the English Example 2 was already fine),
// and its reply names the product without inferring absence.
// Expected and accepted: the model will generalise the SHAPE «ما عندي معلومة عن
// ‹X›» into a new default rather than composing freshly every time. That is the
// goal, not a regression — the new default names the subject, cannot assert
// non-existence, and leaves room for the customer's dialect. It does mean the
// example's wording is a fleet-wide template decision, so it stays pan-Arabic
// (readable for Egyptian, Gulf, Levantine and Maghrebi customers alike).
// Also removed the sentence from the four rule sites that restated it, and
// deliberately did NOT keep a "never say X" mention: restating the string adds
// nothing the shape rules don't already cover, and a paraphrasing model routes
// around literal blocklists anyway — proven in this very prompt, where the
// closing-phrase rule banned that shape and was ignored while an example
// contradicted it.
// v64 (2026-07-29) — the reply-language directive is now provenance-aware.
// Reported bug: an Arabic-KB training institute on WhatsApp answered
// «Quels cours proposez-vous ?» in English (the Turkish and English messages in
// the same thread were both handled correctly). Cause was NOT detection: the
// detector returns en@0.5 for accent-free French — its "Latin script, recognized
// nothing" floor, 68.77% of Latin-script inbound traffic — and the per-call block
// asserted that non-detection to the model as fact ("The customer wrote in
// English. Do NOT switch to another language"). The model knew it was French and
// obeyed us. Now the hard assertion is emitted ONLY for a positive reading of the
// customer's current message; for a floor read / history anchor / post / KB /
// merchant default the directive keeps that language as the DEFAULT but tells the
// model to mirror the customer's own language, which it identifies far better than
// our heuristic can. Both variants carry the same explicit ban on letting
// <business_knowledge>'s language drive the reply.
// v65 — G1a: the <business_lists> block reaches the model. (Authored as v62; #527
// took v63 for the no-answer wording change while this branch was open, and two
// different prompt shapes must never share one version — the same collision the
// v60/v61 note above records, so this renumbered on rebase. Renumbered AGAIN v64 → v65 on the 2026-07-30 merge: main had meanwhile shipped a different prompt under v64, the language-provenance
// change recorded directly below.) Enumerable LIST facts
// (outlets, coverage areas, delivery zones) are rendered from fact_collections
// with a DERIVED coverage/absence statement per list, plus the attribution rules
// that make the model follow it (never re-attribute an entry to a key it doesn't
// carry; the business's own address is not a list entry). Measured mechanism:
// fabrication on absent-place questions 9/32 → 0/32 on the distributor fixture at
// prod sampling, grounded answers intact (2026-07-28).
// The block is gated on the page HAVING collections, so the rendered prompt is
// byte-identical for every page without them — but the version still bumps: pv
// keys the semantic cache and its rows record it, and two different prompt shapes
// living under one version is exactly what that key exists to prevent (see the
// v60/v61 collision noted above). One bump for the whole milestone — the plan's
// «One prompt bump, not three» rule; opfacts/C-F1/G5 must not add their own.
// v66 (2026-08-01) — lead-answer continuity: a bare name answering OUR OWN
// details request is never spam and never a new topic. Prod (الدمشقي, 2026-08-01
// 01:5x): assistant asked «زوديني باسمك ورقمك ونوع الدورة», the customer answered
// «وئام الدوخة» (her full name), and the reply re-greeted and read the surname as
// the symptom "dizziness" («كيف فيني أساعدك بخصوص الدوخة؟»). Local repro was
// WORSE: the same turn classified SPAM_OR_IRRELEVANT@high 4/4 → silent skip,
// which also returns before maybeCaptureLead — the customer gets silence right
// after being asked for her name, and the name never reaches the lead either.
// The model already handles the pattern when the first name is common («عبير
// الخياط» → «شكراً عبير! شو نوع الدورة...») — the failure is name-dependent, so
// the fix teaches the TURN SHAPE, not names — and it is ONE few-shot example,
// no new rule: Example 15 demonstrates acknowledge-then-ask-for-remaining-fields
// with an invented noun-surname («ليلى الحداد»). A companion classification
// override ("YOU asked, they answered") was AUTHORED, MEASURED, AND REMOVED
// (owner ruling 2026-08-01: stop growing the rule list — the v63 lesson is that
// the example is what the model imitates). Both variants pass the full battery
// (5/5 stability on the prod turn, probes, spam-in-same-position control,
// Cats 71/3/16/8 green). Two adjacent observations from the probe battery:
// (1) "Latin-script bare name → English reply" looked like a prod issue but was
// a PLAYGROUND-ONLY artifact — generateForPlayground asserted the detector's
// en@0.5 Latin floor as an explicit language while production's
// defer-to-history sent none; fixed in the same PR by extracting
// resolveDmLanguageHint as the shared choke point for both paths (pinned by
// eval #748 and deferToHistory.test.ts). (2) a bare course word («تمريض»)
// answers with the KB's contact numbers instead of course details (3/3) —
// real, pre-existing, out of scope here. Pinned by eval Cat 71 (Lead-Answer
// Continuity, #745–748 — prod replay incl. the recovery turn).
// v67 (2026-08-03) — NO price or plan data may live in the static prompt (owner
// ruling). Two independent prod leaks proved the class, not the instance:
// (1) Example 9's illustrative data was our REAL plan sheet (Starter/Business/
// Pro at $15/39/79) — متجر إجدابيا (2026-08-01, 3×) answered a bare «السعر» with
// «عندنا 3 باقات: المبتدئ – 15$ شهرياً…»: a Libyan incense customer quoted OUR
// SaaS tiers. Not a cache leak (cached=false, page-scoped keys); the page's own
// prices (15/39/79 دينار) coincided with the example's numbers, which also let
// the copy sail through Check 1 — all three numbers ARE in that KB. (2) Example
// 1's fictional «باقة الورد - 150 ريال» — the Jawab24 support page (2026-03-30,
// 8 replies) sold it as a real offering («عنا عدة باقات: باقة الورد – 150 ريال
// • باقة الفل – 250 • باقة الياسمين – 350»), inventing two sibling plans to
// complete the sheet. Same defect class as v63 (the example is the template the
// model reaches for when the KB is thin or resonates), and catalog-shaped
// name+price rows are its highest-harm form: they masquerade as the business's
// own offering and Check 1 cannot flag a number the KB happens to contain.
// Fix: every example's reply is now SELF-GROUNDING — no fact survives copying.
// Ex 1 quotes distinctive fixture hours (9:30–7) instead of a price row; Ex 9
// keeps the enumerate-ALL-then-stop DM shape on a colors list (price lists
// explicitly follow the same shape, data from <business_knowledge>); Ex 14
// keeps the dual-suffix lesson (علبتين = TWO) by echoing the customer's own
// quantity and requesting order details — the multiplication contract already
// lives in the PURCHASE_INTENT QUANTITY RULE and the price_math flag spec, and
// v54's prod evidence shows the model totals correctly without a worked demo
// (the old guard, not the model, was what nuked totals). Examples 7/12 (Riyadh
// delivery scope, ٣-month duration) were swept in prod and have never leaked;
// left as-is deliberately — non-price, and the honest-partial-match lesson
// needs concrete data. Pinned by eval Cat 73 (752/753 incense prod replay,
// 754 support-page plan question); Cat 68 re-run gates the Ex-14 change.
export const PROMPT_VERSION = 'v67';

/** The 8 valid AI intent categories. GPT must return one of these. */
export const VALID_AI_INTENTS = [
    'QUESTION', 'COMPLIMENT', 'COMPLAINT', 'PURCHASE_INTENT',
    'GREETING', 'BUSINESS_INQUIRY', 'OFFENSIVE', 'SPAM_OR_IRRELEVANT',
] as const;
export type AiIntent = (typeof VALID_AI_INTENTS)[number];

/**
 * Map non-standard GPT-invented intents to the closest valid intent.
 * GPT-4o-mini sometimes ignores the taxonomy and invents custom intents
 * like PRICE, LOCATION, HOURS, OTHER, etc. This map provides a code-level
 * safety net so that downstream guards (hallucination, skip, needsAttention)
 * still work correctly.
 */
export const INTENT_NORMALIZATION_MAP: Record<string, AiIntent> = {
    // Question-like intents GPT invents
    'PRICE': 'QUESTION',
    'PRICING': 'QUESTION',
    'LOCATION': 'QUESTION',
    'HOURS': 'QUESTION',
    'AVAILABILITY': 'QUESTION',
    'PRODUCT': 'QUESTION',
    'PRODUCT_QUESTION': 'QUESTION',
    'OFFERING_INFO': 'QUESTION',
    'INFO_OFFERING': 'QUESTION',
    'SERVICE': 'QUESTION',
    'POLICY': 'QUESTION',
    'INFO': 'QUESTION',
    'INFORMATION': 'QUESTION',
    'INQUIRY': 'QUESTION',
    // Sentiment-like
    'POSITIVE': 'COMPLIMENT',
    'PRAISE': 'COMPLIMENT',
    'NEGATIVE': 'COMPLAINT',
    'FEEDBACK': 'COMPLAINT',
    // Purchase-like
    'ORDER': 'PURCHASE_INTENT',
    'BUY': 'PURCHASE_INTENT',
    'BOOKING': 'PURCHASE_INTENT',
    // Greeting-like
    'HELLO': 'GREETING',
    'HI': 'GREETING',
    // Offensive-like
    'ABUSE': 'OFFENSIVE',
    'INSULT': 'OFFENSIVE',
    'PROFANITY': 'OFFENSIVE',
    // Spam-like
    'SPAM': 'SPAM_OR_IRRELEVANT',
    'IRRELEVANT': 'SPAM_OR_IRRELEVANT',
    'PROMO': 'SPAM_OR_IRRELEVANT',
    'SELF_PROMOTION': 'SPAM_OR_IRRELEVANT',
    'PROMOTION': 'SPAM_OR_IRRELEVANT',
};

/**
 * Normalize a raw AI intent to one of the 8 valid intents.
 * Returns the normalized intent, or the original (uppercased) if no mapping exists.
 */
export function normalizeAiIntent(rawIntent?: string): string | undefined {
    if (!rawIntent) return undefined;
    const upper = rawIntent.trim().toUpperCase();
    if (!upper) return undefined;
    if ((VALID_AI_INTENTS as readonly string[]).includes(upper)) return upper;
    return INTENT_NORMALIZATION_MAP[upper] || upper;
}

// --- Order Notification Types ---
export type OrderNotificationType =
  | 'abandoned_cart'
  | 'order_confirmed'
  | 'order_shipped'
  | 'order_delivered'
  | 'review_request'
  | 'digital_delivery';

export interface NotificationTemplate {
  id: string;
  ecommerceStoreId: string;
  notificationType: OrderNotificationType;
  messageAr: string;
  messageEn: string;
  isEnabled: boolean;
  delayMinutes: number;
  channel: string;
  includeCoupon: boolean;
  couponCode: string | null;
  couponDiscount: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationStats {
  total: number;
  sent: number;
  failed: number;
  byType: Record<string, number>;
}

// --- E-commerce Types (Shopify, Salla, Zid) ---
export interface EcommerceStore {
  id: string;
  userId: string;
  platform: 'shopify' | 'salla' | 'zid';
  storeDomain: string;
  storeName: string | null;
  storeEmail: string | null;
  storeCurrency: string | null;
  tokenExpiresAt: Date | null; // null = never expires (Shopify)
  productCount: number;
  productSummary: string | null;
  policiesSummary: string | null;
  lastSyncAt: Date | null;
  isActive: boolean;
  installedAt: Date | null;
  /**
   * Health of the platform's webhook registration, derived from
   * `platform_data.webhookStatus` on the backend. Surfaced so the integrations
   * card can render a "Re-register webhooks" CTA when retries have exhausted.
   * - 'ok'      — every topic registered, nothing pending
   * - 'pending' — some topics failed but retries are still in flight
   * - 'failed'  — retries exhausted; merchant action required
   * - 'unknown' — legacy row that predates webhookStatus tracking
   */
  webhookHealth: 'ok' | 'pending' | 'failed' | 'unknown';
  /**
   * True when the store's OAuth token can no longer be refreshed — the refresh
   * token was consumed/revoked and the platform rejected it with a permanent 400
   * (invalid_grant). Derived from `platform_data.tokenHealth`. Surfaced so the
   * integrations card can prompt the merchant to reconnect; cleared automatically
   * on the next successful token write. Shopify tokens never expire, so this stays
   * false for Shopify.
   */
  needsReauth: boolean;
}

export interface EcommerceProduct {
  id: string;
  ecommerceStoreId: string;
  platformProductId: string;
  handle: string | null;
  title: string;
  description: string | null;
  productType: string | null;
  vendor: string | null;
  status: string;
  priceRange: string | null;
  currency: string | null;
  totalInventory: number;
  hasVariants: boolean;
  variantSummary: string | null;
  tags: string | null;
  imageUrl: string | null;
}

export interface EcommerceSyncJobData {
  ecommerceStoreId: string;
  platform: 'shopify' | 'salla' | 'zid';
  jobType: 'full_sync' | 'product_update';
  platformProductId?: string; // For incremental product_update
}

// Redis queue key — value intentionally kept as 'shopify-sync-queue' for backward compatibility
export const ECOMMERCE_SYNC_QUEUE_NAME = 'shopify-sync-queue';

// --- Post Suggestion Queue («بوست اليوم» generation, off the request path) ---
/**
 * The row is created BEFORE the job is queued, so the job carries only its id
 * plus what the request decided. Everything else the worker re-reads from the
 * database — a job payload that duplicates page state would go stale the moment
 * the merchant edits their Business Info between request and fulfilment.
 */
export interface PostSuggestionJobData {
  suggestionId: string;
  /** Carried purely so the queue is readable without a DB lookup. */
  pageId: string;
  /** Merchant toggle for the code-composed contact footer, as at request time. */
  includeContact: boolean;
}

export const POST_SUGGESTION_QUEUE_NAME = 'post-suggestion-queue';

// --- Post Sync Queue (Facebook Posts backfill) ---
export interface PostSyncJobData {
  pageId: string; // Internal page UUID
  limit?: number; // Number of recent posts to fetch (default 25)
}
export const POST_SYNC_QUEUE_NAME = 'post-sync-queue';

// --- Post Suggestions («بوست اليوم» pilot) ---
// ONE AI-suggested post per page per day; regenerate replaces it. Shared so
// the backend service/controller and the frontend api client speak one shape.
export type PostSuggestionPostType = 'promo' | 'product_spotlight' | 'faq_tip' | 'hours_reminder' | 'general';
export type PostSuggestionEvent = 'opened' | 'copied' | 'downloaded';

/** How many takes one generation produces. One paid image call serves them all. */
export const POST_SUGGESTION_VARIANT_COUNT = 3;

/**
 * One take on the day's subject. A generation returns several and the merchant
 * picks — the industry norm (Meta Business Suite drafts 3–5 captions; Copy.ai,
 * Predis and Ocoya all return sets) and the fix for the failure observed in
 * prod on 2026-08-11, where a page's best post of the day was destroyed by its
 * own next regenerate.
 *
 * The takes differ in TEXT and HEADLINE only. They share one generated scene:
 * the image model costs money and its steering is measured not to work on this
 * model, while re-typesetting a headline over the same base is local sharp work
 * at no cost — so three cards look distinct without three image calls.
 */
export interface PostSuggestionVariant {
  text: string;
  /** The 2–5 Arabic words typeset ON this take's card. Null = card shipped scrim-only. */
  headline: string | null;
  imageUrl: string | null;
}

/**
 * Where a generation is in its life.
 *
 * `pending` exists because the work takes ~35s — far past the 5s at which the
 * industry standard says return at once and notify — and nginx cuts this route
 * at 30s regardless. So the request now CLAIMS its slot, stores a pending row
 * and returns; a worker fills it in. Clients render pending as "preparing"
 * rather than blocking on a spinner that cannot outlive the proxy.
 *
 * `failed` is a terminal, visible outcome: the merchant's slot was spent, so
 * silently leaving the row pending forever would be a lie about their balance.
 */
export type PostSuggestionStatus = 'pending' | 'ready' | 'failed';

export interface PostSuggestionDto {
  id: string;
  status: PostSuggestionStatus;
  /**
   * Why this generation shipped text-only, absent when it has an image.
   *
   * Lives on the SUGGESTION rather than the response envelope because the
   * generation that knows it now finishes in a worker, long after the request
   * that triggered it returned — so every route that can serve the row must be
   * able to serve the reason with it, and there is exactly one source for it.
   */
  imageDegraded?: PostSuggestionImageDegraded;
  /** The SELECTED take's text — also what pre-variants clients render. */
  text: string;
  imageUrl: string | null; // null = text-only (image degraded / cleaned up)
  /**
   * Every take of this generation, selected one included. Always at least one
   * element: rows generated before variants shipped project to a single take,
   * so clients never branch on "old row" vs "new row".
   */
  variants: PostSuggestionVariant[];
  /** Index into `variants` — which take `text`/`imageUrl` currently mirror. */
  selectedVariant: number;
  postType: PostSuggestionPostType;
  source: 'cron' | 'manual';
  suggestedFor: string; // ISO date (UTC day)
  createdAt: string; // ISO timestamp
}

/** Why a suggestion shipped text-only: the image call failed vs. object storage is off. */
export type PostSuggestionImageDegraded = 'image_failed' | 'storage_off';

/**
 * An earlier post of the same page — kept, not destroyed.
 *
 * Creating another post used to gut the one before it: the row was flipped to
 * `superseded` and its image FILES were deleted from storage. That lost the
 * merchant's work (production, 11 Aug: three attempts, the first was the best,
 * the third erased it) and it was backwards economically — an image costs
 * ~$0.0064 to generate and a fraction of a cent a year to keep.
 *
 * Deliberately NOT a full `PostSuggestionDto`: history is a list to pick from,
 * not a set of rows to operate on, so it carries only what the strip renders.
 * Anything needing more re-reads the row by id.
 */
export interface PostSuggestionHistoryItem {
  id: string;
  /** The selected take's text at the time it was superseded. */
  text: string;
  imageUrl: string | null; // null = text-only (image failed / storage off)
  postType: PostSuggestionPostType;
  createdAt: string; // ISO timestamp
}

/**
 * The most recent generation attempt that is NOT a post — still running, or
 * finished without producing one.
 *
 * Split out from `suggestion` on 2026-08-13. Both used to be the same field:
 * the read served the newest row of any non-superseded status, so a `failed`
 * row — newer than the post it did not replace — became "the current post".
 * With the day scope gone that is permanent: the merchant's real post is
 * masked (and absent from `history`, which is superseded rows only) until they
 * happen to generate again, and a page whose one-time SEED failed shows an
 * empty card forever, since the seed predicate is "has any row".
 *
 * So the two questions are answered separately: `suggestion` is what you HAVE,
 * this is what is HAPPENING. Null when the newest row is the post itself.
 *
 * Carries only what a client acts on — the id to poll and the state to render.
 * `failureReason` is deliberately absent: the UI shows one generic message (a
 * reason code is an operator's signal, and it is already in the row + logs).
 */
export interface PostSuggestionInFlight {
  id: string;
  status: 'pending' | 'failed';
}

/**
 * The ONE response envelope both GET /today and POST (generate) return — the
 * backend controller and the frontend api client type against THIS, so the two
 * hand-assembled shapes can never drift apart silently.
 */
export interface PostSuggestionResponse {
  /**
   * The page's current post — always a READY row, or null if it has never
   * produced one. Never a pending or failed row: those are `inFlight`.
   *
   * Older shipped bundles read only this field, so the split degrades in the
   * safe direction for them — while a generation runs they keep showing the
   * previous post instead of the empty-text pending row, and a failed attempt
   * leaves that post on screen instead of replacing it with nothing.
   *
   * ⚠️ The one cost of that: a client which cannot see `inFlight` also cannot
   * see that a generation is RUNNING, so during a blue/green window it may
   * offer to start another and spend a second capped slot. Bounded by the
   * daily cap and by the length of the window; accepted rather than served a
   * pending row as a post, which is the defect this split exists to remove.
   */
  suggestion: PostSuggestionDto | null;
  /**
   * The latest attempt, when it is not (yet) a post. Sent by BOTH routes —
   * generate answers with the pending row it just claimed. Absent/null means
   * the newest row IS the post above.
   */
  inFlight?: PostSuggestionInFlight | null;
  /**
   * Slots left today. `null` = unknown (the read path's cap store was
   * unreachable) — clients keep regenerate enabled and let the generate path
   * fail closed server-side; never conflate "unknown" with "exhausted".
   */
  remainingToday: number | null;
  /**
   * Angles this page's data can deliver. Sent by BOTH routes; clients treat an
   * absent list as UNKNOWN and fail closed (only 'general' offered).
   */
  availableTypes?: PostSuggestionPostType[];
  /**
   * The page's earlier posts, newest first — capped, because this rides on the
   * card fetch.
   *
   * ⚠️ READ ROUTE ONLY, on purpose. Generate answers with a PENDING row and the
   * worker supersedes the previous post seconds afterwards, so a list built at
   * generate time is one behind by construction; the client is already polling
   * the read route, which answers it correctly. Absent therefore means "this
   * response doesn't carry history", NEVER "this page has none" — an empty
   * array means that, and the two must not be confusable. Clients keep whatever
   * they last held when the field is absent.
   */
  history?: PostSuggestionHistoryItem[];
}

// --- Leads Types ---
export type LeadStatus = 'new' | 'contacted' | 'converted';
export type LeadSourceType = 'message' | 'comment';
export type LeadExtractionStatus = 'completed' | 'pending' | 'failed';

// --- Lead Stages (customizable sub-stages) ---
// The three main stages above are fixed (the pipeline, counters, and AI
// extraction depend on 'new'). Merchants customize by defining SUB-STAGES
// under each main stage — free-text labels so the feature stays generic
// across business types (store: "تم الشحن/تم التسليم", clinic: "حجز موعد",
// institute: "سجّل بالدورة", ...). Stored per workspace in settings JSONB.
export const LEAD_STAGE_COLORS = ['blue', 'amber', 'emerald', 'rose', 'violet', 'cyan', 'orange', 'slate'] as const;
export type LeadStageColor = typeof LEAD_STAGE_COLORS[number];

export interface LeadSubStage {
  /** Stable id (uuid) — stored on the lead so renaming a sub-stage doesn't orphan it. */
  id: string;
  /** Merchant free-text label, any language. */
  label: string;
  color: LeadStageColor;
}

/** Sub-stages per main stage. Missing key = no sub-stages for that stage. */
export type LeadStagesConfig = Partial<Record<LeadStatus, LeadSubStage[]>>;

/** Hard limits enforced server-side when saving leadStages. */
export const MAX_SUB_STAGES_PER_STAGE = 20;
export const MAX_SUB_STAGE_LABEL_LENGTH = 60;

// --- Lead Custom Fields (merchant-defined per-lead data) ---
// Stages answer "where is this lead?"; custom fields answer "what do I need
// to WRITE about it?" — e.g. المبلغ المدفوع, الخصم, رقم الطلب. Field
// definitions live in workspace settings (same JSONB pattern as leadStages);
// each lead stores its values keyed by field id, so renaming a field never
// orphans the data.
export interface LeadCustomFieldDef {
  /** Stable id (uuid) — values on leads are keyed by it. */
  id: string;
  /** Merchant free-text label, any language. */
  label: string;
}

/** Values on a lead, keyed by LeadCustomFieldDef.id. */
export type LeadCustomFieldValues = Record<string, string>;

/** Hard limits enforced server-side when saving leadFields / field values. */
export const MAX_LEAD_CUSTOM_FIELDS = 10;
export const MAX_LEAD_FIELD_LABEL_LENGTH = 60;
export const MAX_LEAD_FIELD_VALUE_LENGTH = 500;

// --- Effective lead config (per-page override with workspace fallback) ---
// leadStages/leadFields are configured at the workspace level, but a page may
// optionally OVERRIDE either slice for itself. The effective config a lead's
// UI and validation use is: page override ?? workspace default. A null/undefined
// override means "inherit the workspace config"; an empty {}/[] is a deliberate
// override (the merchant cleared that slice for this page). These two pure
// resolvers are the single source of truth — both backend (validation) and
// frontend (rendering) call them so the semantics never drift.
// Deliberate return-type asymmetry: stages may be `undefined` (no sub-stages →
// callers guard with `stages?.[status] ?? []`), while fields always resolves to
// an array, so field callers never need a null-check.
export function resolveEffectiveLeadStages(
  pageOverride: LeadStagesConfig | null | undefined,
  workspaceDefault: LeadStagesConfig | undefined,
): LeadStagesConfig | undefined {
  return pageOverride ?? workspaceDefault;
}

export function resolveEffectiveLeadFields(
  pageOverride: LeadCustomFieldDef[] | null | undefined,
  workspaceDefault: LeadCustomFieldDef[] | undefined,
): LeadCustomFieldDef[] {
  return pageOverride ?? workspaceDefault ?? [];
}

// --- Reply mode (per-page override with workspace fallback) ---
// 'sales' = today's behavior: the AI asks purchase-intent customers for their
// name/phone and may promise team follow-up on complaints (lead capture active).
// 'info' = information desk: the AI never asks the customer for contact details
// and never promises follow-up — it routes the customer to the business's own
// channels instead. Volunteered numbers are still stored (passive capture); only
// push alerts are suppressed. Same override semantics as leadStages/leadFields:
// page NULL/undefined = inherit the workspace default; an explicit page value is
// a deliberate pin that survives a workspace-level flip.
export type ReplyMode = 'sales' | 'info';

export const REPLY_MODES: readonly ReplyMode[] = ['sales', 'info'] as const;

export function resolveEffectiveReplyMode(
  pageOverride: ReplyMode | string | null | undefined,
  workspaceDefault: ReplyMode | string | undefined,
): ReplyMode {
  const page = pageOverride === 'sales' || pageOverride === 'info' ? pageOverride : undefined;
  const ws = workspaceDefault === 'sales' || workspaceDefault === 'info' ? workspaceDefault : undefined;
  return page ?? ws ?? 'sales';
}

/**
 * The placeholder phone used inside the INFO-DESK prompt block's
 * counter-demonstrations (ai-worker promptBuilder). Deliberately an
 * all-zero-tail number no operator allocates: if the model ever echoes the
 * EXAMPLE's number instead of the page's own BUSINESS_INFO phone, that leak
 * must be (a) harmless to a real customer and (b) mechanically detectable.
 * Eval guards assert replies never contain any of these tokens — a fixture
 * page must therefore never use them as its own phone (finding E-1).
 */
export const INFO_DEMO_PHONE = '0900000000';

export const INFO_DEMO_LEAK_TOKENS: readonly string[] = [INFO_DEMO_PHONE] as const;

export interface LeadField {
  key: string;
  label_en: string;
  label_ar: string;
  value: string;
}

export interface LeadExtractedData {
  summary?: string;
  fields: LeadField[];
}

export interface Lead {
  id: string;
  pageId: string;
  sourceType: LeadSourceType;
  sourceId: string | null;
  senderId: string;
  senderName: string | null;
  phone: string;
  extractedData: LeadExtractedData;
  status: LeadStatus;
  /** Id of a LeadSubStage from the workspace's leadStages config, or null. */
  subStage: string | null;
  /** Merchant-entered values for the workspace's leadFields, keyed by field id. */
  customFields: LeadCustomFieldValues | null;
  extractionStatus: LeadExtractionStatus;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// --- Workspace / Team Types ---
export type WorkspaceRole = 'owner' | 'admin' | 'member';

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
}

export interface Workspace {
  id: string;
  ownerId: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  settings: WorkspaceSettings;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: string | Date | null;
  invitedBy: string | null;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  email: string | null;
  phone: string | null;
  role: WorkspaceRole;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: string | Date;
  usedAt: string | Date | null;
  createdAt: string | Date | null;
}

/** Shape of the JSONB `settings` column on the workspaces table */
export interface WorkspaceSettings {
  defaultReplyLanguage: string;
  supportedLanguages: string[] | null;
  autoDetectLanguage: boolean;
  aiEnabled: boolean;
  aiModel: string;
  commentReplyMode: string;
  dualReplyNudge: string | null;
  /** Smart Reply comments: the page likes the customer's comment after replying (Facebook only; suppressed for flagged/negative comments). */
  likeComments: boolean;
  commentsAutoReply: boolean;
  messagesAutoReply: boolean;
  businessHoursOnly: boolean;
  businessHoursStart: string;
  businessHoursEnd: string;
  timezone: string;
  greetingMessageMulti: Record<string, string>;
  /** When false, the configured greeting is never sent — AI handles the first message directly. */
  greetingMessageEnabled: boolean;
  awayMessageMulti: Record<string, string>;
  /** Master switch — when false, no reply is sent at the monthly limit (silent + flag). */
  limitFallbackEnabled: boolean;
  /** Custom reply when the monthly Smart Reply quota is exhausted. Used only when limitFallbackEnabled is true. */
  limitFallbackMessageMulti: Record<string, string>;
  dualReplyNudgeMulti: Record<string, string>;
  dualReplyNudgeVariations?: Record<string, string[]>;
  replyDelay: number;
  commentEscalationMinutes: number;
  messageEscalationMinutes: number;
  handoffPauseDurationMinutes: number;
  replyStyle: 'professional' | 'casual' | 'enthusiastic';
  /** Workspace default reply mode; pages may override (pages.reply_mode, NULL = inherit). */
  replyMode: ReplyMode;
  brandVoiceNotes: string;
  brandVoiceNotesMulti: Record<string, string>;
  holdLowConfidence: boolean;
  /** Customizable lead sub-stages per main stage (see LeadStagesConfig). */
  leadStages?: LeadStagesConfig;
  /** Merchant-defined per-lead data fields (see LeadCustomFieldDef). */
  leadFields?: LeadCustomFieldDef[];
}

/**
 * Every key `workspaces.settings` may hold — the write allowlist for
 * `PUT /workspaces/current/settings`, which merges its body into that JSONB
 * column. Without it, any admin-role member could plant arbitrary keys in the
 * workspace's settings blob — including field names that have not shipped yet,
 * silently pre-seeding a future feature's stored state.
 *
 * Declared as `Record<keyof WorkspaceSettings, true>` rather than a plain
 * array so BOTH drift directions are compile errors: a new WorkspaceSettings
 * field missing here fails tsc (missing property), and a key here that is not
 * on the interface fails too (excess property).
 */
const WORKSPACE_SETTINGS_KEY_MAP: Record<keyof WorkspaceSettings, true> = {
  defaultReplyLanguage: true,
  supportedLanguages: true,
  autoDetectLanguage: true,
  aiEnabled: true,
  aiModel: true,
  commentReplyMode: true,
  dualReplyNudge: true,
  likeComments: true,
  commentsAutoReply: true,
  messagesAutoReply: true,
  businessHoursOnly: true,
  businessHoursStart: true,
  businessHoursEnd: true,
  timezone: true,
  greetingMessageMulti: true,
  greetingMessageEnabled: true,
  awayMessageMulti: true,
  limitFallbackEnabled: true,
  limitFallbackMessageMulti: true,
  dualReplyNudgeMulti: true,
  dualReplyNudgeVariations: true,
  replyDelay: true,
  commentEscalationMinutes: true,
  messageEscalationMinutes: true,
  handoffPauseDurationMinutes: true,
  replyStyle: true,
  replyMode: true,
  brandVoiceNotes: true,
  brandVoiceNotesMulti: true,
  holdLowConfidence: true,
  leadStages: true,
  leadFields: true,
};

/** All writable workspace-settings keys (derived from the compile-checked map). */
export const WORKSPACE_SETTINGS_KEYS = Object.keys(WORKSPACE_SETTINGS_KEY_MAP) as (keyof WorkspaceSettings)[];

/** Whether `key` names a writable workspace-settings field. */
export function isWorkspaceSettingsKey(key: string): key is keyof WorkspaceSettings {
  return Object.prototype.hasOwnProperty.call(WORKSPACE_SETTINGS_KEY_MAP, key);
}

// --- Business Info structured prompt block (Stage 2.6) ---
export { formatBusinessInfoPrompt, whatsappNumbers, businessPhoneEntries, businessPhoneList, isFieldAuthoritative } from './businessInfoPrompt';
// --- Merchant contact standard: number + optional free-text description ---
export { normalizePhoneEntry, normalizePhoneEntries, sanitizePhoneDescription, phoneEntryNumber, phoneEntryDescription, isUsablePhoneEntry, MAX_PHONE_DESCRIPTION_LENGTH } from './businessPhone';
export type { BusinessPhone, BusinessPhoneEntry } from './businessPhone';
export { applyFbSyncToMerchant, applyMerchantEdit, applyKbExtractToMerchant, classifyForMigration, hasTrackedField, TRACKED_FIELDS } from './businessProfileMerge';
export type { MerchantProvenanceMap, FieldProvenance, ProvenanceSource, MigrationPlan } from './businessProfileMerge';
// --- Business hours canonicalizer (Stage 2.6) ---
export { canonicalizeHoursEntry, canonicalizeHoursWeek, isValidDayKey, dayOrderIndex, SHORT_DAY_KEYS, LONG_DAY_KEYS, DAY_LABELS_EN, DAY_LABELS_AR } from './businessHours';
export type { CanonicalHoursEntry, ParseResult, ParseSuccess, ParseFailure } from './businessHours';
// --- Activation funnel (shared BE emit/query ↔ FE admin panel) ---
export { ACTIVATION_FUNNEL_STEPS, KB_FILLED_MIN_CHARS, isBusinessInfoProvided } from './activation';
export type { ActivationEvent, ActivationFunnel, ActivationFunnelStep } from './activation';
// --- Image-message marker protocol (DM vision descriptions) ---
export { IMAGE_MESSAGE_RE, IMAGE_PLACEHOLDER_RE, isImageMessageBody, extractImageDescription, isAnyImageMessage } from './imageMessage';
// --- Business Info audit (merchant «تقييم» button + admin panel) ---
export {
    IMPOSSIBLE_CAPABILITIES,
    SUPPORTED_CAPABILITIES,
    rankFindings,
    verifyQuote,
    isDirectImageUrl,
    findNonDirectImageUrls,
    findDuplicateTableRows,
    runDeterministicChecks,
} from './businessAudit';
export type {
    ImpossibleCapabilityId,
    BusinessAuditCode,
    BusinessAuditFinding,
    BusinessAuditResult,
    BusinessAuditFindingKind,
    DeterministicFindingCode,
} from './businessAudit';
// --- Fact-row visibility (start-date rule, D-057) — the ONE home for this
// predicate. Backend renderer, frontend editor and the SQL clause all key off
// it; see factSchedule.ts for why the SQL copy needs a contract test. ---
export { isRowLive } from './factSchedule';
export type { FactRowSchedule } from './factSchedule';
// --- Merchant-typed price → number. The server validates writes with it and
// the editor refuses with it, so the two cannot disagree about what «50 ألف»
// means (it means "unreadable", and the merchant is told so). ---
export { parseMerchantPrice } from './price';
export type { ParsedPrice } from './price';

// --- Admin merchant-email composer: limits, attachment wire shape, magic-byte
// sniff, and rejection codes — one definition for the backend validator, the
// route schema, and the frontend pre-submit checks, so they cannot drift. ---
export {
    MAX_EMAIL_ATTACHMENTS,
    MAX_EMAIL_ATTACHMENT_BYTES,
    MAX_EMAIL_ATTACHMENTS_TOTAL_BYTES,
    MAX_EMAIL_CC,
    ALLOWED_ATTACHMENT_EXTENSIONS,
    ATTACHMENT_ACCEPT,
    sniffAttachmentMime,
    EMAIL_COMPOSER_ERROR_CODES,
} from './emailComposer';
export type { EmailAttachment, AllowedAttachmentExtension, EmailComposerErrorCode } from './emailComposer';
