import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { ingestInvoiceBatch, MAX_BATCH } from '@/lib/loyalty/batch';

export const maxDuration = 60;

// Create invoices from the dashboard — manual entry or a CSV / Excel
// import batch (the browser parses the file and sends grouped invoices).
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }
  const body = await request.json().catch(() => null);
  const list = Array.isArray(body?.invoices)
    ? (body.invoices as unknown[])
    : null;
  const source = body?.source === 'csv' ? 'csv' : 'manual';
  if (!list || list.length === 0 || list.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Send between 1 and ${MAX_BATCH} invoices` },
      { status: 400 }
    );
  }
  const results = await ingestInvoiceBatch(
    supabaseAdmin(),
    ctx.accountId,
    ctx.userId,
    list,
    source
  );
  return NextResponse.json({ results });
}
