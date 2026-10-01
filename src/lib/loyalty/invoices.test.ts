import { describe, expect, it } from 'vitest';

import {
  InvoiceInputError,
  normalizeIndianPhone,
  parseFlexibleDate,
  parseInvoiceDate,
  validateInvoiceInput,
} from './invoices';

describe('normalizeIndianPhone', () => {
  it.each([
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['0044 7700 900123', '+447700900123'],
    ['', ''],
  ])('%s → %s', (raw, out) => {
    expect(normalizeIndianPhone(raw)).toBe(out);
  });
});

describe('dates', () => {
  it('parses Indian day-first and ISO dates', () => {
    expect(parseFlexibleDate('05/03/1990')).toBe('1990-03-05');
    expect(parseFlexibleDate('5-3-1990')).toBe('1990-03-05');
    expect(parseFlexibleDate('1990-03-05')).toBe('1990-03-05');
    expect(parseFlexibleDate('31/02/1990')).toBeNull();
  });
  it('anchors a bare invoice date to midday IST', () => {
    expect(new Date(parseInvoiceDate('01/10/2026')!).toISOString()).toBe(
      '2026-10-01T06:30:00.000Z'
    );
  });
});

describe('validateInvoiceInput', () => {
  it('normalises a full payload', () => {
    const inv = validateInvoiceInput({
      external_id: 'INV-1',
      invoice_date: '2026-10-01',
      customer: { phone: '9876543210', name: 'Priya', birthday: '12/08/1992' },
      items: [
        {
          sku: 'G-001',
          description: 'Gold ring',
          metal: 'Gold',
          purity: '22K',
          net_weight: '4.250',
          metal_rate_per_gram: '7,050',
          making_charge: 2500,
          amount: '₹ 32,462.50',
        },
      ],
      tax: 973.88,
    });
    expect(inv.customer.phone).toBe('+919876543210');
    expect(inv.customer.birthday).toBe('1992-08-12');
    expect(inv.lines[0]).toMatchObject({
      metal: 'gold',
      net_weight: 4.25,
      metal_rate_per_gram: 7050,
      amount: 32462.5,
    });
    expect(inv.subtotal).toBe(32462.5);
    expect(inv.total).toBe(33436.38);
  });

  it('rejects bad payloads with a clear message', () => {
    expect(() =>
      validateInvoiceInput({ customer: { phone: '9876543210' } })
    ).toThrow(InvoiceInputError);
    expect(() =>
      validateInvoiceInput({ external_id: 'X', customer: { phone: '123' } })
    ).toThrow(/phone/);
    expect(() =>
      validateInvoiceInput({
        external_id: 'X',
        customer: { phone: '9876543210' },
        items: [{ metal: 'platinum', amount: 1 }],
      })
    ).toThrow(/metal/);
  });
});
