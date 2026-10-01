// ============================================================
// Retention queue worker — sends due loyalty_scheduled_messages as
// approved WhatsApp templates (they usually go out >24h after the
// customer last wrote, so free-form text isn't allowed by Meta).
//
//   feedback         next morning after purchase: thanks + Google
//                    review link + points earned, invoice PDF as the
//                    template's DOCUMENT header
//   expiry_reminder  30 / 7 / 1 days before points expire
//   birthday /       wish + bonus points + surprise gift invite
//   anniversary
//
// Each row is claimed with a conditional update (pending → sending) so
// overlapping cron runs can't double-send.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { sendMessageToConversation } from '@/lib/whatsapp/send-message'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { displayDate, localDaysBetween } from './dates'
import { formatInr, formatPoints } from './format'
import { getContactSummary, getLoyaltySettings, pointsExpiringOn } from './service'
import {
  DEFAULT_TEMPLATE_PARAMS,
  type LoyaltySettings,
  type ScheduledKind,
  type TemplateConfig,
  type TemplateSlot,
  type TemplateToken,
} from './types'

export const MAX_ATTEMPTS = 3
export const RETRY_DELAY_MS = 30 * 60 * 1000
export const BATCH_SIZE = 50
/** Signed invoice-PDF links stay valid long enough for Meta to fetch. */
export const PDF_LINK_TTL_SECONDS = 7 * 24 * 60 * 60

export interface QueueRow {
  id: string
  account_id: string
  contact_id: string
  kind: ScheduledKind
  invoice_id: string | null
  lot_id: string | null
  days_before: number | null
  dedupe_key: string
  attempts: number
}

export type SendOutcome =
  | { status: 'sent' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string; retry: boolean }

/** Map template tokens to the body parameter list. */
export function buildTemplateBody(
  params: TemplateToken[],
  values: Partial<Record<TemplateToken, string>>,
): string[] {
  // Meta rejects empty parameters — fall back to a dash.
  return params.map((t) => {
    const v = values[t]
    return v && v.trim() ? v : '-'
  })
}

function firstName(name: string | null | undefined): string {
  if (!name || /^\+?\d+$/.test(name)) return 'there'
  return name.split(/\s+/)[0]
}

/** The expiry date (YYYY-MM-DD) encoded in an expiry reminder's dedupe key. */
export function expiryDateFromKey(key: string): string | null {
  const m = /^expiry:[^:]+:(\d{4}-\d{2}-\d{2}):\d+$/.exec(key)
  return m ? m[1] : null
}

function templateFor(settings: LoyaltySettings, slot: TemplateSlot): TemplateConfig | null {
  const t = settings.templates[slot]
  if (!t || !t.name) return null
  return {
    name: t.name,
    language: t.language || 'en',
    params: Array.isArray(t.params) && t.params.length > 0 ? t.params : DEFAULT_TEMPLATE_PARAMS[slot],
  }
}

