import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { MAX_BATCH, upsertCustomersBatch } from '@/lib/loyalty/batch'

export const maxDuration = 60

// Import customers with birthday / anniversary dates (CSV / Excel).
export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }
  const body = await request.json().catch(() => null)
  const list = Array.isArray(body?.customers) ? (body.customers as unknown[]) : null
  if (!list || list.length === 0 || list.length > MAX_BATCH) {
    return NextResponse.json({ error: `Send between 1 and ${MAX_BATCH} customers` }, { status: 400 })
  }
  const results = await upsertCustomersBatch(supabaseAdmin(), ctx.accountId, ctx.userId, list)
  return NextResponse.json({ results })
}
