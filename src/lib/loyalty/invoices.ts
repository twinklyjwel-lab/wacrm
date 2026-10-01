// ============================================================
// Invoice ingest — shared by the public API (POST /api/v1/invoices),
// the CSV/Excel importer and manual entry in the dashboard.
//
//   validateInvoiceInput()  pure; normalises + validates a payload
//   ingestInvoice()         finds/creates the customer, inserts the
//                           invoice + lines, marks sold stock, credits
//                           points and queues the feedback message.
//
// Idempotent on (account, external_id): a repeat returns the existing
// invoice untouched, so re-uploading the same ERP export is safe.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findOrCreateContact } from '@/lib/api/v1/contacts';
import { creditInvoice } from './service';
import type { LoyaltySettings, Metal } from './types';

export interface InvoiceLineInput {
  sku?: string | null;
  description: string;
  metal?: Metal | null;
  purity?: string | null;
  net_weight?: number;
  metal_rate_per_gram?: number | null;
  making_charge?: number;
  quantity?: number;
  amount: number;
}

export interface InvoiceCustomerInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  customer_code?: string | null;
  birthday?: string | null;
  anniversary?: string | null;
}

export interface InvoiceInput {
  external_id: string;
  invoice_date?: string | null;
  customer: InvoiceCustomerInput;
  items: InvoiceLineInput[];
  subtotal?: number | null;
  making_total?: number | null;
  discount?: number | null;
  tax?: number | null;
  total?: number | null;
  notes?: string | null;
}

export class InvoiceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceInputError';
  }
}

/** Default country code for 10-digit Indian mobile numbers. */
export const DEFAULT_COUNTRY_CODE = '91';

/** Normalise a phone typed the Indian way ("98765 43210", "098765…"). */
export function normalizeIndianPhone(
  raw: string,
  countryCode = DEFAULT_COUNTRY_CODE
): string {
  const trimmed = String(raw ?? '').trim();
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (hasPlus) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) return `+${countryCode}${digits}`;
  return `+${digits}`;
}

function num(
  v: unknown,
  field: string,
  { allowNull = true } = {}
): number | null {
  if (v === undefined || v === null || v === '') {
    if (allowNull) return null;
    throw new InvoiceInputError(`${field} is required`);
  }
  const n =
    typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, ''));
  if (!Number.isFinite(n))
    throw new InvoiceInputError(`${field} must be a number`);
  return n;
}

/** Accepts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY (Indian order) or ISO. */
export function parseFlexibleDate(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date)
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return toIsoDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return toIsoDate(+m[3], +m[2], +m[1]);
  return null;
}

