import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: vi.fn(async () => ({ conversationId: 'conv-1' })),
}));
const sendMessageToConversation = vi.fn(async () => ({
  messageId: 'm',
  whatsappMessageId: 'wamid',
}));
vi.mock('@/lib/whatsapp/send-message', () => ({
  sendMessageToConversation: (...a: unknown[]) =>
    sendMessageToConversation(...(a as [])),
}));

import { sendQueuedMessage, type QueueRow } from './messages';
import { defaultLoyaltySettings, type LoyaltySettings } from './types';

/** Minimal chainable fake: each table returns fixed rows. */
function fakeDb(tables: Record<string, unknown[]>): SupabaseClient {
  const builder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'lte'])
      b[m] = () => b;
    b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    b.single = async () => ({ data: rows[0] ?? null, error: null });
    b.then = (resolve: (v: unknown) => void) =>
      resolve({ data: rows, error: null });
    return b;
  };
  return {
    from: (t: string) => builder(tables[t] ?? []),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: 'https://signed/pdf' },
          error: null,
        }),
      }),
    },
  } as unknown as SupabaseClient;
}

const now = new Date('2026-12-25T04:30:00Z');
const contact = {
  id: 'c1',
  name: 'Priya Sharma',
  phone: '+919876543210',
  loyalty_opt_out: false,
};
const liveLot = {
  id: 'l1',
  contact_id: 'c1',
  invoice_id: 'i1',
  source: 'purchase',
  points: 300,
  remaining: 300,
  earned_at: '2026-10-01T06:30:00Z',
  bonus_until: '2026-11-01T18:29:59.999Z',
  expires_at: '2027-01-01T18:29:59.999Z',
};
const template = {
  id: 't',
  user_id: 'u',
  name: 'points_expiry',
  category: 'Utility',
  language: 'en',
  body_text: 'Hi {{1}}, {{2}} points expire on {{3}}. Worth {{4}}.',
  created_at: '2026-01-01',
};
const row: QueueRow = {
  id: 'q1',
  account_id: 'acc',
  contact_id: 'c1',
  kind: 'expiry_reminder',
  invoice_id: null,
  lot_id: 'l1',
  days_before: 7,
  dedupe_key: 'expiry:c1:2027-01-01:7',
  attempts: 0,
};
const settings: LoyaltySettings = {
  ...defaultLoyaltySettings('acc'),
  templates: {
    expiry_reminder: {
      name: 'points_expiry',
      language: 'en',
      params: ['name', 'expiring_points', 'expiry_date', 'active_value'],
    },
  },
};

describe('sendQueuedMessage', () => {
  it('sends an expiry reminder with the configured variables', async () => {
    const db = fakeDb({
      contacts: [contact],
      loyalty_lots: [liveLot],
      loyalty_redemptions: [],
      message_templates: [template],
    });
    expect(await sendQueuedMessage(db, row, settings, now)).toEqual({
      status: 'sent',
    });
    expect(sendMessageToConversation).toHaveBeenCalledWith(db, 'acc', {
      conversationId: 'conv-1',
      messageType: 'template',
      templateName: 'points_expiry',
      templateLanguage: 'en',
      templateMessageParams: { body: ['Priya', '300', '1 Jan 2027', '₹300'] },
    });
  });

  it('skips a reminder when the points were already redeemed', async () => {
    const db = fakeDb({
      contacts: [contact],
      loyalty_lots: [{ ...liveLot, remaining: 0 }],
      message_templates: [template],
    });
    expect(await sendQueuedMessage(db, row, settings, now)).toMatchObject({
      status: 'skipped',
    });
    expect(sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('skips opted-out customers', async () => {
    const db = fakeDb({ contacts: [{ ...contact, loyalty_opt_out: true }] });
    expect(await sendQueuedMessage(db, row, settings, now)).toMatchObject({
      status: 'skipped',
    });
  });

  it('fails without retry when no template is configured', async () => {
    const db = fakeDb({ contacts: [contact], loyalty_lots: [liveLot] });
    const out = await sendQueuedMessage(
      db,
      row,
      { ...settings, templates: {} },
      now
    );
    expect(out).toMatchObject({ status: 'failed', retry: false });
  });

  it('attaches the invoice PDF to the feedback template', async () => {
    const feedbackTpl = {
      ...template,
      name: 'thanks',
      header_type: 'document',
    };
    const db = fakeDb({
      contacts: [contact],
      loyalty_lots: [liveLot],
      invoices: [
        {
          external_id: 'INV-9',
          invoice_date: '2026-12-24T10:00:00Z',
          total: 30000,
          points_earned: 300,
          pdf_path: 'account-acc/i1.pdf',
        },
      ],
      message_templates: [feedbackTpl],
    });
    const out = await sendQueuedMessage(
      db,
      { ...row, kind: 'feedback', invoice_id: 'i1', dedupe_key: 'feedback:i1' },
      {
        ...settings,
        google_review_url: 'https://g.page/r/x/review',
        templates: { feedback: { name: 'thanks', language: 'en', params: [] } },
      },
      now
    );
    expect(out).toEqual({ status: 'sent' });
    expect(sendMessageToConversation).toHaveBeenCalledWith(
      db,
      'acc',
      expect.objectContaining({
        templateMessageParams: {
          body: ['Priya', '300', '300', 'https://g.page/r/x/review'],
          headerMediaUrl: 'https://signed/pdf',
        },
      })
    );
  });
});
