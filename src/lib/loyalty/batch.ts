// ============================================================
// Batch helpers shared by the public API and the dashboard importers:
// invoices (with optional PDF), inventory items and metal rates.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ContactError, findOrCreateContact } from '@/lib/api/v1/contacts'
import {
  InvoiceInputError,
  ingestInvoice,
  normalizeIndianPhone,
  parseFlexibleDate,
  updateCustomerProfile,
  validateInvoiceInput,
} from './invoices'
import { getLoyaltySettings } from './service'
import type { Metal } from './types'

export const MAX_BATCH = 200
export const MAX_PDF_BYTES = 16 * 1024 * 1024

export interface InvoiceBatchResult {
  external_id: string | null
  ok: boolean
  created?: boolean
  invoice_id?: string
  contact_id?: string
  points_earned?: number
  error?: string
}

/** Upload a PDF for an invoice into the private `invoices` bucket. */
export async function attachInvoicePdf(
  db: SupabaseClient,
  accountId: string,
  invoiceId: string,
  bytes: Uint8Array,
): Promise<string> {
  if (bytes.byteLength === 0) throw new InvoiceInputError('PDF is empty')
  if (bytes.byteLength > MAX_PDF_BYTES) throw new InvoiceInputError('PDF is larger than 16 MB')
  // %PDF magic bytes — reject anything that isn't a PDF.
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    throw new InvoiceInputError('File is not a PDF')
  }
  const path = `account-${accountId}/${invoiceId}.pdf`
  const { error } = await db.storage
    .from('invoices')
    .upload(path, bytes, { contentType: 'application/pdf', upsert: true })
  if (error) throw new Error(`PDF upload failed: ${error.message}`)
  await db
    .from('invoices')
    .update({ pdf_path: path })
    .eq('id', invoiceId)
    .eq('account_id', accountId)
  return path
}

export function decodeBase64Pdf(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const clean = value.replace(/^data:application\/pdf;base64,/, '').replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+=*$/.test(clean)) throw new InvoiceInputError('pdf_base64 is not valid base64')
  return new Uint8Array(Buffer.from(clean, 'base64'))
}

export async function ingestInvoiceBatch(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  raws: unknown[],
  source: 'manual' | 'csv' | 'api' | 'vasy',
): Promise<InvoiceBatchResult[]> {
  const settings = await getLoyaltySettings(db, accountId)
  const results: InvoiceBatchResult[] = []
  for (const raw of raws) {
    const externalId =
      raw && typeof raw === 'object'
        ? String((raw as Record<string, unknown>).external_id ?? '') || null
        : null
    try {
      const invoice = validateInvoiceInput(raw)
      const pdf = decodeBase64Pdf((raw as Record<string, unknown>).pdf_base64)
      const r = await ingestInvoice(db, accountId, auditUserId, invoice, source, settings)
      if (pdf && r.created) await attachInvoicePdf(db, accountId, r.invoiceId, pdf)
      results.push({
        external_id: invoice.external_id,
        ok: true,
        created: r.created,
        invoice_id: r.invoiceId,
        contact_id: r.contactId,
        points_earned: r.pointsEarned,
      })
    } catch (err) {
      const message =
        err instanceof InvoiceInputError || err instanceof ContactError
          ? err.message
          : 'Failed to save invoice'
      if (!(err instanceof InvoiceInputError) && !(err instanceof ContactError)) {
        console.error('[loyalty] invoice ingest failed:', err)
      }
      results.push({ external_id: externalId, ok: false, error: message })
    }
  }
  return results
}

// ---- Inventory ------------------------------------------------

export interface InventoryItemInput {
  sku: string
  name: string
  category: string | null
  metal: Metal
  purity: string
  gross_weight: number
  stone_weight: number
  net_weight: number
  making_charge_type: 'per_gram' | 'percent' | 'fixed'
  making_charge: number
  priority: number
  status: 'in_stock' | 'reserved' | 'sold'
  notes: string | null
}

function n(v: unknown, field: string, fallback = 0): number {
  if (v === undefined || v === null || v === '') return fallback
  const x = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, ''))
  if (!Number.isFinite(x) || x < 0) throw new InvoiceInputError(`${field} must be a non-negative number`)
  return x
}

function s(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const t = String(v).trim()
  return t || null
}

export function parseMetal(v: unknown): Metal {
  const t = String(v ?? '').trim().toLowerCase()
  if (t.startsWith('g') || t === 'au') return 'gold'
  if (t.startsWith('s') || t === 'ag') return 'silver'
  throw new InvoiceInputError(`metal must be "gold" or "silver" (got "${v ?? ''}")`)
}

export function validateInventoryItem(raw: unknown): InventoryItemInput {
  if (!raw || typeof raw !== 'object') throw new InvoiceInputError('item must be an object')
  const r = raw as Record<string, unknown>
  const sku = s(r.sku ?? r.tag)
  if (!sku) throw new InvoiceInputError('sku (tag number) is required')
  const metal = parseMetal(r.metal)
  const purity = s(r.purity)
  if (!purity) throw new InvoiceInputError(`purity is required for ${sku}`)
  const gross = n(r.gross_weight, 'gross_weight')
  const stone = n(r.stone_weight, 'stone_weight')
  const net = r.net_weight === undefined || r.net_weight === '' ? Math.max(0, gross - stone) : n(r.net_weight, 'net_weight')
  const mct = s(r.making_charge_type) ?? 'per_gram'
  if (!['per_gram', 'percent', 'fixed'].includes(mct)) {
    throw new InvoiceInputError('making_charge_type must be per_gram, percent or fixed')
  }
  const status = s(r.status) ?? 'in_stock'
  if (!['in_stock', 'reserved', 'sold'].includes(status)) {
    throw new InvoiceInputError('status must be in_stock, reserved or sold')
  }
  return {
    sku,
    name: s(r.name) ?? sku,
    category: s(r.category),
    metal,
    purity,
    gross_weight: gross,
    stone_weight: stone,
    net_weight: Math.round(net * 1000) / 1000,
    making_charge_type: mct as InventoryItemInput['making_charge_type'],
    making_charge: n(r.making_charge, 'making_charge'),
    priority: Math.round(Number(r.priority ?? 0)) || 0,
    status: status as InventoryItemInput['status'],
    notes: s(r.notes),
  }
}

