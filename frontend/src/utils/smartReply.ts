import { Sparkles } from 'lucide-react';

/**
 * Single source of truth for the Smart Reply visual identity, distinct from Post
 * Reply (KeyRound + sky — see ./postReply). Smart Reply = Sparkles + violet, the
 * same pairing the inbox reply-source badge uses (`reply-source-ai` in
 * globals.css — violet-600 light / violet-400 dark; solid tiles use violet-500).
 * Used on the reply-source badge and the Settings auto-reply board tiles.
 * Change the icon here once instead of editing every component.
 */
export const SmartReplyIcon = Sparkles;
