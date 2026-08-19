/**
 * The status pill is a CLAIM about what a customer's message meets. These tests
 * pin the ladder AND its ceiling: the card may only claim what `GET /pages`
 * proves, which is configuration — never delivery.
 */
import { describe, it, expect } from 'vitest';
import type { Page } from '@jawab24/shared';
import { resolvePageStatus } from '../pageStatus';

const page = (overrides: Partial<Page> = {}): Page => ({
  id: 'page-1',
  name: 'Test Page',
  facebookPageId: 'fb-1',
  autoReplyEnabled: true,
  instagramAutoReplyEnabled: false,
  whatsappAutoReplyEnabled: false,
  kbFilled: true,
  catalogItemsCount: 0,
  ...overrides,
} as unknown as Page);

describe('resolvePageStatus', () => {
  it('answers when the page is connected, a channel is on and it has an answer source', () => {
    expect(resolvePageStatus(page())).toBe('answering');
  });

  // The ladder is ordered worst-first on purpose: a dead credential makes the
  // toggles and the Business Info moot, so it must win over both.
  it('reports the dead credential ahead of everything else', () => {
    expect(resolvePageStatus(page({ isConnected: false, autoReplyEnabled: false, kbFilled: false }))).toBe('disconnected');
  });

  it('reports paused when every channel is off', () => {
    expect(resolvePageStatus(page({ autoReplyEnabled: false }))).toBe('paused');
  });

  // A WhatsApp-only page with its toggle on is emphatically not "paused" —
  // isPageAutoReplyEnabled answers a different question and omits WhatsApp.
  it('counts WhatsApp as a live channel', () => {
    expect(resolvePageStatus(page({ autoReplyEnabled: false, whatsappAutoReplyEnabled: true }))).toBe('answering');
  });

  it('counts Instagram as a live channel', () => {
    expect(resolvePageStatus(page({ autoReplyEnabled: false, instagramAutoReplyEnabled: true }))).toBe('answering');
  });

  it('says greeting-only when there is no answer source', () => {
    expect(resolvePageStatus(page({ kbFilled: false }))).toBe('greeting_only');
  });

  // A merchant whose products live in the catalog HAS given the AI something to
  // answer from — D-025. Nagging them for Business Info text would be wrong, and
  // so would a pill saying the page only greets.
  it('treats catalog items as an answer source', () => {
    expect(resolvePageStatus(page({ kbFilled: false, catalogItemsCount: 12 }))).toBe('answering');
  });

  it('treats a connected store as an answer source', () => {
    expect(resolvePageStatus(page({ kbFilled: false, ecommerceStoreId: 'store-1' }))).toBe('answering');
  });

  // `isConnected` absent means "not told otherwise", never "disconnected" — the
  // convention across the app, and the reason a fresh page does not flash red.
  it('does not read a missing isConnected as disconnected', () => {
    expect(resolvePageStatus(page({ isConnected: undefined }))).toBe('answering');
  });
});
