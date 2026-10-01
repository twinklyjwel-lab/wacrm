import { describe, expect, it } from 'vitest';

import {
  includedGst,
  InvoiceInputError,
  normalizeName,
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

describe('Vasy-style invoices', () => {
  it('accepts a name instead of a mobile and leaves GST unknown', () => {
    const inv = validateInvoiceInput({
      external_id: 'TJ-26-10',
      invoice_date: '27/09/2026',
      customer: { name: 'Deepti S ' },
      total: 5550,
    });
    expect(inv.customer.phone).toBeNull();
    expect(inv.customer.name).toBe('Deepti S');
    expect(inv.tax).toBeNull();
    expect(inv.total).toBe(5550);
  });
  it('needs a mobile or a name', () => {
    expect(() =>
      validateInvoiceInput({ external_id: 'X', customer: {} })
    ).toThrow(/phone or customer.name/);
  });
  it('backs out included GST', () => {
    expect(includedGst(5550, 3)).toBe(161.65);
    expect(includedGst(103, 3)).toBe(3);
    expect(includedGst(1000, 0)).toBe(0);
  });
  it('reads Excel serial dates', () => {
    expect(parseFlexibleDate(46292)).toBe('2026-09-27');
    expect(parseFlexibleDate('46292')).toBe('2026-09-27');
  });
  it('normalises names for matching', () => {
    expect(normalizeName('  Rinky  Singh ')).toBe('rinky singh');
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
