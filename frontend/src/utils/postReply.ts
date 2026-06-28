import { KeyRound } from 'lucide-react';

/**
 * Single source of truth for the Post Reply visual identity, distinct from Smart
 * Reply (Sparkles + violet). Post Reply = KeyRound icon + emerald, used on the
 * per-post button, the intro banner, the setup modal, the detail-modal keywords,
 * and the reply-source badge. Change the icon/colour here once instead of editing
 * every component (this lived in 5 files and was swapped three times before).
 *
 * NOTE: kept under src/utils (not src/lib) because Tailwind's content globs scan
 * src/utils for class-string constants — see tailwind.config.js.
 */
export const PostReplyIcon = KeyRound;

/** Emerald tint for the Post Reply icon — combine with a size class. */
export const postReplyIconClass = 'text-emerald-500 dark:text-emerald-400';
