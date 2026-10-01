// ============================================================
// GET  /api/v1/metal-rates — latest rate per metal + purity, plus the
// last 30 days of history (scope: inventory:read).
// POST /api/v1/metal-rates — set today's (or a given day's) gold /
// silver rate per gram (scope: inventory:write).
// Body: one rate or `{ "rates": [...] }`, each
// `{ metal, purity, rate_per_gram, effective_date? }`.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { upsertMetalRates } from '@/lib/loyalty/batch';
import { formatLocalDate, localDate } from '@/lib/loyalty/dates';
import { getLoyaltySettings } from '@/lib/loyalty/service';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'inventory:read');
    const { data, error } = await ctx.supabase
      .from('metal_rates')
      .select('metal, purity, rate_per_gram, effective_date')
      .eq('account_id', ctx.accountId)
      .order('effective_date', { ascending: false })
      .limit(300);
    if (error) return fail('internal', 'Failed to read metal rates', 500);
    const rows = (data ?? []).map((r) => ({
      ...r,
      rate_per_gram: Number(r.rate_per_gram),
    }));
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const k = `${r.metal}|${r.purity}`;
      if (!latest.has(k)) latest.set(k, r);
    }
    return ok({ latest: [...latest.values()], history: rows.slice(0, 150) });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'inventory:write');
    const body = (await request.json().catch(() => null)) as unknown;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }
    const list = Array.isArray((body as { rates?: unknown }).rates)
      ? (body as { rates: unknown[] }).rates
      : [body];
    if (list.length === 0 || list.length > 50) {
      return fail('bad_request', 'Send between 1 and 50 rates', 400);
    }
    const settings = await getLoyaltySettings(ctx.supabase, ctx.accountId);
    const today = formatLocalDate(localDate(new Date(), settings.timezone));
    const results = await upsertMetalRates(
      ctx.supabase,
      ctx.accountId,
      ctx.createdBy,
      list,
      today
    );
    return ok({ results });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
