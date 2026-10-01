import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { runLoyaltyCron } from '@/lib/loyalty/cron';

// Sending a batch of templates can take a while; give the tick headroom.
export const maxDuration = 60;

/**
 * Loyalty / retention tick: birthday + anniversary sweep (once per
 * store-local day, at or after the send hour) and draining due
 * `loyalty_scheduled_messages` (feedback, expiry reminders, wishes).
 *
 * Hit it every ~15 minutes from an external scheduler with the same
 * `x-cron-secret` header as /api/automations/cron
 * (`AUTOMATION_CRON_SECRET`). See docs/loyalty.md.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runLoyaltyCron(supabaseAdmin());
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'loyalty cron failed';
    console.error('[loyalty] cron failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
