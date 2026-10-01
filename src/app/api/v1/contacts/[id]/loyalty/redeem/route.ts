// ============================================================
// POST /api/v1/contacts/:id/loyalty/redeem — redeem points
// (scope: loyalty:write). Body: `{ "points": 500, "invoice_id"?, "note"? }`.
// Oldest points are used first, each valued at its current rate
// (₹1.5 inside the bonus month, ₹1 after) — the same atomic
// redeem_loyalty_points() the dashboard uses. 409 when the active
// balance is short.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'loyalty:write');
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const points = Number(body?.points);
    if (!Number.isInteger(points) || points <= 0) {
      return fail(
        'bad_request',
        "'points' must be a positive whole number",
        400
      );
    }
    const invoiceId =
      typeof body?.invoice_id === 'string' && body.invoice_id
        ? body.invoice_id
        : null;
    const note =
      typeof body?.note === 'string'
        ? body.note.slice(0, 500)
        : 'Redeemed via API';

    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!contact) return fail('not_found', 'Contact not found', 404);
    if (invoiceId) {
      const { data: inv } = await ctx.supabase
        .from('invoices')
        .select('id')
        .eq('id', invoiceId)
        .eq('account_id', ctx.accountId)
        .eq('contact_id', id)
        .maybeSingle();
      if (!inv)
        return fail('not_found', 'Invoice not found for this contact', 404);
    }

    const { data, error } = await ctx.supabase.rpc('redeem_loyalty_points', {
      p_account_id: ctx.accountId,
      p_contact_id: id,
      p_points: points,
      p_invoice_id: invoiceId,
      p_note: note,
      p_user_id: ctx.createdBy,
    });
    if (error) {
      if (/insufficient points/i.test(error.message)) {
        return fail('bad_request', 'Not enough active points', 409);
      }
      console.error('[api/v1/loyalty/redeem] error:', error);
      return fail('internal', 'Redemption failed', 500);
    }
    const r = data as { id: string; points: number; value: number };
    return ok(
      { redemption_id: r.id, points: r.points, value: Number(r.value) },
      201
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
