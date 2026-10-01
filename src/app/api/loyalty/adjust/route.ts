import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { creditLot, getLoyaltySettings } from '@/lib/loyalty/service'

// Manually credit bonus points (admin+). Follows the normal bonus /
// expiry windows from today and gets expiry reminders like any lot.
export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }
  const body = await request.json().catch(() => null)
  const contactId = typeof body?.contact_id === 'string' ? body.contact_id : ''
  const points = Number(body?.points)
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : ''
  if (!contactId || !Number.isInteger(points) || points <= 0 || points > 1_000_000) {
    return NextResponse.json({ error: 'contact_id and a positive whole number of points are required' }, { status: 400 })
  }
  if (!note) return NextResponse.json({ error: 'A reason is required' }, { status: 400 })

  const db = supabaseAdmin()
  const { data: contact } = await db
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (!contact) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  try {
    const settings = await getLoyaltySettings(db, ctx.accountId)
    const lot = await creditLot(
      db,
      ctx.accountId,
      { contactId, points, source: 'manual', earnedAt: new Date(), note, createdBy: ctx.userId },
      settings,
    )
    return NextResponse.json({ lot }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
