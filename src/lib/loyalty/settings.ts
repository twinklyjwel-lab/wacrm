// Validation for the loyalty settings form (PUT /api/loyalty/settings).

import {
  TEMPLATE_SLOTS,
  TEMPLATE_TOKENS,
  type TemplateConfig,
  type TemplateSlot,
  type TemplateToken,
} from './types';

type Result =
  { ok: true; patch: Record<string, unknown> } | { ok: false; error: string };

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function keywords(v: unknown, field: string): string[] | string {
  if (!Array.isArray(v)) return `${field} must be a list`;
  const out = [
    ...new Set(v.map((k) => String(k).trim().toLowerCase()).filter(Boolean)),
  ];
  if (out.length > 30) return `${field}: at most 30 keywords`;
  return out;
}

export function validateSettingsPatch(body: unknown): Result {
  if (!body || typeof body !== 'object')
    return { ok: false, error: 'Invalid JSON' };
  const b = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  const numField = (
    key: string,
    min: number,
    max: number,
    integer = false
  ): string | null => {
    if (b[key] === undefined) return null;
    const n = Number(b[key]);
    if (
      !Number.isFinite(n) ||
      n < min ||
      n > max ||
      (integer && !Number.isInteger(n))
    ) {
      return `${key} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}`;
    }
    patch[key] = n;
    return null;
  };

  const errors = [
    numField('amount_per_point', 1, 1_000_000),
    numField('bonus_value', 0, 1000),
    numField('base_value', 0, 1000),
    numField('bonus_months', 0, 24, true),
    numField('expiry_months', 1, 60, true),
    numField('birthday_points', 0, 1_000_000, true),
    numField('anniversary_points', 0, 1_000_000, true),
    numField('send_hour', 0, 23, true),
  ].filter(Boolean);
  if (errors.length > 0) return { ok: false, error: errors[0]! };

  if (patch.bonus_months !== undefined && patch.expiry_months !== undefined) {
    if ((patch.bonus_months as number) > (patch.expiry_months as number)) {
      return {
        ok: false,
        error: 'The bonus period cannot be longer than the expiry period',
      };
    }
  }

  if (b.enabled !== undefined) patch.enabled = b.enabled === true;

  for (const key of ['google_review_url', 'store_name'] as const) {
    if (b[key] === undefined) continue;
    const v = b[key] === null ? '' : String(b[key]).trim();
    if (key === 'google_review_url' && v && !/^https:\/\/\S+$/.test(v)) {
      return { ok: false, error: 'google_review_url must be an https:// link' };
    }
    patch[key] = v || null;
  }

  if (b.timezone !== undefined) {
    const tz = String(b.timezone);
    if (!isValidTimeZone(tz)) return { ok: false, error: 'Unknown timezone' };
    patch.timezone = tz;
  }

  if (b.reminder_days !== undefined) {
    if (!Array.isArray(b.reminder_days))
      return { ok: false, error: 'reminder_days must be a list' };
    const days = [...new Set(b.reminder_days.map(Number))];
    if (
      days.some((d) => !Number.isInteger(d) || d < 1 || d > 365) ||
      days.length > 6
    ) {
      return {
        ok: false,
        error: 'reminder_days must be up to 6 whole numbers between 1 and 365',
      };
    }
    patch.reminder_days = days.sort((x, y) => y - x);
  }

  for (const key of ['points_keywords', 'orders_keywords'] as const) {
    if (b[key] === undefined) continue;
    const v = keywords(b[key], key);
    if (typeof v === 'string') return { ok: false, error: v };
    patch[key] = v;
  }

  if (b.templates !== undefined) {
    if (!b.templates || typeof b.templates !== 'object') {
      return { ok: false, error: 'templates must be an object' };
    }
    const out: Partial<Record<TemplateSlot, TemplateConfig>> = {};
    for (const [slot, raw] of Object.entries(
      b.templates as Record<string, unknown>
    )) {
      if (!(TEMPLATE_SLOTS as string[]).includes(slot)) {
        return { ok: false, error: `Unknown template slot "${slot}"` };
      }
      if (!raw) continue;
      const t = raw as Record<string, unknown>;
      const name = String(t.name ?? '').trim();
      if (!name) continue;
      const params = Array.isArray(t.params) ? t.params.map(String) : [];
      const bad = params.find(
        (p) => !(TEMPLATE_TOKENS as readonly string[]).includes(p)
      );
      if (bad)
        return { ok: false, error: `Unknown template variable "${bad}"` };
      out[slot as TemplateSlot] = {
        name,
        language: String(t.language ?? 'en').trim() || 'en',
        params: params as TemplateToken[],
      };
    }
    patch.templates = out;
  }

  return { ok: true, patch };
}
