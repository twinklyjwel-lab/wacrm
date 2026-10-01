import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { attachInvoicePdf } from '@/lib/loyalty/batch'
import { InvoiceInputError } from '@/lib/loyalty/invoices'

// Attach / replace the invoice PDF (multipart field "file"). It is sent
// as the document header of the next-morning feedback WhatsApp.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { id } = await params
  const db = supabaseAdmin()
  const { data: invoice } = await db
    .from('invoices')
    .select('id')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Attach a PDF in the "file" field' }, { status: 400 })
  }
  try {
    const path = await attachInvoicePdf(db, ctx.accountId, id, new Uint8Array(await file.arrayBuffer()))
    return NextResponse.json({ pdf_path: path })
  } catch (err) {
    const status = err instanceof InvoiceInputError ? 400 : 500
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status })
  }
}