function toIsoDate(y: number, mo: number, d: number): string | null {
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (
    t.getUTCFullYear() !== y ||
    t.getUTCMonth() !== mo - 1 ||
    t.getUTCDate() !== d
  )
    return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Invoice timestamps: a full ISO timestamp is kept; a bare date is
 * taken as midday IST so it lands on the right local day.
 */
export function parseInvoiceDate(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const day = parseFlexibleDate(v);
  return day ? `${day}T12:00:00+05:30` : null;
}

function metal(v: unknown): Metal | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (s.startsWith('g') || s === 'au') return 'gold';
  if (s.startsWith('s') || s === 'ag') return 'silver';
  throw new InvoiceInputError(`metal must be "gold" or "silver" (got "${v}")`);
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export interface NormalizedInvoice {
  external_id: string;
  invoice_date: string;
  customer: {
    phone: string;
    name: string | null;
    email: string | null;
    customer_code: string | null;
    birthday: string | null;
    anniversary: string | null;
  };
  lines: {
    sku: string | null;
    description: string;
    metal: Metal | null;
    purity: string | null;
    net_weight: number;
    metal_rate_per_gram: number | null;
    making_charge: number;
    quantity: number;
    amount: number;
  }[];
  subtotal: number;
  making_total: number;
  discount: number;
  tax: number;
  total: number;
  notes: string | null;
}

export function validateInvoiceInput(
  raw: unknown,
  now = new Date()
): NormalizedInvoice {
  if (!raw || typeof raw !== 'object')
    throw new InvoiceInputError('invoice must be an object');
  const r = raw as Record<string, unknown>;
  const external_id = str(r.external_id ?? r.invoice_no);
  if (!external_id)
    throw new InvoiceInputError('external_id (invoice number) is required');

  const c = (r.customer ?? {}) as Record<string, unknown>;
  const phone = normalizeIndianPhone(String(c.phone ?? ''));
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    throw new InvoiceInputError(
      `customer.phone is missing or invalid for invoice ${external_id}`
    );
  }

  const rawDate = r.invoice_date;
  const invoice_date = rawDate ? parseInvoiceDate(rawDate) : now.toISOString();
  if (!invoice_date)
    throw new InvoiceInputError(
      `invoice_date is invalid for invoice ${external_id}`
    );

  const rawItems = Array.isArray(r.items) ? r.items : [];
  const lines = rawItems.map((it, i) => {
    const li = (it ?? {}) as Record<string, unknown>;
    const description = str(li.description) ?? str(li.sku) ?? `Item ${i + 1}`;
    return {
      sku: str(li.sku),
      description,
      metal: metal(li.metal),
      purity: str(li.purity),
      net_weight: num(li.net_weight, `items[${i}].net_weight`) ?? 0,
      metal_rate_per_gram: num(
        li.metal_rate_per_gram,
        `items[${i}].metal_rate_per_gram`
      ),
      making_charge: num(li.making_charge, `items[${i}].making_charge`) ?? 0,
      quantity: Math.max(
        1,
        Math.round(num(li.quantity, `items[${i}].quantity`) ?? 1)
      ),
      amount: num(li.amount, `items[${i}].amount`) ?? 0,
    };
  });

  const subtotal =
    num(r.subtotal, 'subtotal') ?? lines.reduce((s, l) => s + l.amount, 0);
  const making_total =
    num(r.making_total, 'making_total') ??
    lines.reduce((s, l) => s + l.making_charge, 0);
  const discount = num(r.discount, 'discount') ?? 0;
  const tax = num(r.tax, 'tax') ?? 0;
  const total = num(r.total, 'total') ?? subtotal - discount + tax;
  if (total < 0)
    throw new InvoiceInputError(
      `total cannot be negative for invoice ${external_id}`
    );

  const birthday = parseFlexibleDate(c.birthday);
  const anniversary = parseFlexibleDate(c.anniversary);
  if (c.birthday && !birthday)
    throw new InvoiceInputError('customer.birthday is not a valid date');
  if (c.anniversary && !anniversary) {
    throw new InvoiceInputError('customer.anniversary is not a valid date');
  }

  return {
    external_id,
    invoice_date,
    customer: {
      phone,
      name: str(c.name),
      email: str(c.email),
      customer_code: str(c.customer_code),
      birthday,
      anniversary,
    },
    lines,
    subtotal: round2(subtotal),
    making_total: round2(making_total),
    discount: round2(discount),
    tax: round2(tax),
    total: round2(total),
    notes: str(r.notes),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface IngestResult {
  invoiceId: string;
  contactId: string;
  created: boolean;
  pointsEarned: number;
}

/** Apply customer profile fields that came with an invoice. */
export async function updateCustomerProfile(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  customer: NormalizedInvoice['customer']
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (customer.birthday) patch.birthday = customer.birthday;
  if (customer.anniversary) patch.anniversary = customer.anniversary;
  if (customer.customer_code) patch.customer_code = customer.customer_code;
  if (customer.email) patch.email = customer.email;
  if (Object.keys(patch).length === 0) return;
  const { error } = await db
    .from('contacts')
    .update(patch)
    .eq('id', contactId)
    .eq('account_id', accountId);
  if (error) {
    // A duplicate customer_code shouldn't sink the invoice — retry without it.
    if ((error as { code?: string }).code === '23505' && patch.customer_code) {
      delete patch.customer_code;
      if (Object.keys(patch).length > 0) {
        await db
          .from('contacts')
          .update(patch)
          .eq('id', contactId)
          .eq('account_id', accountId);
      }
      return;
    }
    throw new Error(`customer update failed: ${error.message}`);
  }
}

export async function ingestInvoice(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  invoice: NormalizedInvoice,
  source: 'manual' | 'csv' | 'api' | 'vasy',
  settings: LoyaltySettings,
  now = new Date()
): Promise<IngestResult> {
  const { data: existing } = await db
    .from('invoices')
    .select('id, contact_id, points_earned')
    .eq('account_id', accountId)
    .eq('external_id', invoice.external_id)
    .maybeSingle();
  if (existing) {
    return {
      invoiceId: existing.id as string,
      contactId: existing.contact_id as string,
      created: false,
      pointsEarned: Number(existing.points_earned ?? 0),
    };
  }

  const contact = await findOrCreateContact(db, accountId, auditUserId, {
    phone: invoice.customer.phone,
    name: invoice.customer.name,
    email: invoice.customer.email,
  });
  if (!contact.created && invoice.customer.name) {
    // Fill a placeholder name (contacts created from an inbound message
    // are named after their phone or WhatsApp profile).
    const { data: c } = await db
      .from('contacts')
      .select('name, phone')
      .eq('id', contact.id)
      .maybeSingle();
    if (
      c &&
      (!c.name || c.name === c.phone || /^\+?\d+$/.test(String(c.name)))
    ) {
      await db
        .from('contacts')
        .update({ name: invoice.customer.name })
        .eq('id', contact.id);
    }
  }
  await updateCustomerProfile(db, accountId, contact.id, invoice.customer);

  const { data: inserted, error: insErr } = await db
    .from('invoices')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      contact_id: contact.id,
      external_id: invoice.external_id,
      source,
      invoice_date: invoice.invoice_date,
      subtotal: invoice.subtotal,
      making_total: invoice.making_total,
      discount: invoice.discount,
      tax: invoice.tax,
      total: invoice.total,
      notes: invoice.notes,
    })
    .select('id, contact_id, external_id, invoice_date, total, tax')
    .single();
  if (insErr || !inserted) {
    if ((insErr as { code?: string } | null)?.code === '23505') {
      // Concurrent import of the same invoice — the other one won.
      const { data: raced } = await db
        .from('invoices')
        .select('id, contact_id, points_earned')
        .eq('account_id', accountId)
        .eq('external_id', invoice.external_id)
        .single();
      return {
        invoiceId: raced!.id as string,
        contactId: raced!.contact_id as string,
        created: false,
        pointsEarned: Number(raced!.points_earned ?? 0),
      };
    }
    throw new Error(
      `invoice insert failed: ${insErr?.message ?? 'unknown error'}`
    );
  }
  const invoiceId = inserted.id as string;

  if (invoice.lines.length > 0) {
    const skus = invoice.lines
      .map((l) => l.sku)
      .filter((s): s is string => !!s);
    const stockBySku = new Map<string, string>();
    if (skus.length > 0) {
      const { data: stock } = await db
        .from('inventory_items')
        .select('id, sku')
        .eq('account_id', accountId)
        .in('sku', skus);
      for (const s of stock ?? [])
        stockBySku.set(s.sku as string, s.id as string);
    }
    const { error: lineErr } = await db.from('invoice_items').insert(
      invoice.lines.map((l) => ({
        account_id: accountId,
        invoice_id: invoiceId,
        inventory_item_id: l.sku ? (stockBySku.get(l.sku) ?? null) : null,
        ...l,
      }))
    );
    if (lineErr) {
      await db.from('invoices').delete().eq('id', invoiceId);
      throw new Error(`invoice lines insert failed: ${lineErr.message}`);
    }
    const soldIds = [
      ...new Set(
        invoice.lines.map((l) => (l.sku ? stockBySku.get(l.sku) : undefined))
      ),
    ].filter((id): id is string => !!id);
    if (soldIds.length > 0) {
      await db
        .from('inventory_items')
        .update({ status: 'sold', sold_invoice_id: invoiceId })
        .eq('account_id', accountId)
        .in('id', soldIds);
    }
  }

  const { points } = await creditInvoice(
    db,
    accountId,
    {
      id: invoiceId,
      contact_id: contact.id,
      external_id: invoice.external_id,
      invoice_date: inserted.invoice_date as string,
      total: Number(inserted.total),
      tax: Number(inserted.tax),
    },
    settings,
    now
  );

  return {
    invoiceId,
    contactId: contact.id,
    created: true,
    pointsEarned: points,
  };
}
