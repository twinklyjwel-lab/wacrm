// ============================================================
// Pure loyalty rules — earning, lot dates, valuation, summaries.
//
// Policy (configurable in loyalty_settings):
//   - earn 1 point per `amount_per_point` (₹100) of invoice total
//   - a point is worth `bonus_value` (₹1.5) until the end of the
//     local day `bonus_months` (1) after the purchase, then
//     `base_value` (₹1) until the end of the local day
//     `expiry_months` (3) after the purchase, then it expires
//   - redemptions draw down the soonest-expiring lots first (FIFO)
// ============================================================

import {
  addDaysLocal,
  addMonthsLocal,
  endOfLocalDay,
  formatLocalDate,
  localDate,
  zonedTimeToUtc,
} from './dates';
import type { LoyaltyLot, LoyaltySettings } from './types';

export function pointsForAmount(
  total: number,
  settings: Pick<LoyaltySettings, 'amount_per_point'>
): number {
  if (!Number.isFinite(total) || total <= 0 || settings.amount_per_point <= 0)
    return 0;
  // Round to paise first so float noise (e.g. 199.99999) can't lose a point.
  return Math.floor(
    Math.round(total * 100) / Math.round(settings.amount_per_point * 100)
  );
}

/**
 * The amount an invoice earns points on: the total excluding GST.
 * Making charges count; discounts are already netted into the total.
 */
export function invoicePointsBase(total: number, tax: number): number {
  const t = Number.isFinite(total) ? total : 0;
  const g = Number.isFinite(tax) && tax > 0 ? tax : 0;
  return Math.max(0, Math.round((t - g) * 100) / 100);
}

export function lotDates(
  earnedAt: Date,
  settings: Pick<LoyaltySettings, 'bonus_months' | 'expiry_months' | 'timezone'>
): { bonusUntil: Date; expiresAt: Date } {
  const day = localDate(earnedAt, settings.timezone);
  return {
    bonusUntil: endOfLocalDay(
      addMonthsLocal(day, settings.bonus_months),
      settings.timezone
    ),
    expiresAt: endOfLocalDay(
      addMonthsLocal(day, settings.expiry_months),
      settings.timezone
    ),
  };
}

