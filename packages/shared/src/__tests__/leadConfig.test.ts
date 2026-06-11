import { describe, it, expect } from 'vitest';
import {
  resolveEffectiveLeadStages,
  resolveEffectiveLeadFields,
  type LeadStagesConfig,
  type LeadCustomFieldDef,
} from '../index';

const wsStages: LeadStagesConfig = { converted: [{ id: 'ws', label: 'Delivered', color: 'emerald' }] };
const pageStages: LeadStagesConfig = { converted: [{ id: 'pg', label: 'Shipped', color: 'cyan' }] };
const wsFields: LeadCustomFieldDef[] = [{ id: 'wf', label: 'Amount' }];
const pageFields: LeadCustomFieldDef[] = [{ id: 'pf', label: 'Order #' }];

describe('resolveEffectiveLeadStages (page override ?? workspace default)', () => {
  it('returns the page override when set (full replacement, not merge)', () => {
    expect(resolveEffectiveLeadStages(pageStages, wsStages)).toBe(pageStages);
  });

  it('falls back to the workspace default when the page override is null (inherit)', () => {
    expect(resolveEffectiveLeadStages(null, wsStages)).toBe(wsStages);
  });

  it('falls back to the workspace default when the page override is undefined (inherit)', () => {
    expect(resolveEffectiveLeadStages(undefined, wsStages)).toBe(wsStages);
  });

  it('treats an empty {} override as a deliberate clear (NOT inherit)', () => {
    const empty: LeadStagesConfig = {};
    expect(resolveEffectiveLeadStages(empty, wsStages)).toBe(empty);
  });

  it('returns undefined when neither page nor workspace has config', () => {
    expect(resolveEffectiveLeadStages(null, undefined)).toBeUndefined();
  });
});

describe('resolveEffectiveLeadFields (page override ?? workspace default ?? [])', () => {
  it('returns the page override when set', () => {
    expect(resolveEffectiveLeadFields(pageFields, wsFields)).toBe(pageFields);
  });

  it('falls back to the workspace default when the page override is null/undefined', () => {
    expect(resolveEffectiveLeadFields(null, wsFields)).toBe(wsFields);
    expect(resolveEffectiveLeadFields(undefined, wsFields)).toBe(wsFields);
  });

  it('treats an empty [] override as a deliberate clear (NOT inherit)', () => {
    const empty: LeadCustomFieldDef[] = [];
    expect(resolveEffectiveLeadFields(empty, wsFields)).toBe(empty);
  });

  it('always resolves to an array (never undefined) when nothing is configured', () => {
    expect(resolveEffectiveLeadFields(null, undefined)).toEqual([]);
  });
});
