import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { validateInventoryItem } from '@/lib/loyalty/batch';
import { InvoiceInputError } from '@/lib/loyalty/invoices';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }
  const { id } = await params;
  const body = await request.json().catch(() => null);
  let item;
  try {
    item = validateInventoryItem(body);
  } catch (err) {
    const msg = err instanceof InvoiceInputError ? err.message : 'Invalid item';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin()
    .from('inventory_items')
    .update(item)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select()
    .maybeSingle();
  if (error) {
    const dup = (error as { code?: string }).code === '23505';
    return NextResponse.json(
      { error: dup ? 'Another item already uses this SKU' : error.message },
      { status: dup ? 409 : 500 }
    );
  }
  if (!data)
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  return NextResponse.json({ item: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }
  const { id } = await params;
  const { error } = await supabaseAdmin()
    .from('inventory_items')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
