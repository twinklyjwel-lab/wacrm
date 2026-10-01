// ============================================================
// CSV / Excel import mapping — pure, browser-safe.
//
// The dashboard reads a CSV or .xlsx file into a grid of cells, guesses
// which column holds which field (Vasy and most Indian billing exports
// use headers like "Bill No", "Mobile", "Net Wt", "Rate"), lets the
// user correct the mapping, then turns rows into API payloads:
//   - invoices: one row per invoice LINE, grouped by invoice number
//   - inventory items: one row per article
//   - customers: phone + birthday / anniversary
// ============================================================

export type ImportKind = 'invoices' | 'inventory' | 'customers';

export interface FieldDef {
  key: string;
  required?: boolean;
  /** Lower-cased header aliases, compared after stripping punctuation. */
  aliases: string[];
}

export const IMPORT_FIELDS: Record<ImportKind, FieldDef[]> = {
  invoices: [
    {
      key: 'external_id',
      required: true,
      aliases: [
        'invoice no',
        'invoice number',
        'bill no',
        'bill number',
        'voucher no',
        'invoice',
        'inv no',
        'external id',
      ],
    },
    {
      key: 'invoice_date',
      aliases: ['invoice date', 'bill date', 'date', 'voucher date'],
    },
    {
      // Optional: exports without a mobile column are matched to
      // existing customers by name (see ingestInvoice).
      key: 'phone',
      aliases: [
        'mobile',
        'mobile no',
        'phone',
        'phone number',
        'contact',
        'contact no',
        'customer mobile',
        'whatsapp',
      ],
    },
    {
      key: 'name',
      aliases: ['customer name', 'customer', 'party name', 'name', 'party'],
    },
    {
      // Invoice status — cancelled / void rows are skipped.
      key: 'status',
      aliases: ['status', 'invoice status', 'bill status'],
    },
    {
      key: 'customer_code',
      aliases: ['customer code', 'customer id', 'party code', 'ledger code'],
    },
    { key: 'email', aliases: ['email', 'email id'] },
    {
      key: 'birthday',
      aliases: ['birthday', 'birth date', 'date of birth', 'dob'],
    },
    {
      key: 'anniversary',
      aliases: [
        'anniversary',
        'anniversary date',
        'marriage anniversary',
        'doa',
      ],
    },
    {
      key: 'sku',
      aliases: ['tag no', 'tag', 'sku', 'item code', 'barcode', 'tag number'],
    },
    {
      key: 'description',
      aliases: [
        'item',
        'item name',
        'description',
        'product',
        'product name',
        'particulars',
      ],
    },
    { key: 'metal', aliases: ['metal', 'metal type'] },
    {
      key: 'purity',
      aliases: ['purity', 'karat', 'carat', 'touch', 'fineness'],
    },
    {
      key: 'net_weight',
      aliases: ['net wt', 'net weight', 'net wt g', 'weight', 'nwt'],
    },
    {
      key: 'metal_rate_per_gram',
      aliases: [
        'rate',
        'gold rate',
        'silver rate',
        'metal rate',
        'rate per gram',
        'rate g',
      ],
    },
    {
      key: 'making_charge',
      aliases: [
        'making',
        'making charge',
        'making charges',
        'mc',
        'labour',
        'wastage',
      ],
    },
    { key: 'quantity', aliases: ['qty', 'quantity', 'pcs', 'pieces'] },
    {
      key: 'amount',
      aliases: [
        'amount',
        'item amount',
        'line total',
        'value',
        'taxable value',
      ],
    },
    { key: 'discount', aliases: ['discount', 'bill discount'] },
    {
      key: 'tax',
      aliases: ['gst', 'tax', 'gst amount', 'total gst', 'igst', 'cgst sgst'],
    },
    {
      key: 'total',
      aliases: [
        'total',
        'bill total',
        'invoice total',
        'grand total',
        'net amount',
        'net total',
        'bill amount',
      ],
    },
  ],
  inventory: [
    {
      key: 'sku',
      required: true,
      aliases: ['tag no', 'tag', 'sku', 'item code', 'barcode', 'tag number'],
    },
    {
      key: 'name',
      aliases: [
        'item',
        'item name',
        'name',
        'description',
        'product',
        'product name',
      ],
    },
    { key: 'category', aliases: ['category', 'group', 'item group', 'type'] },
    { key: 'metal', required: true, aliases: ['metal', 'metal type'] },
    {
      key: 'purity',
      required: true,
      aliases: ['purity', 'karat', 'carat', 'touch', 'fineness'],
    },
    {
      key: 'gross_weight',
      aliases: ['gross wt', 'gross weight', 'gwt', 'gross'],
    },
    {
      key: 'stone_weight',
      aliases: ['stone wt', 'stone weight', 'less wt', 'swt'],
    },
    { key: 'net_weight', aliases: ['net wt', 'net weight', 'nwt'] },
    {
      key: 'making_charge',
      aliases: ['making', 'making charge', 'mc', 'labour'],
    },
    { key: 'making_charge_type', aliases: ['making type', 'mc type'] },
    { key: 'priority', aliases: ['priority'] },
    { key: 'status', aliases: ['status'] },
  ],
  customers: [
    {
      key: 'phone',
      required: true,
      aliases: [
        'mobile',
        'mobile no',
        'phone',
        'phone number',
        'contact',
        'contact no',
        'whatsapp',
      ],
    },
    {
      key: 'name',
      aliases: ['customer name', 'customer', 'party name', 'name'],
    },
    {
      key: 'customer_code',
      aliases: ['customer code', 'customer id', 'party code'],
    },
    { key: 'email', aliases: ['email', 'email id'] },
    {
      key: 'birthday',
      aliases: ['birthday', 'birth date', 'date of birth', 'dob'],
    },
    {
      key: 'anniversary',
      aliases: [
        'anniversary',
        'anniversary date',
        'marriage anniversary',
        'doa',
      ],
    },
  ],
};

