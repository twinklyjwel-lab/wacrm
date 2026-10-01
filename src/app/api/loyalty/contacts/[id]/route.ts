import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getContactSummary, getLoyaltySettings } from '@/lib/loyalty/service';

// Loyalty card for one customer: summary, lots, recent invoices and
// redemptions. RLS-scoped through the caller's session.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await params;
    const settings = await getLoyaltySettings(supabase, accountId);
    const [{ summary, lots }, invoices, redemptions] = await Promise.all([
      getContactSummary(supabase, accountId, id, settings),
      supabase
        .from('invoices')
        .select(
          'id, external_id, invoice_date, total, points_earned, points_redeemed'
        )
        .eq('account_id', accountId)
        .eq('contact_id', id)
        .order('invoice_date', { ascending: false })
        .limit(20),
      supabase
        .from('loyalty_redemptions')
        .select('id, points, value, note, created_at, invoice_id')
        .eq('account_id', accountId)
        .eq('contact_id', id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    return NextResponse.json({
      settings: {
        bonus_value: settings.bonus_value,
        base_value: settings.base_value,
        timezone: settings.timezone,
      },
      summary,
      lots,
      invoices: invoices.data ?? [],
      redemptions: redemptions.data ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
