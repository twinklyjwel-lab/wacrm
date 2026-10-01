// ============================================================
// Daily birthday / anniversary sweep. Once per local day, at or after
// the store's send hour: credits the configured bonus points (same
// expiry rules as purchase points) and queues the wish message.
// Idempotent per contact per year via loyalty_lots' unique index and
// the queue's dedupe key.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { formatLocalDate, isLeapYear, localParts } from './dates'
import { creditLot, enqueueMessages, type EnqueueInput } from './service'
import type { LoyaltySettings } from './types'

/** Should the sweep run for this account now? */
export function occasionsDue(settings: LoyaltySettings, now: Date): boolean {
  if (!settings.enabled) return false
  const p = localParts(now, settings.timezone)
  if (p.hour < settings.send_hour) return false
  return settings.occasions_last_run !== formatLocalDate(p)
}

export async function runOccasionsForAccount(
  db: SupabaseClient,
  settings: LoyaltySettings,
  now = new Date(),
): Promise<{ birthday: number; anniversary: number }> {
  const today = localParts(now, settings.timezone)
  const todayKey = formatLocalDate(today)
  // 29 Feb occasions are celebrated on 28 Feb in non-leap years.
  const includeLeapDay = today.month === 2 && today.day === 28 && !isLeapYear(today.year)
  const counts = { birthday: 0, anniversary: 0 }

  // Mark the day first: a crash mid-sweep must not re-credit on the
  // next tick (crediting is idempotent anyway, this just saves work).
  await db
    .from('loyalty_settings')
    .update({ occasions_last_run: todayKey })
    .eq('account_id', settings.account_id)

  for (const kind of ['birthday', 'anniversary'] as const) {
    const { data, error } = await db.rpc('loyalty_occasion_contacts', {
      p_account_id: settings.account_id,
      p_kind: kind,
      p_month: today.month,
      p_day: today.day,
      p_include_leap_day: includeLeapDay,
    })
    if (error) {
      console.error(`[loyalty] ${kind} lookup failed:`, error.message)
      continue
    }
    const bonus = kind === 'birthday' ? settings.birthday_points : settings.anniversary_points
    const rows: EnqueueInput[] = []
    for (const c of (data ?? []) as { id: string }[]) {
      let lotId: string | null = null
      if (bonus > 0) {
        const lot = await creditLot(
          db,
          settings.account_id,
          {
            contactId: c.id,
            points: bonus,
            source: kind,
            earnedAt: now,
            occasionYear: today.year,
            note: `${kind === 'birthday' ? 'Birthday' : 'Anniversary'} bonus ${today.year}`,
          },
          settings,
          now,
        )
        lotId = lot?.id ?? null
      }
      rows.push({
        contactId: c.id,
        kind,
        dedupeKey: `${kind}:${c.id}:${today.year}`,
        sendAt: now,
        lotId,
      })
      counts[kind]++
    }
    await enqueueMessages(db, settings.account_id, rows)
  }
  return counts
}
