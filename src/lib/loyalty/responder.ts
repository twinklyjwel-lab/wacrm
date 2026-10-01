// ============================================================
// WhatsApp self-service: when a customer messages "points" /
// "loyalty" or "orders" / "purchase", reply with their balance or
// order history. Called from the inbound webhook after Flows; when
// it replies, the message is "consumed" and keyword automations / AI
// auto-reply are skipped so the customer gets exactly one answer.
//
// Only short messages (≤ MAX_WORDS words) trigger it, so "I want to
// order a gold chain" still reaches an agent instead of an auto-reply.
// The customer just messaged, so these are free-form session messages
// (no approved template needed).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';
import { displayDate } from './dates';
import { formatInr, formatPoints } from './format';
import type { LoyaltySummary } from './rules';
import { getContactSummary, getLoyaltySettings } from './service';
import type { LoyaltySettings } from './types';

export const MAX_WORDS = 5;

export type LoyaltyIntent = 'points' | 'orders';

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Which question (if any) a short inbound message asks. */
export function detectIntent(
  text: string,
  settings: Pick<LoyaltySettings, 'points_keywords' | 'orders_keywords'>
): LoyaltyIntent | null {
  const w = words(text);
  if (w.length === 0 || w.length > MAX_WORDS) return null;
  const has = (keywords: string[]) =>
    keywords.some((k) => {
      const kw = words(k);
      if (kw.length === 0) return false;
      // Multi-word keyword → contiguous phrase match.
      for (let i = 0; i + kw.length <= w.length; i++) {
        if (kw.every((part, j) => w[i + j] === part)) return true;
      }
      return false;
    });
  // Orders first: "orders and points" → history, which includes points.
  if (has(settings.orders_keywords)) return 'orders';
  if (has(settings.points_keywords)) return 'points';
  return null;
}

export interface OrderLine {
  external_id: string;
  invoice_date: string;
  total: number;
  points_earned: number;
}

function greeting(
  name: string | null,
  settings: Pick<LoyaltySettings, 'store_name'>
): string {
  const first = name && !/^\+?\d+$/.test(name) ? name.split(/\s+/)[0] : null;
  const hi = first ? `Hi ${first}!` : 'Hi!';
  return settings.store_name
    ? `${hi} ✨ ${settings.store_name} Rewards`
    : `${hi} ✨ Your Rewards`;
}

function balanceLines(
  s: LoyaltySummary,
  settings: Pick<LoyaltySettings, 'timezone' | 'bonus_value' | 'base_value'>
): string[] {
  const lines = [
    `⭐ Lifetime points earned: *${formatPoints(s.lifetimeEarned)}*`,
    `✅ Active points: *${formatPoints(s.activePoints)}* (worth *${formatInr(s.activeValue)}* today)`,
  ];
  for (const b of s.bonusEnding.slice(0, 2)) {
    lines.push(
      `💎 ${formatPoints(b.points)} pts are worth ${formatInr(settings.bonus_value)} each until ${displayDate(b.until, settings.timezone)}, then ${formatInr(settings.base_value)}`
    );
  }
  const next = s.expiring[0];
  if (next) {
    lines.push(
      `⏳ ${formatPoints(next.points)} pts expire on ${displayDate(next.expiresAt, settings.timezone)}`
    );
  }
  if (s.expiredPoints > 0)
    lines.push(`⌛ Expired so far: ${formatPoints(s.expiredPoints)} pts`);
  return lines;
}

export function buildPointsReply(
  name: string | null,
  s: LoyaltySummary,
  settings: LoyaltySettings
): string {
  if (s.lifetimeEarned === 0) {
    return `${greeting(name, settings)}\n\nWe couldn't find any loyalty points for this number yet. Points are earned on every purchase — ask us at the store to link your number. 🙏`;
  }
  return [
    greeting(name, settings),
    '',
    ...balanceLines(s, settings),
    '',
    `Redeem your active points on your next purchase. Points expire ${settings.expiry_months} month${settings.expiry_months === 1 ? '' : 's'} after purchase — use them before they go! 💛`,
  ].join('\n');
}

export function buildOrdersReply(
  name: string | null,
  orders: OrderLine[],
  s: LoyaltySummary,
  settings: LoyaltySettings
): string {
  if (orders.length === 0) {
    return `${greeting(name, settings)}\n\nWe couldn't find any purchases linked to this number. If you shopped with a different number, please share it with us. 🙏`;
  }
  const lines = orders.map(
    (o, i) =>
      `${i + 1}. ${displayDate(o.invoice_date, settings.timezone)} — Inv ${o.external_id} — ${formatInr(o.total)} — +${formatPoints(o.points_earned)} pts`
  );
  return [
    greeting(name, settings),
    '',
    `🧾 Your recent purchases:`,
    ...lines,
    '',
    ...balanceLines(s, settings),
  ].join('\n');
}

export const ORDERS_IN_REPLY = 5;

/** Build the reply text for an intent (no sending). */
export async function buildReply(
  db: SupabaseClient,
  accountId: string,
  contact: { id: string; name: string | null },
  intent: LoyaltyIntent,
  settings: LoyaltySettings,
  now = new Date()
): Promise<string> {
  const { summary } = await getContactSummary(
    db,
    accountId,
    contact.id,
    settings,
    now
  );
  if (intent === 'points')
    return buildPointsReply(contact.name, summary, settings);
  const { data } = await db
    .from('invoices')
    .select('external_id, invoice_date, total, points_earned')
    .eq('account_id', accountId)
    .eq('contact_id', contact.id)
    .order('invoice_date', { ascending: false })
    .limit(ORDERS_IN_REPLY);
  const orders: OrderLine[] = (data ?? []).map((r) => ({
    external_id: r.external_id as string,
    invoice_date: r.invoice_date as string,
    total: Number(r.total),
    points_earned: Number(r.points_earned),
  }));
  return buildOrdersReply(contact.name, orders, summary, settings);
}

export interface DispatchLoyaltyArgs {
  accountId: string;
  contactId: string;
  conversationId: string;
  text: string;
}

/**
 * Webhook entry point. Never throws; returns whether it replied.
 */
export async function dispatchInboundToLoyalty(
  args: DispatchLoyaltyArgs
): Promise<{ consumed: boolean }> {
  try {
    if (!args.text.trim()) return { consumed: false };
    const db = supabaseAdmin();
    const { data: row } = await db
      .from('loyalty_settings')
      .select('*')
      .eq('account_id', args.accountId)
      .maybeSingle();
    // Feature is opt-in per account: no settings row → stay out of the way.
    if (!row) return { consumed: false };
    const settings = await getLoyaltySettings(db, args.accountId);
    if (!settings.enabled) return { consumed: false };
    const intent = detectIntent(args.text, settings);
    if (!intent) return { consumed: false };

    const { data: contact } = await db
      .from('contacts')
      .select('id, name')
      .eq('id', args.contactId)
      .eq('account_id', args.accountId)
      .maybeSingle();
    if (!contact) return { consumed: false };

    const reply = await buildReply(
      db,
      args.accountId,
      {
        id: contact.id as string,
        name: (contact.name as string | null) ?? null,
      },
      intent,
      settings
    );
    await sendMessageToConversation(db, args.accountId, {
      conversationId: args.conversationId,
      messageType: 'text',
      contentText: reply,
    });
    return { consumed: true };
  } catch (err) {
    console.error(
      '[loyalty] responder failed:',
      err instanceof Error ? err.message : err
    );
    return { consumed: false };
  }
}