export type Mapping = Record<string, number | null>;

function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Guess the column for each field from the header row. */
export function guessMapping(headers: string[], kind: ImportKind): Mapping {
  const normalized = headers.map(normHeader);
  const used = new Set<number>();
  const mapping: Mapping = {};
  for (const field of IMPORT_FIELDS[kind]) {
    let idx = -1;
    // Exact alias match first, in alias priority order.
    for (const alias of field.aliases) {
      idx = normalized.findIndex((h, i) => !used.has(i) && h === alias);
      if (idx >= 0) break;
    }
    if (idx >= 0) used.add(idx);
    mapping[field.key] = idx >= 0 ? idx : null;
  }
  return mapping;
}

export function missingRequired(mapping: Mapping, kind: ImportKind): string[] {
  const missing = IMPORT_FIELDS[kind]
    .filter((f) => f.required && mapping[f.key] == null)
    .map((f) => f.key);
  // Invoices need a way to find the customer: mobile, or failing that, name.
  if (kind === 'invoices' && mapping.phone == null && mapping.name == null) {
    missing.push('phone_or_name');
  }
  return missing;
}

/** Cancelled / voided invoices never earn points. */
export const CANCELLED_STATUS = /cancel|void|delete/i;

/** RFC-4180-ish CSV parser: quotes, escaped quotes, newlines in quotes, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell.trim());
      cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

export type Cell = string | number | boolean | Date | null | undefined;

function cellValue(
  row: Cell[],
  idx: number | null | undefined
): string | number | null {
  if (idx == null) return null;
  const v = row[idx];
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    // Excel dates come back as UTC-midnight Dates.
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return typeof v === 'number' ? v : String(v).trim() || null;
}

/** Pick the mapped fields out of a row. */
export function rowToRecord(
  row: Cell[],
  mapping: Mapping
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [key, idx] of Object.entries(mapping))
    out[key] = cellValue(row, idx);
  return out;
}

const LINE_KEYS = [
  'sku',
  'description',
  'metal',
  'purity',
  'net_weight',
  'metal_rate_per_gram',
  'making_charge',
  'quantity',
  'amount',
] as const;

/**
 * Group invoice-line rows into invoice payloads (POST /api/invoices).
 * Header-level values (date, customer, total…) are taken from the first
 * row of each invoice that has them, so exports that repeat the bill
 * total on every line, or only on the first, both work.
 */
export function groupInvoiceRows(
  rows: Cell[][],
  mapping: Mapping
): Record<string, unknown>[] {
  const byId = new Map<
    string,
    {
      head: Record<string, string | number | null>;
      items: Record<string, unknown>[];
    }
  >();
  for (const row of rows) {
    const r = rowToRecord(row, mapping);
    const id = r.external_id == null ? '' : String(r.external_id).trim();
    // Rows without an invoice number (e.g. a trailing "Total" row) and
    // cancelled invoices are skipped.
    if (!id) continue;
    if (r.status != null && CANCELLED_STATUS.test(String(r.status))) continue;
    let entry = byId.get(id);
    if (!entry) {
      entry = { head: {}, items: [] };
      byId.set(id, entry);
    }
    for (const [k, v] of Object.entries(r)) {
      if (v != null && entry.head[k] == null) entry.head[k] = v;
    }
    const hasLine = LINE_KEYS.some((k) => r[k] != null && k !== 'quantity');
    if (hasLine) {
      const item: Record<string, unknown> = {};
      for (const k of LINE_KEYS) if (r[k] != null) item[k] = r[k];
      entry.items.push(item);
    }
  }
  return [...byId.entries()].map(([id, { head, items }]) => ({
    external_id: id,
    invoice_date: head.invoice_date ?? undefined,
    customer: {
      phone: head.phone == null ? undefined : String(head.phone),
      name: head.name ?? undefined,
      email: head.email ?? undefined,
      customer_code:
        head.customer_code == null ? undefined : String(head.customer_code),
      birthday: head.birthday ?? undefined,
      anniversary: head.anniversary ?? undefined,
    },
    items,
    discount: head.discount ?? undefined,
    tax: head.tax ?? undefined,
    total: head.total ?? undefined,
  }));
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
