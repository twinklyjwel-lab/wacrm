// ============================================================
// Loyalty / jewellery-CRM shared types + defaults.
// Mirrors supabase/migrations/037_jewellery_loyalty.sql.
// ============================================================

export type Metal = 'gold' | 'silver';
export const METALS: Metal[] = ['gold', 'silver'];

export type LotSource = 'purchase' | 'birthday' | 'anniversary' | 'manual';

export type ScheduledKind =
  'feedback' | 'expiry_reminder' | 'birthday' | 'anniversary';
export const SCHEDULED_KINDS: ScheduledKind[] = [
  'feedback',
  'expiry_reminder',
  'birthday',
  'anniversary',
];

export type ScheduledStatus =
  'pending' | 'sending' | 'sent' | 'skipped' | 'failed' | 'cancelled';

/**
 * Values that can be substituted into a WhatsApp template's body
 * variables ({{1}}, {{2}} …). Each template config lists which token
 * fills each position, so the store can word templates freely.
 */
export const TEMPLATE_TOKENS = [
  'name',
  'store_name',
  'review_url',
  'invoice_no',
  'invoice_total',
  'invoice_date',
  'points_earned',
  'active_points',
  'active_value',
  'lifetime_points',
  'expiring_points',
  'expiry_date',
  'days_left',
  'bonus_points',
] as const;
export type TemplateToken = (typeof TEMPLATE_TOKENS)[number];

export interface TemplateConfig {
  /** Template name as synced from Meta (message_templates.name). */
  name: string;
  /** Template language code (message_templates.language). */
  language: string;
  /** Token for each body variable, in order: params[0] → {{1}}. */
  params: TemplateToken[];
}

/** Template slots — feedback has a PDF-less fallback. */
export type TemplateSlot = ScheduledKind | 'feedback_no_pdf';
export const TEMPLATE_SLOTS: TemplateSlot[] = [
  'feedback',
  'feedback_no_pdf',
  'expiry_reminder',
  'birthday',
  'anniversary',
];

export const DEFAULT_TEMPLATE_PARAMS: Record<TemplateSlot, TemplateToken[]> = {
  feedback: ['name', 'points_earned', 'active_points', 'review_url'],
  feedback_no_pdf: ['name', 'points_earned', 'active_points', 'review_url'],
  expiry_reminder: ['name', 'expiring_points', 'expiry_date', 'active_value'],
  birthday: ['name', 'bonus_points'],
  anniversary: ['name', 'bonus_points'],
};

export interface LoyaltySettings {
  account_id: string;
  enabled: boolean;
  amount_per_point: number;
  bonus_value: number;
  base_value: number;
  bonus_months: number;
  expiry_months: number;
  birthday_points: number;
  anniversary_points: number;
  google_review_url: string | null;
  store_name: string | null;
  timezone: string;
  send_hour: number;
  reminder_days: number[];
  templates: Partial<Record<TemplateSlot, TemplateConfig>>;
  points_keywords: string[];
  orders_keywords: string[];
  occasions_last_run: string | null;
}

export function defaultLoyaltySettings(accountId: string): LoyaltySettings {
  return {
    account_id: accountId,
    enabled: true,
    amount_per_point: 100,
    bonus_value: 1.5,
    base_value: 1,
    bonus_months: 1,
    expiry_months: 3,
    birthday_points: 0,
    anniversary_points: 0,
    google_review_url: null,
    store_name: null,
    timezone: 'Asia/Kolkata',
    send_hour: 10,
    reminder_days: [30, 7, 1],
    templates: {},
    points_keywords: ['points', 'point', 'loyalty', 'balance'],
    orders_keywords: ['order', 'orders', 'purchase', 'purchases', 'invoice'],
    occasions_last_run: null,
  };
}

/** Normalise a DB row (NUMERIC comes back as string) into settings. */
export function parseLoyaltySettings(
  accountId: string,
  row: Record<string, unknown> | null | undefined
): LoyaltySettings {
  const d = defaultLoyaltySettings(accountId);
  if (!row) return d;
  const num = (v: unknown, fallback: number) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const strArr = (v: unknown, fallback: string[]) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string')
      : fallback;
  return {
    account_id: accountId,
    enabled: typeof row.enabled === 'boolean' ? row.enabled : d.enabled,
    amount_per_point: num(row.amount_per_point, d.amount_per_point),
    bonus_value: num(row.bonus_value, d.bonus_value),
    base_value: num(row.base_value, d.base_value),
    bonus_months: num(row.bonus_months, d.bonus_months),
    expiry_months: num(row.expiry_months, d.expiry_months),
    birthday_points: num(row.birthday_points, d.birthday_points),
    anniversary_points: num(row.anniversary_points, d.anniversary_points),
    google_review_url: (row.google_review_url as string | null) ?? null,
    store_name: (row.store_name as string | null) ?? null,
    timezone: (row.timezone as string) || d.timezone,
    send_hour: num(row.send_hour, d.send_hour),
    reminder_days: Array.isArray(row.reminder_days)
      ? (row.reminder_days as unknown[])
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0)
      : d.reminder_days,
    templates:
      row.templates && typeof row.templates === 'object'
        ? (row.templates as LoyaltySettings['templates'])
        : {},
    points_keywords: strArr(row.points_keywords, d.points_keywords),
    orders_keywords: strArr(row.orders_keywords, d.orders_keywords),
    occasions_last_run: (row.occasions_last_run as string | null) ?? null,
  };
}

export interface LoyaltyLot {
  id: string;
  contact_id: string;
  invoice_id: string | null;
  source: LotSource;
  points: number;
  remaining: number;
  earned_at: string;
  bonus_until: string;
  expires_at: string;
}

export function parseLot(row: Record<string, unknown>): LoyaltyLot {
  return {
    id: row.id as string,
    contact_id: row.contact_id as string,
    invoice_id: (row.invoice_id as string | null) ?? null,
    source: row.source as LotSource,
    points: Number(row.points),
    remaining: Number(row.remaining),
    earned_at: row.earned_at as string,
    bonus_until: row.bonus_until as string,
    expires_at: row.expires_at as string,
  };
}
