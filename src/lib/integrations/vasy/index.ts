// ============================================================
// Vasy ERP connector — placeholder.
//
// Two ways Vasy invoices reach this app today:
//   1. CSV / Excel export → Invoices → Import (dashboard)
//   2. Anything that can POST JSON → POST /api/v1/invoices with an
//      API key that has the `invoices:write` scope
//
// Once Vasy API docs + credentials are available, implement
// `fetchInvoicesSince` to map Vasy's invoice payload onto
// `InvoiceInput` and call it from a cron tick, feeding the results to
// `ingestInvoiceBatch(db, accountId, auditUserId, invoices, 'vasy')`.
// Ingest is idempotent on the invoice number, so overlapping pulls
// are harmless.
// ============================================================

import type { InvoiceInput } from '@/lib/loyalty/invoices'

export interface VasyCredentials {
  baseUrl: string
  apiKey: string
}

export interface VasyConnector {
  fetchInvoicesSince(since: Date): Promise<InvoiceInput[]>
}

export function createVasyConnector(credentials: VasyCredentials): VasyConnector {
  void credentials
  return {
    async fetchInvoicesSince() {
      throw new Error('Vasy ERP connector is not configured yet — share the Vasy API docs to enable it')
    },
  }
}
