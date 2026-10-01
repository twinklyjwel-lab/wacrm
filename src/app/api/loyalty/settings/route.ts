import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getLoyaltySettings } from '@/lib/loyalty/service';
import { validateSettingsPatch } from '@/lib/loyalty/settings';

// Loyalty settings — any member reads, admin+ writes. A row is created
// on first save; until then defaults apply and the WhatsApp responder
// stays off.

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const settings = await getLoyaltySettings(supabase, accountId);
    const { data: row } = await supabase
      .from('loyalty_settings')
      .select('account_id')
      .eq('account_id', accountId)
      .maybeSingle();
    return NextResponse.json({ settings, configured: !!row });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }
  const body = await request.json().catch(() => null);
  const result = validateSettingsPatch(body);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from('loyalty_settings')
    .upsert(
      { account_id: ctx.accountId, ...result.patch },
      { onConflict: 'account_id' }
    );
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  const settings = await getLoyaltySettings(supabaseAdmin(), ctx.accountId);
  return NextResponse.json({ settings, configured: true });
}
