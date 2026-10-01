// ============================================================
// Jewellery CRM tools — invoices, loyalty points, gold / silver
// inventory and daily metal rates.
//
// Reads are always registered; writes (pushing invoices, updating
// stock / rates, redeeming points) only with WACRM_ENABLE_WRITES.
// Scopes are enforced by the CRM: invoices:read|write,
// loyalty:read|write, inventory:read|write.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import { handle, jsonResult } from './shared.js';

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
const WRITE = { readOnlyHint: false, openWorldHint: true } as const;

const metal = z.enum(['gold', 'silver']);

const invoiceSchema = z.object({
  external_id: z
    .string()
    .describe(
      'Invoice number from the billing software (e.g. "TJ-26-10"). Re-sending the same number is ignored.'
    ),
  invoice_date: z
    .string()
    .optional()
    .describe('YYYY-MM-DD or DD/MM/YYYY. Defaults to today.'),
  customer: z
    .object({
      phone: z
        .string()
        .optional()
        .describe('Mobile number; 10-digit Indian numbers get +91.'),
      name: z
        .string()
        .optional()
        .describe(
          'Customer name. Without a phone it must exactly match one existing customer.'
        ),
      email: z.string().optional(),
      customer_code: z.string().optional(),
      birthday: z
        .string()
        .optional()
        .describe('Birthday, YYYY-MM-DD or DD/MM/YYYY.'),
      anniversary: z
        .string()
        .optional()
        .describe('Anniversary, YYYY-MM-DD or DD/MM/YYYY.'),
    })
    .describe('Who bought it — phone, or an exact existing name.'),
  items: z
    .array(
      z.object({
        sku: z
          .string()
          .optional()
          .describe('Tag number; matching stock is marked sold.'),
        description: z.string(),
        metal: metal.optional(),
        purity: z.string().optional().describe('e.g. 22K, 18K, 925.'),
        net_weight: z.number().optional().describe('Grams.'),
        metal_rate_per_gram: z
          .number()
          .optional()
          .describe('Rate the customer was billed at.'),
        making_charge: z.number().optional(),
        quantity: z.number().int().optional(),
        amount: z.number(),
      })
    )
    .optional(),
  discount: z.number().optional(),
  tax: z
    .number()
    .optional()
    .describe(
      'GST amount. If omitted, the total is treated as GST-inclusive (3% by default).'
    ),
  total: z
    .number()
    .optional()
    .describe('Invoice total. Points = (total − GST) / 100.'),
  notes: z.string().optional(),
});

const inventorySchema = z.object({
  sku: z.string().describe('Tag number / SKU (unique).'),
  name: z.string().optional(),
  category: z.string().optional(),
  metal,
  purity: z.string(),
  gross_weight: z.number().optional(),
  stone_weight: z.number().optional(),
  net_weight: z.number().optional().describe('Defaults to gross − stone.'),
  making_charge_type: z.enum(['per_gram', 'percent', 'fixed']).optional(),
  making_charge: z.number().optional(),
  priority: z.number().int().optional().describe('Higher shows first.'),
  status: z.enum(['in_stock', 'reserved', 'sold']).optional(),
  notes: z.string().optional(),
});

