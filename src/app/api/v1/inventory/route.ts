// ============================================================
// POST /api/v1/inventory — upsert inventory items by SKU / tag number
// (scope: inventory:write). Body: one item or `{ "items": [...] }`.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { MAX_BATCH, upsertInventoryBatch } from '@/lib/loyalty/batch';

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
