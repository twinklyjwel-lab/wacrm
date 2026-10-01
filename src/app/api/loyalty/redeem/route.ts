import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

// Redeem points for a customer (agent+). FIFO across lots, valued at
// each lot's current rate — done atomically by redeem_loyalty_points().
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }
  const body = await request.json().catch(() => null);
  const contactId = typeof body?.contact_id === 'string' ? body.contact_id : '';
  const points = Number(body?.points);
  const invoiceId =
    typeof body?.invoice_id === 'string' && body.invoice_id
      ? body.invoice_id
      : null;
  const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null;
  if (!contactId || !Number.isInteger(points) || points <= 0) {
    return NextResponse.json(
      {
        error: 'contact_id and a positive whole number of points are required',
      },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const { data: contact } = await db
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (!contact)
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
  if (invoiceId) {
    const { data: inv } = await db
      .from('invoices')
      .select('id')
      .eq('id', invoiceId)
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contactId)
      .maybeSingle();
    if (!inv)
      return NextResponse.json(
        { error: 'Invoice not found for this customer' },
        { status: 404 }
      );
  }

  const { data, error } = await db.rpc('redeem_loyalty_points', {
    p_account_id: ctx.accountId,
    p_contact_id: contactId,
    p_points: points,
    p_invoice_id: invoiceId,
    p_note: note,
    p_user_id: ctx.userId,
  });
  if (error) {
    const insufficient = /insufficient points/i.test(error.message);
    return NextResponse.json(
      { error: insufficient ? 'Not enough active points' : error.message },
      { status: insufficient ? 409 : 500 }
    );
  }
  return NextResponse.json({ redemption: data }, { status: 201 });
}
