import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';

// Invoice detail with a short-lived link to its PDF.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await params;
    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*, contact:contacts(id, name, phone), items:invoice_items(*)')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!invoice)
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    let pdfUrl: string | null = null;
    if (invoice.pdf_path) {
      const { data } = await supabaseAdmin()
        .storage.from('invoices')
        .createSignedUrl(invoice.pdf_path as string, 600);
      pdfUrl = data?.signedUrl ?? null;
    }
    const { data: messages } = await supabase
      .from('loyalty_scheduled_messages')
      .select('id, kind, status, send_at, sent_at, last_error')
      .eq('account_id', accountId)
      .eq('invoice_id', id)
      .order('send_at', { ascending: true });
    return NextResponse.json({ invoice, pdfUrl, messages: messages ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Delete an invoice (admin+). Its points lot and queued messages go with
// it (ON DELETE CASCADE); sold stock is put back in stock.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let ctx;
  try {
    ctx = await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }
  const { id } = await params;
  const db = supabaseAdmin();
  const { data: invoice } = await db
    .from('invoices')
    .select('id, pdf_path')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (!invoice)
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  await db
    .from('inventory_items')
    .update({ status: 'in_stock', sold_invoice_id: null })
    .eq('account_id', ctx.accountId)
    .eq('sold_invoice_id', id);
  const { error } = await db
    .from('invoices')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (invoice.pdf_path)
    await db.storage.from('invoices').remove([invoice.pdf_path as string]);
  return NextResponse.json({ ok: true });
}
