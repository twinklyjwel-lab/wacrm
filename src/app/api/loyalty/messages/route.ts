import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

// Retry a failed/skipped retention message, or cancel a pending one (agent+).
export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }
  const body = await request.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  const action = body?.action
  if (!id || (action !== 'retry' && action !== 'cancel')) {
    return NextResponse.json({ error: 'id and action (retry | cancel) are required' }, { status: 400 })
  }
  const db = supabaseAdmin()
  const query =
    action === 'retry'
      ? db
          .from('loyalty_scheduled_messages')
          .update({ status: 'pending', attempts: 0, last_error: null, send_at: new Date().toISOString() })
          .in('status', ['failed', 'skipped', 'cancelled'])
      : db.from('loyalty_scheduled_messages').update({ status: 'cancelled' }).eq('status', 'pending')
  const { data, error } = await query.eq('id', id).eq('account_id', ctx.accountId).select('id').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Message not found or not in a state that allows this' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