/** ₹ value of one point of `lot` at `now` (0 once expired). */
export function lotRate(
  lot: Pick<LoyaltyLot, 'bonus_until' | 'expires_at'>,
  now: Date,
  settings: Pick<LoyaltySettings, 'bonus_value' | 'base_value'>
): number {
  const t = now.getTime();
  if (t >= new Date(lot.expires_at).getTime()) return 0;
  if (t < new Date(lot.bonus_until).getTime()) return settings.bonus_value;
  return settings.base_value;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ExpiryBucket {
  /** Local date (YYYY-MM-DD) the points expire at the end of. */
  date: string;
  expiresAt: string;
  points: number;
}

export interface BonusBucket {
  /** Points currently at the bonus rate that drop to base on `until`. */
  until: string;
  points: number;
}

export interface LoyaltySummary {
  lifetimeEarned: number;
  activePoints: number;
  activeValue: number;
  bonusPoints: number;
  basePoints: number;
  usedOrExpired: number;
  expiredPoints: number;
  expiring: ExpiryBucket[];
  bonusEnding: BonusBucket[];
}

/**
 * Summarise a contact's lots at `now`. `redeemed` is the total points
 * ever redeemed (from loyalty_redemptions) so expired vs redeemed can
 * be told apart: what's not active and not redeemed has expired.
 */
export function summarizeLots(
  lots: LoyaltyLot[],
  now: Date,
  settings: Pick<LoyaltySettings, 'bonus_value' | 'base_value' | 'timezone'>,
  redeemed = 0
): LoyaltySummary {
  let lifetimeEarned = 0;
  let activePoints = 0;
  let activeValue = 0;
  let bonusPoints = 0;
  let basePoints = 0;
  const expiring = new Map<string, ExpiryBucket>();
  const bonusEnding = new Map<string, BonusBucket>();

  for (const lot of lots) {
    lifetimeEarned += lot.points;
    const rate = lotRate(lot, now, settings);
    if (rate === 0 || lot.remaining <= 0) continue;
    activePoints += lot.remaining;
    activeValue += lot.remaining * rate;
    if (
      rate === settings.bonus_value &&
      settings.bonus_value !== settings.base_value
    ) {
      bonusPoints += lot.remaining;
      const b = bonusEnding.get(lot.bonus_until);
      if (b) b.points += lot.remaining;
      else
        bonusEnding.set(lot.bonus_until, {
          until: lot.bonus_until,
          points: lot.remaining,
        });
    } else {
      basePoints += lot.remaining;
    }
    const key = formatLocalDate(
      localDate(new Date(lot.expires_at), settings.timezone)
    );
    const e = expiring.get(key);
    if (e) e.points += lot.remaining;
    else
      expiring.set(key, {
        date: key,
        expiresAt: lot.expires_at,
        points: lot.remaining,
      });
  }

  const usedOrExpired = lifetimeEarned - activePoints;
  return {
    lifetimeEarned,
    activePoints,
    activeValue: roundMoney(activeValue),
    bonusPoints,
    basePoints,
    usedOrExpired,
    expiredPoints: Math.max(0, usedOrExpired - redeemed),
    expiring: [...expiring.values()].sort((a, b) =>
      a.date.localeCompare(b.date)
    ),
    bonusEnding: [...bonusEnding.values()].sort((a, b) =>
      a.until.localeCompare(b.until)
    ),
  };
}

export interface RedemptionDraw {
  lotId: string;
  points: number;
  rate: number;
}

/**
 * FIFO plan for redeeming `points` — the same algorithm the
 * `redeem_loyalty_points` SQL function runs atomically. Used for the
 * redeem dialog preview. Returns null if the balance is short.
 */
export function planRedemption(
  lots: LoyaltyLot[],
  points: number,
  now: Date,
  settings: Pick<LoyaltySettings, 'bonus_value' | 'base_value'>
): { draws: RedemptionDraw[]; value: number } | null {
  if (!Number.isInteger(points) || points <= 0) return null;
  const live = lots
    .filter((l) => l.remaining > 0 && lotRate(l, now, settings) > 0)
    .sort(
      (a, b) =>
        new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime() ||
        new Date(a.earned_at).getTime() - new Date(b.earned_at).getTime()
    );
  let left = points;
  let value = 0;
  const draws: RedemptionDraw[] = [];
  for (const lot of live) {
    if (left === 0) break;
    const take = Math.min(left, lot.remaining);
    const rate = lotRate(lot, now, settings);
    draws.push({ lotId: lot.id, points: take, rate });
    value += take * rate;
    left -= take;
  }
  if (left > 0) return null;
  return { draws, value: roundMoney(value) };
}

/**
 * When to send a message "on local day `day` at the send hour".
 */
export function sendTimeOn(
  day: { year: number; month: number; day: number },
  settings: Pick<LoyaltySettings, 'send_hour' | 'timezone'>
): Date {
  return zonedTimeToUtc(day, settings.send_hour, 0, 0, settings.timezone);
}

/** Post-purchase feedback goes out the next local morning. */
export function feedbackSendAt(
  invoiceDate: Date,
  settings: Pick<LoyaltySettings, 'send_hour' | 'timezone'>
): Date {
  return sendTimeOn(
    addDaysLocal(localDate(invoiceDate, settings.timezone), 1),
    settings
  );
}

/** Reminder send times for points expiring at `expiresAt`. */
export function reminderSendTimes(
  expiresAt: Date,
  settings: Pick<LoyaltySettings, 'send_hour' | 'timezone' | 'reminder_days'>
): { daysBefore: number; sendAt: Date; expiryDate: string }[] {
  const expiryDay = localDate(expiresAt, settings.timezone);
  const expiryDate = formatLocalDate(expiryDay);
  return [...new Set(settings.reminder_days)]
    .filter((d) => d > 0)
    .sort((a, b) => b - a)
    .map((daysBefore) => ({
      daysBefore,
      sendAt: sendTimeOn(addDaysLocal(expiryDay, -daysBefore), settings),
      expiryDate,
    }));
}