export function registerJewelleryReadTools(
  server: McpServer,
  client: WacrmClient
): void {
  server.registerTool(
    'list_invoices',
    {
      title: 'List invoices',
      description:
        'List purchase invoices with their lines (metal, purity, weight, rate per gram at purchase), totals and points earned / redeemed. Filter by contact_id (find it with list_contacts) or by invoice number. Paginated.',
      inputSchema: {
        contact_id: z
          .string()
          .optional()
          .describe('Only this customer’s invoices.'),
        external_id: z.string().optional().describe('Exact invoice number.'),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      annotations: { ...READ_ONLY, title: 'List invoices' },
    },
    handle(async (args) => jsonResult(await client.listInvoices(args)))
  );

  server.registerTool(
    'get_customer_loyalty',
    {
      title: 'Get customer loyalty points',
      description:
        "A customer's loyalty balance: lifetime points, active points and their ₹ value today, expired points, upcoming expiry dates, and when bonus-rate (₹1.5) points drop to ₹1. Find the contact id with list_contacts (search by name or phone).",
      inputSchema: { contact_id: z.string().describe('Contact id.') },
      annotations: { ...READ_ONLY, title: 'Get customer loyalty points' },
    },
    handle(async ({ contact_id }) =>
      jsonResult(await client.getContactLoyalty(contact_id))
    )
  );

  server.registerTool(
    'list_inventory',
    {
      title: 'List inventory',
      description:
        'List gold / silver articles: tag, name, purity, gross / stone / net weight, making charge, priority and status. Filter by metal, status, or a search over tag / name / category. Paginated.',
      inputSchema: {
        metal: metal.optional(),
        status: z.enum(['in_stock', 'reserved', 'sold']).optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      annotations: { ...READ_ONLY, title: 'List inventory' },
    },
    handle(async (args) => jsonResult(await client.listInventory(args)))
  );

  server.registerTool(
    'get_metal_rates',
    {
      title: 'Get metal rates',
      description:
        'Latest gold and silver rate per gram for each purity, plus recent history.',
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'Get metal rates' },
    },
    handle(async () => jsonResult(await client.getMetalRates()))
  );
}

export function registerJewelleryWriteTools(
  server: McpServer,
  client: WacrmClient
): void {
  server.registerTool(
    'push_invoices',
    {
      title: 'Push invoices',
      description:
        'Record up to 200 purchase invoices. Each finds or creates the customer, stores the lines, marks matching stock sold, credits loyalty points (1 per ₹100 excluding GST) and queues the next-morning thank-you WhatsApp (only for invoices from the last 3 days). Idempotent on invoice number. Returns a result per invoice — report any failures to the user. Confirm with the user before pushing.',
      inputSchema: { invoices: z.array(invoiceSchema).min(1).max(200) },
      annotations: { ...WRITE, title: 'Push invoices' },
    },
    handle(async ({ invoices }) =>
      jsonResult(await client.pushInvoices(invoices))
    )
  );

  server.registerTool(
    'redeem_points',
    {
      title: 'Redeem loyalty points',
      description:
        "Redeem a customer's points. Oldest points are used first; each is worth its current value (₹1.5 in the first month after purchase, ₹1 after). Returns the ₹ discount to give. Check get_customer_loyalty first and confirm the points and customer with the user — this cannot be undone.",
      inputSchema: {
        contact_id: z.string(),
        points: z.number().int().positive(),
        invoice_id: z
          .string()
          .optional()
          .describe('Invoice the discount is applied to.'),
        note: z.string().optional(),
      },
      annotations: {
        ...WRITE,
        destructiveHint: true,
        title: 'Redeem loyalty points',
      },
    },
    handle(async ({ contact_id, ...body }) =>
      jsonResult(await client.redeemPoints(contact_id, body))
    )
  );

  server.registerTool(
    'upsert_inventory',
    {
      title: 'Add / update inventory',
      description:
        'Create or update up to 200 gold / silver articles, matched by tag number (sku).',
      inputSchema: { items: z.array(inventorySchema).min(1).max(200) },
      annotations: {
        ...WRITE,
        idempotentHint: true,
        title: 'Add / update inventory',
      },
    },
    handle(async ({ items }) => jsonResult(await client.upsertInventory(items)))
  );

  server.registerTool(
    'set_metal_rates',
    {
      title: 'Set metal rates',
      description:
        'Set the gold / silver rate per gram for a day (defaults to today, India time).',
      inputSchema: {
        rates: z
          .array(
            z.object({
              metal,
              purity: z.string().describe('e.g. 24K, 22K, 18K, 999, 925.'),
              rate_per_gram: z.number().positive(),
              effective_date: z.string().optional().describe('YYYY-MM-DD.'),
            })
          )
          .min(1)
          .max(50),
      },
      annotations: { ...WRITE, idempotentHint: true, title: 'Set metal rates' },
    },
    handle(async ({ rates }) => jsonResult(await client.setMetalRates(rates)))
  );
}
