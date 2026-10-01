// ============================================================
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