export interface RowResult {
  key: string | null
  ok: boolean
  id?: string
  error?: string
}

/** Upsert inventory by (account, sku). */
export async function upsertInventoryBatch(
  db: SupabaseClient,
  accountId: string,
  userId: string | null,
  raws: unknown[],
): Promise<RowResult[]> {
  const results: RowResult[] = []
  const valid: InventoryItemInput[] = []
  for (const raw of raws) {
    try {
      valid.push(validateInventoryItem(raw))
    } catch (err) {
      results.push({
        key: raw && typeof raw === 'object' ? (s((raw as Record<string, unknown>).sku) ?? null) : null,
        ok: false,
        error: err instanceof Error ? err.message : 'invalid item',
      })
    }
  }
  // Last one wins for duplicate SKUs within the batch.
  const bySku = new Map(valid.map((v) => [v.sku, v]))
  if (bySku.size > 0) {
    const { data, error } = await db
      .from('inventory_items')
      .upsert(
        [...bySku.values()].map((v) => ({ ...v, account_id: accountId, user_id: userId })),
        { onConflict: 'account_id,sku' },
      )
      .select('id, sku')
    if (error) {
      for (const sku of bySku.keys()) results.push({ key: sku, ok: false, error: error.message })
    } else {
      for (const row of data ?? []) results.push({ key: row.sku as string, ok: true, id: row.id as string })
    }
  }
  return results
}

export interface MetalRateInput {
  metal: Metal
  purity: string
  rate_per_gram: number
  effective_date: string
}

export function validateMetalRate(raw: unknown, today: string): MetalRateInput {
  if (!raw || typeof raw !== 'object') throw new InvoiceInputError('rate must be an object')
  const r = raw as Record<string, unknown>
  const purity = s(r.purity)
  if (!purity) throw new InvoiceInputError('purity is required')
  const rate = n(r.rate_per_gram, 'rate_per_gram', Number.NaN)
  if (!Number.isFinite(rate) || rate <= 0) throw new InvoiceInputError('rate_per_gram must be positive')
  const date = s(r.effective_date) ?? today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new InvoiceInputError('effective_date must be YYYY-MM-DD')
  return { metal: parseMetal(r.metal), purity, rate_per_gram: rate, effective_date: date }
}

export async function upsertMetalRates(
  db: SupabaseClient,
  accountId: string,
  userId: string | null,
  raws: unknown[],
  today: string,
): Promise<RowResult[]> {
  const results: RowResult[] = []
  const valid: MetalRateInput[] = []
  for (const raw of raws) {
    try {
      valid.push(validateMetalRate(raw, today))
    } catch (err) {
      results.push({ key: null, ok: false, error: err instanceof Error ? err.message : 'invalid rate' })
    }
  }
  if (valid.length > 0) {
    const { data, error } = await db
      .from('metal_rates')
      .upsert(
        valid.map((v) => ({ ...v, account_id: accountId, user_id: userId })),
        { onConflict: 'account_id,metal,purity,effective_date' },
      )
      .select('id, metal, purity')
    if (error) {
      for (const v of valid) results.push({ key: `${v.metal} ${v.purity}`, ok: false, error: error.message })
    } else {
      for (const row of data ?? []) {
        results.push({ key: `${row.metal} ${row.purity}`, ok: true, id: row.id as string })
      }
    }
  }
  return results
}

// ---- Customers (birthday / anniversary import) ---------------

/** Find-or-create customers by phone and set their special dates. */
export async function upsertCustomersBatch(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  raws: unknown[],
): Promise<RowResult[]> {
  const results: RowResult[] = []
  for (const raw of raws) {
    const r = (raw ?? {}) as Record<string, unknown>
    const phone = normalizeIndianPhone(String(r.phone ?? ''))
    try {
      if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new InvoiceInputError('phone is missing or invalid')
      const birthday = parseFlexibleDate(r.birthday)
      const anniversary = parseFlexibleDate(r.anniversary)
      if (r.birthday && !birthday) throw new InvoiceInputError('birthday is not a valid date')
      if (r.anniversary && !anniversary) throw new InvoiceInputError('anniversary is not a valid date')
      const name = s(r.name)
      const contact = await findOrCreateContact(db, accountId, auditUserId, {
        phone,
        name,
        email: s(r.email),
      })
      if (!contact.created && name) {
        await db.from('contacts').update({ name }).eq('id', contact.id).eq('account_id', accountId)
      }
      await updateCustomerProfile(db, accountId, contact.id, {
        phone,
        name,
        email: s(r.email),
        customer_code: s(r.customer_code),
        birthday,
        anniversary,
      })
      results.push({ key: phone, ok: true, id: contact.id })
    } catch (err) {
      const known = err instanceof InvoiceInputError || err instanceof ContactError
      if (!known) console.error('[loyalty] customer import failed:', err)
      results.push({ key: phone || null, ok: false, error: known ? (err as Error).message : 'Failed to save customer' })
    }
  }
  return results
}
