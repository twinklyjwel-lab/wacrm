// ============================================================
// GET  /api/v1/inventory — list items (scope: inventory:read).
//      Filters: ?metal=gold|silver, ?status=in_stock|reserved|sold,
//      ?search= (tag / name / category). Highest priority first.
// POST /api/v1/inventory — upsert inventory items by SKU / tag number
// (scope: inventory:write). Body: one item or `{ "items": [...] }`.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import { MAX_BATCH, upsertInventoryBatch } from '@/lib/loyalty/batch';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'inventory:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const metal = url.searchParams.get('metal');
    const status = url.searchParams.get('status');
    const search = (url.searchParams.get('search') ?? '')
      .replace(/[^\p{L}\p{N} \-_./]/gu, '')
      .trim();

    let query = ctx.supabase
      .from('inventory_items')
      .select('*')
      .eq('account_id', ctx.accountId);
    if (metal === 'gold' || metal === 'silver')
      query = query.eq('metal', metal);
    if (status === 'in_stock' || status === 'reserved' || status === 'sold') {
      query = query.eq('status', status);
    }
    if (search) {
      query = query.or(
        `sku.ilike.*${search}*,name.ilike.*${search}*,category.ilike.*${search}*`
      );
    }
    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/inventory] list error:', error);
      return fail('internal', 'Failed to list inventory', 500);
    }
    const { items, nextCursor } = buildPage(
      (data ?? []) as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(items, nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'inventory:write');
    const body = (await request.json().catch(() => null)) as unknown;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }
    const list = Array.isArray((body as { items?: unknown }).items)
      ? (body as { items: unknown[] }).items
      : [body];
    if (list.length === 0 || list.length > MAX_BATCH) {
      return fail('bad_request', `Send between 1 and ${MAX_BATCH} items`, 400);
    }
    const results = await upsertInventoryBatch(
      ctx.supabase,
      ctx.accountId,
      ctx.createdBy,
      list
    );
    return ok({ results });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
