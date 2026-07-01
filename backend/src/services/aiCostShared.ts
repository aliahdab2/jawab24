/**
 * Small pure helpers shared by the AI-cost services (aiCostSnapshots, aiCostMonitor)
 * so they aren't duplicated per file.
 */

/** Round a USD amount to cents. */
export const round2 = (v: number): number => Math.round(v * 100) / 100;

/** UTC YYYY-MM-DD for a Date — snapshot rows are keyed by UTC day. */
export const utcDateStr = (d: Date): string => d.toISOString().slice(0, 10);
