// ============================================================
// GET  /api/v1/invoices — list invoices (scope: invoices:read)
// POST /api/v1/invoices — push invoices (scope: invoices:write)
//
// POST accepts one invoice object or `{ "invoices": [...] }` (≤ 200).
// Each invoice is idempotent on `external_id` (the ERP invoice
// number), finds-or-creates the customer by phone, records the lines
// (with the metal rate per gram at purchase), marks matching inventory
// SKUs sold, credits loyalty points and queues the next-morning
// feedback WhatsApp. An optional `pdf_base64` attaches the invoice PDF.
// Responds 200 with a per-invoice result list; see docs/loyalty.md.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { ingestInvoiceBatch, MAX_BATCH } from '@/lib/loyalty/batch';

export const maxDuration = 60;

const INVOICE_SELECT =
  'id, external_id, source, invoice_date, subtotal, making_total, discount, tax, total, points_earned, points_redeemed, redeemed_value, created_at, contact:contacts(id, name, phone), items:invoice_items(sku, description, metal, purity, net_weight, metal_rate_per_gram, making_charge, quantity, amount)';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'invoices:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const contactId = url.searchParams.get('contact_id');
    const externalId = url.searchParams.get('external_id');

    let query = ctx.supabase
      .from('invoices')
      .select(INVOICE_SELECT)
      .eq('account_id', ctx.accountId);
    if (contactId) query = query.eq('contact_id', contactId);
    if (externalId) query = query.eq('external_id', externalId);
    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/invoices] list error:', error);
      return fail('internal', 'Failed to list invoices', 500);
    }
    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(items, nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'invoices:write');
    const body = (await request.json().catch(() => null)) as unknown;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }
    const list = Array.isArray((body as { invoices?: unknown }).invoices)
      ? (body as { invoices: unknown[] }).invoices
      : [body];
    if (list.length === 0)
      return fail('bad_request', "'invoices' is empty", 400);
    if (list.length > MAX_BATCH) {
      return fail(
        'bad_request',
        `At most ${MAX_BATCH} invoices per request`,
        400
      );
    }
    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const results = await ingestInvoiceBatch(
      ctx.supabase,
      ctx.accountId,
      auditUserId,
      list,
      'api'
    );
    return ok({ results });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