export async function sendQueuedMessage(
  db: SupabaseClient,
  row: QueueRow,
  settings: LoyaltySettings,
  now = new Date(),
): Promise<SendOutcome> {
  if (!settings.enabled) return { status: 'skipped', reason: 'loyalty disabled' }

  const { data: contact } = await db
    .from('contacts')
    .select('id, name, phone, loyalty_opt_out')
    .eq('id', row.contact_id)
    .eq('account_id', row.account_id)
    .maybeSingle()
  if (!contact) return { status: 'skipped', reason: 'contact deleted' }
  if (contact.loyalty_opt_out) return { status: 'skipped', reason: 'customer opted out' }

  const { summary } = await getContactSummary(db, row.account_id, row.contact_id, settings, now)
  const values: Partial<Record<TemplateToken, string>> = {
    name: firstName(contact.name as string | null),
    store_name: settings.store_name ?? '',
    review_url: settings.google_review_url ?? '',
    active_points: formatPoints(summary.activePoints),
    active_value: formatInr(summary.activeValue),
    lifetime_points: formatPoints(summary.lifetimeEarned),
  }

  let slot: TemplateSlot = row.kind
  let headerMediaUrl: string | undefined

  if (row.kind === 'feedback') {
    if (!row.invoice_id) return { status: 'skipped', reason: 'invoice missing' }
    const { data: inv } = await db
      .from('invoices')
      .select('external_id, invoice_date, total, points_earned, pdf_path')
      .eq('id', row.invoice_id)
      .eq('account_id', row.account_id)
      .maybeSingle()
    if (!inv) return { status: 'skipped', reason: 'invoice deleted' }
    values.invoice_no = inv.external_id as string
    values.invoice_total = formatInr(Number(inv.total))
    values.invoice_date = displayDate(inv.invoice_date as string, settings.timezone)
    values.points_earned = formatPoints(Number(inv.points_earned))
    if (inv.pdf_path) {
      const { data: signed, error } = await db.storage
        .from('invoices')
        .createSignedUrl(inv.pdf_path as string, PDF_LINK_TTL_SECONDS)
      if (error || !signed) {
        return { status: 'failed', error: `invoice PDF link failed: ${error?.message}`, retry: true }
      }
      headerMediaUrl = signed.signedUrl
    } else if (templateFor(settings, 'feedback_no_pdf')) {
      slot = 'feedback_no_pdf'
    }
  }

  if (row.kind === 'expiry_reminder') {
    const date = expiryDateFromKey(row.dedupe_key)
    if (!date) return { status: 'skipped', reason: 'bad reminder key' }
    const { points, expiresAt } = await pointsExpiringOn(
      db,
      row.account_id,
      row.contact_id,
      date,
      settings,
      now,
    )
    // Already redeemed (or expired) — nothing to remind about.
    if (points <= 0 || !expiresAt) return { status: 'skipped', reason: 'no points left to expire' }
    values.expiring_points = formatPoints(points)
    values.expiry_date = displayDate(expiresAt, settings.timezone)
    values.days_left = String(Math.max(0, localDaysBetween(now, new Date(expiresAt), settings.timezone)))
  }

  if (row.kind === 'birthday' || row.kind === 'anniversary') {
    values.bonus_points = formatPoints(
      row.kind === 'birthday' ? settings.birthday_points : settings.anniversary_points,
    )
  }

  const tpl = templateFor(settings, slot)
  if (!tpl) {
    return {
      status: 'failed',
      error: `No WhatsApp template configured for "${slot}" — set one in Loyalty → Settings`,
      retry: false,
    }
  }

  const { data: templateRow } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', row.account_id)
    .eq('name', tpl.name)
    .eq('language', tpl.language)
    .maybeSingle()
  if (!templateRow || !isMessageTemplate(templateRow)) {
    return {
      status: 'failed',
      error: `Template "${tpl.name}" (${tpl.language}) not found — sync templates from Meta`,
      retry: false,
    }
  }
  if (templateRow.header_type === 'document' && !headerMediaUrl && !templateRow.header_media_url) {
    return {
      status: 'failed',
      error: 'Template needs an invoice PDF but none is attached to this invoice',
      retry: false,
    }
  }

  try {
    const { conversationId } = await resolveConversationByPhone(
      db,
      row.account_id,
      contact.phone as string,
    )
    await sendMessageToConversation(db, row.account_id, {
      conversationId,
      messageType: 'template',
      templateName: tpl.name,
      templateLanguage: tpl.language,
      templateMessageParams: {
        body: buildTemplateBody(tpl.params, values),
        ...(headerMediaUrl ? { headerMediaUrl } : {}),
      },
    })
    return { status: 'sent' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'failed', error: message, retry: true }
  }
}

/**
 * Drain due queue rows. Returns counts per outcome.
 */
export async function drainScheduledMessages(
  db: SupabaseClient,
  now = new Date(),
): Promise<Record<'sent' | 'skipped' | 'failed' | 'retrying', number>> {
  const counts = { sent: 0, skipped: 0, failed: 0, retrying: 0 }
  const { data: due, error } = await db
    .from('loyalty_scheduled_messages')
    .select('id, account_id, contact_id, kind, invoice_id, lot_id, days_before, dedupe_key, attempts')
    .eq('status', 'pending')
    .lte('send_at', now.toISOString())
    .order('send_at', { ascending: true })
    .limit(BATCH_SIZE)
  if (error) throw new Error(`queue read failed: ${error.message}`)

  const settingsCache = new Map<string, LoyaltySettings>()
  for (const raw of due ?? []) {
    const row = raw as QueueRow
    const { data: claim } = await db
      .from('loyalty_scheduled_messages')
      .update({ status: 'sending', attempts: row.attempts + 1 })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    let settings = settingsCache.get(row.account_id)
    if (!settings) {
      settings = await getLoyaltySettings(db, row.account_id)
      settingsCache.set(row.account_id, settings)
    }

    let outcome: SendOutcome
    try {
      outcome = await sendQueuedMessage(db, row, settings, now)
    } catch (err) {
      outcome = {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        retry: true,
      }
    }

    if (outcome.status === 'sent') {
      counts.sent++
      await db
        .from('loyalty_scheduled_messages')
        .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null })
        .eq('id', row.id)
    } else if (outcome.status === 'skipped') {
      counts.skipped++
      await db
        .from('loyalty_scheduled_messages')
        .update({ status: 'skipped', last_error: outcome.reason })
        .eq('id', row.id)
    } else if (outcome.retry && row.attempts + 1 < MAX_ATTEMPTS) {
      counts.retrying++
      await db
        .from('loyalty_scheduled_messages')
        .update({
          status: 'pending',
          last_error: outcome.error,
          send_at: new Date(now.getTime() + RETRY_DELAY_MS).toISOString(),
        })
        .eq('id', row.id)
    } else {
      counts.failed++
      await db
        .from('loyalty_scheduled_messages')
        .update({ status: 'failed', last_error: outcome.error })
        .eq('id', row.id)
    }
  }
  return counts
}
