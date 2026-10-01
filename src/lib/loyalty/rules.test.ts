import { describe, expect, it } from 'vitest';

import {
  feedbackSendAt,
  invoicePointsBase,
  lotDates,
  lotRate,
  planRedemption,
  pointsForAmount,
  reminderSendTimes,
  summarizeLots,
} from './rules';
import { defaultLoyaltySettings, type LoyaltyLot } from './types';

const settings = defaultLoyaltySettings('acc');

function lot(
  partial: Partial<LoyaltyLot> & Pick<LoyaltyLot, 'id' | 'earned_at'>
): LoyaltyLot {
  const { bonusUntil, expiresAt } = lotDates(
    new Date(partial.earned_at),
    settings
  );
  return {
    contact_id: 'c1',
    invoice_id: null,
    source: 'purchase',
    points: 100,
    remaining: 100,
    bonus_until: bonusUntil.toISOString(),
    expires_at: expiresAt.toISOString(),
    ...partial,
  };
}

describe('pointsForAmount', () => {
  it('earns 1 point per ₹100, rounding down', () => {
    expect(pointsForAmount(125_499, settings)).toBe(1254);
    expect(pointsForAmount(99.99, settings)).toBe(0);
    expect(pointsForAmount(100, settings)).toBe(1);
  });
  it('is safe against float noise and bad input', () => {
    expect(pointsForAmount(0.1 + 0.2 + 299.7, settings)).toBe(3);
    expect(pointsForAmount(-500, settings)).toBe(0);
    expect(pointsForAmount(Number.NaN, settings)).toBe(0);
  });
});

describe('invoicePointsBase', () => {
  it('excludes GST but keeps making charges', () => {
    // gold 60,000 + making 4,500 + GST 1,935 = 66,435 → 645 points
    expect(invoicePointsBase(66_435, 1_935)).toBe(64_500);
    expect(pointsForAmount(invoicePointsBase(66_435, 1_935), settings)).toBe(
      645
    );
  });
  it('never goes negative and ignores bad tax', () => {
    expect(invoicePointsBase(100, 500)).toBe(0);
    expect(invoicePointsBase(1000, Number.NaN)).toBe(1000);
    expect(invoicePointsBase(1000, -50)).toBe(1000);
  });
});

describe('lotDates', () => {
  it('bonus ends 1 month later and points expire 3 months later, end of IST day', () => {
    // 15 Jan 2026, 18:00 IST
    const { bonusUntil, expiresAt } = lotDates(
      new Date('2026-01-15T12:30:00Z'),
      settings
    );
    // 23:59:59.999 IST == 18:29:59.999 UTC
    expect(bonusUntil.toISOString()).toBe('2026-02-15T18:29:59.999Z');
    expect(expiresAt.toISOString()).toBe('2026-04-15T18:29:59.999Z');
  });
  it('uses the IST calendar day, not UTC', () => {
    // 31 Mar 2026 20:00 UTC is already 1 Apr in India.
    const { expiresAt } = lotDates(new Date('2026-03-31T20:00:00Z'), settings);
    expect(expiresAt.toISOString()).toBe('2026-07-01T18:29:59.999Z');
  });
  it('clamps to month end (30 Nov + 3 months → 28 Feb)', () => {
    const { expiresAt } = lotDates(new Date('2026-11-30T06:00:00Z'), settings);
    expect(expiresAt.toISOString()).toBe('2027-02-28T18:29:59.999Z');
  });
});

describe('lotRate', () => {
  const l = lot({ id: 'a', earned_at: '2026-01-15T06:00:00Z' });
  it('is ₹1.5 inside the first month', () => {
    expect(lotRate(l, new Date('2026-02-15T18:00:00Z'), settings)).toBe(1.5);
  });
  it('drops to ₹1 after the first month', () => {
    expect(lotRate(l, new Date('2026-02-15T18:30:00Z'), settings)).toBe(1);
  });
  it('is 0 once expired', () => {
    expect(lotRate(l, new Date('2026-04-15T18:30:00Z'), settings)).toBe(0);
  });
});

describe('summarizeLots', () => {
  it('splits active value by tier and separates expired from redeemed', () => {
    const now = new Date('2026-03-01T06:00:00Z');
    const lots = [
      // expired already (earned Nov 2025, expired Feb 2026); 20 redeemed earlier
      lot({
        id: 'old',
        earned_at: '2025-11-10T06:00:00Z',
        points: 50,
        remaining: 30,
      }),
      // base rate (earned Jan, bonus ended Feb 15)
      lot({
        id: 'jan',
        earned_at: '2026-01-15T06:00:00Z',
        points: 100,
        remaining: 100,
      }),
      // bonus rate (earned Feb 20)
      lot({
        id: 'feb',
        earned_at: '2026-02-20T06:00:00Z',
        points: 40,
        remaining: 40,
      }),
    ];
    const s = summarizeLots(lots, now, settings, 20);
    expect(s.lifetimeEarned).toBe(190);
    expect(s.activePoints).toBe(140);
    expect(s.activeValue).toBe(100 * 1 + 40 * 1.5);
    expect(s.bonusPoints).toBe(40);
    expect(s.basePoints).toBe(100);
    expect(s.expiredPoints).toBe(30);
    expect(s.expiring.map((e) => [e.date, e.points])).toEqual([
      ['2026-04-15', 100],
      ['2026-05-20', 40],
    ]);
    expect(s.bonusEnding).toHaveLength(1);
    expect(s.bonusEnding[0].points).toBe(40);
  });
});

describe('planRedemption', () => {
  const now = new Date('2026-03-01T06:00:00Z');
  const lots = [
    lot({
      id: 'feb',
      earned_at: '2026-02-20T06:00:00Z',
      points: 40,
      remaining: 40,
    }),
    lot({
      id: 'jan',
      earned_at: '2026-01-15T06:00:00Z',
      points: 100,
      remaining: 100,
    }),
  ];
  it('draws the soonest-expiring lot first and values each point at its lot rate', () => {
    const plan = planRedemption(lots, 120, now, settings);
    expect(plan?.draws).toEqual([
      { lotId: 'jan', points: 100, rate: 1 },
      { lotId: 'feb', points: 20, rate: 1.5 },
    ]);
    expect(plan?.value).toBe(130);
  });
  it('refuses when the balance is short or input is invalid', () => {
    expect(planRedemption(lots, 141, now, settings)).toBeNull();
    expect(planRedemption(lots, 0, now, settings)).toBeNull();
    expect(planRedemption(lots, 1.5, now, settings)).toBeNull();
  });
});

describe('scheduling', () => {
  it('sends feedback at 10:00 IST the next day', () => {
    // Purchase 1 Oct 2026, 19:00 IST
    expect(
      feedbackSendAt(new Date('2026-10-01T13:30:00Z'), settings).toISOString()
    ).toBe('2026-10-02T04:30:00.000Z');
  });
  it('schedules reminders 30, 7 and 1 days before the expiry day at 10:00 IST', () => {
    const expiresAt = new Date('2027-01-01T18:29:59.999Z'); // end of 1 Jan 2027 IST
    const r = reminderSendTimes(expiresAt, settings);
    expect(r.map((x) => [x.daysBefore, x.sendAt.toISOString()])).toEqual([
      [30, '2026-12-02T04:30:00.000Z'],
      [7, '2026-12-25T04:30:00.000Z'],
      [1, '2026-12-31T04:30:00.000Z'],
    ]);
    expect(r[0].expiryDate).toBe('2027-01-01');
  });
});
