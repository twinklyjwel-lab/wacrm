import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { upsertMetalRates } from '@/lib/loyalty/batch';
import { formatLocalDate, localDate } from '@/lib/loyalty/dates';
import { getLoyaltySettings } from '@/lib/loyalty/service';

// Set gold / silver rates per gram for a day (defaults to today, store time).
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }
  const body = await request.json().catch(() => null);
  const list = Array.isArray(body?.rates) ? (body.rates as unknown[]) : null;
  if (!list || list.length === 0 || list.length > 50) {
    return NextResponse.json(
      { error: 'Send between 1 and 50 rates' },
      { status: 400 }
    );
  }
  const db = supabaseAdmin();
  const settings = await getLoyaltySettings(db, ctx.accountId);
  const today = formatLocalDate(localDate(new Date(), settings.timezone));
  const results = await upsertMetalRates(
    db,
    ctx.accountId,
    ctx.userId,
    list,
    today
  );
  return NextResponse.json({ results });
}
