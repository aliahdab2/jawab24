import type { LeadStagesConfig, LeadSubStage, LeadStageColor, LeadCustomFieldDef } from '@jawab24/shared';
import { LEAD_STAGE_COLORS, MAX_SUB_STAGES_PER_STAGE, MAX_SUB_STAGE_LABEL_LENGTH, MAX_LEAD_CUSTOM_FIELDS, MAX_LEAD_FIELD_LABEL_LENGTH } from '@jawab24/shared';

/**
 * Sanitize a merchant-supplied leadStages config. Labels are intentionally
 * free text (any language, any business type — store, clinic, school, ...);
 * we only enforce shape, limits, and a known color so a malformed payload
 * can't break the Leads UI. Returns undefined when the input is unusable.
 *
 * Shared by the workspace-level settings save and the per-page override save
 * (PATCH /pages/:id/lead-config) — identical validation on both paths.
 */
export function sanitizeLeadStages(input: unknown): LeadStagesConfig | undefined {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
    const out: LeadStagesConfig = {};
    for (const status of ['new', 'contacted', 'converted'] as const) {
        const list = (input as Record<string, unknown>)[status];
        if (!Array.isArray(list)) continue;
        const seen = new Set<string>();
        const clean: LeadSubStage[] = [];
        for (const item of list.slice(0, MAX_SUB_STAGES_PER_STAGE)) {
            if (typeof item !== 'object' || item === null) continue;
            const { id, label, color } = item as Record<string, unknown>;
            if (typeof id !== 'string' || !id || id.length > 64 || seen.has(id)) continue;
            if (typeof label !== 'string' || !label.trim()) continue;
            const safeColor = (LEAD_STAGE_COLORS as readonly string[]).includes(color as string)
                ? (color as LeadStageColor)
                : 'blue';
            seen.add(id);
            clean.push({ id, label: label.trim().slice(0, MAX_SUB_STAGE_LABEL_LENGTH), color: safeColor });
        }
        out[status] = clean;
    }
    return out;
}

/**
 * Sanitize merchant-defined custom field definitions (settings.leadFields or a
 * page's leadFields override). Same philosophy as sanitizeLeadStages: labels are
 * free text, we only enforce shape and limits. Returns undefined when unusable.
 */
export function sanitizeLeadFields(input: unknown): LeadCustomFieldDef[] | undefined {
    if (!Array.isArray(input)) return undefined;
    const seen = new Set<string>();
    const clean: LeadCustomFieldDef[] = [];
    for (const item of input.slice(0, MAX_LEAD_CUSTOM_FIELDS)) {
        if (typeof item !== 'object' || item === null) continue;
        const { id, label } = item as Record<string, unknown>;
        if (typeof id !== 'string' || !id || id.length > 64 || seen.has(id)) continue;
        if (typeof label !== 'string' || !label.trim()) continue;
        seen.add(id);
        clean.push({ id, label: label.trim().slice(0, MAX_LEAD_FIELD_LABEL_LENGTH) });
    }
    return clean;
}
