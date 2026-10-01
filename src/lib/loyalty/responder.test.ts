import { describe, expect, it } from 'vitest';

import { buildOrdersReply, buildPointsReply, detectIntent } from './responder';
import { summarizeLots } from './rules';
import { defaultLoyaltySettings } from './types';

const settings = {
  ...defaultLoyaltySettings('acc'),
  store_name: 'Twinkly Jewels',
};

describe('detectIntent', () => {
  it.each([
    ['points', 'points'],
    ['My Points?', 'points'],
    ['loyalty balance pls', 'points'],
    ['orders', 'orders'],
    ['Previous purchase', 'orders'],
    ['orders and points', 'orders'],
  ])('%s → %s', (text, intent) => {
    expect(detectIntent(text, settings)).toBe(intent);
  });

  it('ignores long messages and partial words', () => {
    expect(
      detectIntent('I want to order a gold chain for my wife', settings)
    ).toBeNull();
    expect(detectIntent('appointment', settings)).toBeNull();
    expect(detectIntent('pointsss', settings)).toBeNull();
    expect(detectIntent('', settings)).toBeNull();
  });

  it('supports multi-word keywords', () => {
    expect(
      detectIntent('my reward points', {
        ...settings,
        points_keywords: ['reward points'],
      })
    ).toBe('points');
  });
});

describe('reply builders', () => {
  const now = new Date('2026-10-01T06:00:00Z');
  const lots = [
    {
      id: 'l1',
      contact_id: 'c',
      invoice_id: 'i',
      source: 'purchase' as const,
      points: 1254,
      remaining: 1254,
      earned_at: '2026-09-20T06:00:00Z',
      bonus_until: '2026-10-20T18:29:59.999Z',
      expires_at: '2026-12-20T18:29:59.999Z',
    },
  ];
  const summary = summarizeLots(lots, now, settings);

  it('points reply shows lifetime, active value and expiry', () => {
    const text = buildPointsReply('Priya Sharma', summary, settings);
    expect(text).toContain('Hi Priya!');
    expect(text).toContain('Lifetime points earned: *1,254*');
    expect(text).toContain('₹1,881');
    expect(text).toContain('20 Dec 2026');
    expect(text).toContain('20 Oct 2026');
  });

  it('orders reply lists invoices', () => {
    const text = buildOrdersReply(
      'Priya',
      [
        {
          external_id: 'INV-42',
          invoice_date: '2026-09-20T06:00:00Z',
          total: 125499,
          points_earned: 1254,
        },
      ],
      summary,
      settings
    );
    expect(text).toContain('Inv INV-42');
    expect(text).toContain('₹1,25,499');
    expect(text).toContain('+1,254 pts');
  });

  it('handles customers with no history', () => {
    const empty = summarizeLots([], now, settings);
    expect(buildPointsReply(null, empty, settings)).toContain(
      "couldn't find any loyalty points"
    );
    expect(buildOrdersReply('+919876543210', [], empty, settings)).toMatch(
      /^Hi! /
    );
  });
});
