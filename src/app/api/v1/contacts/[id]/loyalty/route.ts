// ============================================================
// GET /api/v1/contacts/:id/loyalty — a customer's points balance
// (scope: loyalty:read): lifetime earned, active points + ₹ value,
// upcoming expiries and when bonus-rate points drop to the base rate.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getContactSummary, getLoyaltySettings } from '@/lib/loyalty/service';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'loyalty:read');
    const { id } = await params;
    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!contact) return fail('not_found', 'Contact not found', 404);
    const settings = await getLoyaltySettings(ctx.supabase, ctx.accountId);
    const { summary } = await getContactSummary(
      ctx.supabase,
      ctx.accountId,
      id,
      settings
    );
    return ok({
      lifetime_earned: summary.lifetimeEarned,
      active_points: summary.activePoints,
      active_value: summary.activeValue,
      bonus_points: summary.bonusPoints,
      expired_points: summary.expiredPoints,
      expiring: summary.expiring.map((e) => ({
        date: e.date,
        expires_at: e.expiresAt,
        points: e.points,
      })),
      bonus_ending: summary.bonusEnding,
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
