import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { MAX_BATCH, upsertInventoryBatch } from '@/lib/loyalty/batch';

// Create / update inventory items by SKU (single item or CSV import batch).
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }
  const body = await request.json().catch(() => null);
  const list = Array.isArray(body?.items) ? (body.items as unknown[]) : null;
  if (!list || list.length === 0 || list.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Send between 1 and ${MAX_BATCH} items` },
      { status: 400 }
    );
  }
  const results = await upsertInventoryBatch(
    supabaseAdmin(),
    ctx.accountId,
    ctx.userId,
    list
  );
  return NextResponse.json({ results });
}
