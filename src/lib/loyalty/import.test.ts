import { describe, expect, it } from 'vitest';

import {
  groupInvoiceRows,
  guessMapping,
  missingRequired,
  parseCsv,
} from './import';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF, embedded newlines and a BOM', () => {
    const text =
      '﻿Bill No,Item,Amount\r\nA1,"Ring, 22K ""Lotus""",1000\r\nA2,"Two\nlines",5\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['Bill No', 'Item', 'Amount'],
      ['A1', 'Ring, 22K "Lotus"', '1000'],
      ['A2', 'Two\nlines', '5'],
    ]);
  });
});

describe('guessMapping', () => {
  it('maps typical billing export headers', () => {
    const headers = [
      'Bill No',
      'Bill Date',
      'Party Name',
      'Mobile No.',
      'Tag No',
      'Item Name',
      'Purity',
      'Net Wt (g)',
      'Rate',
      'Making',
      'Amount',
      'GST',
      'Bill Total',
    ];
    const m = guessMapping(headers, 'invoices');
    expect(m).toMatchObject({
      external_id: 0,
      invoice_date: 1,
      name: 2,
      phone: 3,
      sku: 4,
      description: 5,
      purity: 6,
      net_weight: 7,
      metal_rate_per_gram: 8,
      making_charge: 9,
      amount: 10,
      tax: 11,
      total: 12,
      metal: null,
    });
    expect(missingRequired(m, 'invoices')).toEqual([]);
    expect(
      missingRequired(guessMapping(['Name'], 'customers'), 'customers')
    ).toEqual(['phone']);
  });
});

describe('Vasy "Sales All Data" export', () => {
  const headers = [
    '#',
    'Invoice No.',
    'Invoice Date',
    'Due Date',
    'Customer Name',
    'Net Amount',
    'Paid Amount',
    'Due Amount',
    'Status',
    'Payment Status',
  ];
  const m = guessMapping(headers, 'invoices');

  it('maps the columns it needs and ignores the rest', () => {
    expect(m).toMatchObject({
      external_id: 1,
      invoice_date: 2,
      name: 4,
      total: 5,
      status: 8,
      phone: null,
      tax: null,
    });
    expect(missingRequired(m, 'invoices')).toEqual([]);
  });

  it('skips the Total row and cancelled invoices', () => {
    const out = groupInvoiceRows(
      [
        [
          1,
          'TJ-26-10',
          '27/09/2026',
          '09/09/2026',
          'Deepti S',
          5550,
          5550,
          0,
          'Invoiced',
          'Paid',
        ],
        [
          2,
          'TJ-26-17',
          '10/09/2026',
          '11/09/2026',
          'Abhishek Shrivastava',
          700,
          0,
          700,
          'Invoiced',
          'Over Due',
        ],
        [
          3,
          'TJ-26-18',
          '11/09/2026',
          null,
          'X',
          100,
          0,
          100,
          'Cancelled',
          'Due',
        ],
        ['Total', null, null, null, null, 6350, 5550, 800, null, null],
      ],
      m
    );
    expect(out.map((i) => i.external_id)).toEqual(['TJ-26-10', 'TJ-26-17']);
    expect(out[0]).toMatchObject({
      invoice_date: '27/09/2026',
      customer: { name: 'Deepti S', phone: undefined },
      total: 5550,
      items: [],
    });
  });

  it('requires a mobile or name column', () => {
    expect(missingRequired({ external_id: 0 }, 'invoices')).toEqual([
      'phone_or_name',
    ]);
  });
});

describe('groupInvoiceRows', () => {
  it('groups lines per bill and takes header values from any row', () => {
    const headers = [
      'Bill No',
      'Date',
      'Mobile',
      'Customer',
      'Item',
      'Metal',
      'Amount',
      'Bill Total',
    ];
    const m = guessMapping(headers, 'invoices');
    const rows = [
      ['B-1', '01/10/2026', 9876543210, 'Priya', 'Chain', 'Gold', 50000, null],
      ['B-1', null, null, null, 'Anklet', 'Silver', 3000, 54590],
      [
        'B-2',
        new Date(Date.UTC(2026, 9, 2)),
        '9123456789',
        'Ravi',
        'Coin',
        'Silver',
        1000,
        1030,
      ],
      [null, null, null, null, 'orphan', null, 1, null],
    ];
    const out = groupInvoiceRows(rows, m);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      external_id: 'B-1',
      invoice_date: '01/10/2026',
      customer: { phone: '9876543210', name: 'Priya' },
      total: 54590,
    });
    expect(out[0].items).toEqual([
      { description: 'Chain', metal: 'Gold', amount: 50000 },
      { description: 'Anklet', metal: 'Silver', amount: 3000 },
    ]);
    expect(out[1]).toMatchObject({ invoice_date: '2026-10-02', total: 1030 });
  });
});
