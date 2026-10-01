import type { SupabaseClient } from '@supabase/supabase-js'

import { drainScheduledMessages } from './messages'
import { occasionsDue, runOccasionsForAccount } from './occasions'
import { parseLoyaltySettings } from './types'

/**
 * One cron tick: run any due birthday / anniversary sweeps, then send
 * due retention messages. Safe to call every few minutes.
 */
export async function runLoyaltyCron(db: SupabaseClient, now = new Date()) {
  const { data: accounts, error } = await db
    .from('loyalty_settings')
    .select('*')
    .eq('enabled', true)
  if (error) throw new Error(`settings read failed: ${error.message}`)

  const occasions: Record<string, { birthday: number; anniversary: number }> = {}
  for (const row of accounts ?? []) {
    const settings = parseLoyaltySettings(row.account_id as string, row as Record<string, unknown>)
    if (!occasionsDue(settings, now)) continue
    try {
      occasions[settings.account_id] = await runOccasionsForAccount(db, settings, now)
    } catch (err) {
      console.error('[loyalty] occasions sweep failed:', err instanceof Error ? err.message : err)
    }
  }

  const messages = await drainScheduledMessages(db, now)
  return { occasions, messages }
}
