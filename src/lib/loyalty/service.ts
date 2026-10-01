// ============================================================
// Loyalty data access — settings, lots, crediting, the retention
// message queue. Every function takes a Supabase client + accountId
// and filters by account, so it is safe with the service-role client.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { formatLocalDate, localDate } from './dates'
import {
  feedbackSendAt,
  lotDates,
  pointsForAmount,
  reminderSendTimes,
  summarizeLots,
  type LoyaltySummary,
} from './rules'
import {
  parseLoyaltySettings,
  parseLot,
  type LotSource,
  type LoyaltyLot,
  type LoyaltySettings,
  type ScheduledKind,
} from './types'

/** Feedback is skipped for invoices imported this long after the sale. */
export const FEEDBACK_MAX_AGE_DAYS = 3

export async function getLoyaltySettings(
  db: SupabaseClient,
  accountId: string,
): Promise<LoyaltySettings> {
  const { data } = await db
    .from('loyalty_settings')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  return parseLoyaltySettings(accountId, data as Record<string, unknown> | null)
}

export async function getContactLots(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<LoyaltyLot[]> {
  const { data, error } = await db
    .from('loyalty_lots')
    .select('id, contact_id, invoice_id, source, points, remaining, earned_at, bonus_until, expires_at')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('expires_at', { ascending: true })
  if (error) throw new Error(`loyalty lots lookup failed: ${error.message}`)
  return (data ?? []).map((r) => parseLot(r as Record<string, unknown>))
}

export async function getContactRedeemedPoints(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<number> {
  const { data } = await db
    .from('loyalty_redemptions')
    .select('points')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
  return (data ?? []).reduce((sum, r) => sum + Number((r as { points: number }).points), 0)
}

export async function getContactSummary(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  settings: LoyaltySettings,
  now = new Date(),
): Promise<{ summary: LoyaltySummary; lots: LoyaltyLot[] }> {
  const [lots, redeemed] = await Promise.all([
    getContactLots(db, accountId, contactId),
    getContactRedeemedPoints(db, accountId, contactId),
  ])
  return { summary: summarizeLots(lots, now, settings, redeemed), lots }
}

export interface EnqueueInput {
  contactId: string
  kind: ScheduledKind
  dedupeKey: string
  sendAt: Date
  invoiceId?: string | null
  lotId?: string | null
  daysBefore?: number | null
}

/** Insert queue rows; duplicates (same dedupe key) are ignored. */
export async function enqueueMessages(
  db: SupabaseClient,
  accountId: string,
  rows: EnqueueInput[],
): Promise<void> {
  if (rows.length === 0) return
  const { error } = await db.from('loyalty_scheduled_messages').upsert(
    rows.map((r) => ({
      account_id: accountId,
      contact_id: r.contactId,
      kind: r.kind,
      dedupe_key: r.dedupeKey,
      send_at: r.sendAt.toISOString(),
      invoice_id: r.invoiceId ?? null,
      lot_id: r.lotId ?? null,
      days_before: r.daysBefore ?? null,
    })),
    { onConflict: 'account_id,dedupe_key', ignoreDuplicates: true },
  )
  if (error) throw new Error(`enqueue failed: ${error.message}`)
}

/** Expiry reminders for a lot, grouped per contact + expiry day. */
export function expiryReminderRows(
  contactId: string,
  lotId: string,
  expiresAt: Date,
  settings: LoyaltySettings,
  now: Date,
): EnqueueInput[] {
  return reminderSendTimes(expiresAt, settings)
    .filter((r) => r.sendAt.getTime() > now.getTime())
    .map((r) => ({
      contactId,
      kind: 'expiry_reminder' as const,
      // One reminder per contact per expiry day per offset, even when
      // several lots expire on the same day.
      dedupeKey: `expiry:${contactId}:${r.expiryDate}:${r.daysBefore}`,
      sendAt: r.sendAt,
      lotId,
      daysBefore: r.daysBefore,
    }))
}

export interface CreditLotInput {
  contactId: string
  points: number
  source: LotSource
  earnedAt: Date
  invoiceId?: string | null
  occasionYear?: number | null
  note?: string | null
  createdBy?: string | null
}

/**
 * Insert a points lot and queue its expiry reminders. Returns the lot,
 * or null if it already existed (same invoice / same occasion year).
 */
export async function creditLot(
  db: SupabaseClient,
  accountId: string,
  input: CreditLotInput,
  settings: LoyaltySettings,
  now = new Date(),
): Promise<LoyaltyLot | null> {
  if (!Number.isInteger(input.points) || input.points <= 0) return null
  const { bonusUntil, expiresAt } = lotDates(input.earnedAt, settings)
  const { data, error } = await db
    .from('loyalty_lots')
    .insert({
      account_id: accountId,
      contact_id: input.contactId,
      invoice_id: input.invoiceId ?? null,
      source: input.source,
      occasion_year: input.occasionYear ?? null,
      points: input.points,
      remaining: input.points,
      earned_at: input.earnedAt.toISOString(),
      bonus_until: bonusUntil.toISOString(),
      expires_at: expiresAt.toISOString(),
      note: input.note ?? null,
      created_by: input.createdBy ?? null,
    })
    .select('id, contact_id, invoice_id, source, points, remaining, earned_at, bonus_until, expires_at')
    .single()
  if (error) {
    if ((error as { code?: string }).code === '23505') return null
    throw new Error(`credit lot failed: ${error.message}`)
  }
  const lot = parseLot(data as Record<string, unknown>)
  await enqueueMessages(
    db,
    accountId,
    expiryReminderRows(input.contactId, lot.id, expiresAt, settings, now),
  )
  return lot
}

export interface InvoiceForCredit {
  id: string
  contact_id: string
  external_id: string
  invoice_date: string
  total: number
}

/**
 * Credit purchase points for an invoice and queue the next-morning
 * feedback message. Idempotent: the unique index on
 * loyalty_lots(invoice_id) and the queue's dedupe key make re-runs no-ops.
 */
export async function creditInvoice(
  db: SupabaseClient,
  accountId: string,
  invoice: InvoiceForCredit,
  settings: LoyaltySettings,
  now = new Date(),
): Promise<{ points: number; lot: LoyaltyLot | null }> {
  const invoiceDate = new Date(invoice.invoice_date)
  const points = settings.enabled ? pointsForAmount(Number(invoice.total), settings) : 0
  let lot: LoyaltyLot | null = null
  if (points > 0) {
    lot = await creditLot(
      db,
      accountId,
      {
        contactId: invoice.contact_id,
        points,
        source: 'purchase',
        earnedAt: invoiceDate,
        invoiceId: invoice.id,
      },
      settings,
      now,
    )
    if (lot) {
      await db
        .from('invoices')
        .update({ points_earned: points })
        .eq('id', invoice.id)
        .eq('account_id', accountId)
    }
  }

  const ageDays = (now.getTime() - invoiceDate.getTime()) / 86_400_000
  if (settings.enabled && ageDays <= FEEDBACK_MAX_AGE_DAYS) {
    const sendAt = feedbackSendAt(invoiceDate, settings)
    await enqueueMessages(db, accountId, [
      {
        contactId: invoice.contact_id,
        kind: 'feedback',
        dedupeKey: `feedback:${invoice.id}`,
        // Imported late → send at the next cron tick instead of never.
        sendAt: sendAt.getTime() < now.getTime() ? now : sendAt,
        invoiceId: invoice.id,
      },
    ])
  }
  return { points, lot }
}

/** Points on live lots of `contactId` that expire on local day `date`. */
export async function pointsExpiringOn(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  date: string,
  settings: LoyaltySettings,
  now = new Date(),
): Promise<{ points: number; expiresAt: string | null }> {
  const lots = await getContactLots(db, accountId, contactId)
  let points = 0
  let expiresAt: string | null = null
  for (const lot of lots) {
    if (lot.remaining <= 0) continue
    if (new Date(lot.expires_at).getTime() <= now.getTime()) continue
    if (formatLocalDate(localDate(new Date(lot.expires_at), settings.timezone)) !== date) continue
    points += lot.remaining
    expiresAt = lot.expires_at
  }
  return { points, expiresAt }
}
