import { describe, expect, it } from 'vitest';

import {
  decodeBase64Pdf,
  validateInventoryItem,
  validateMetalRate,
} from './batch';

describe('validateInventoryItem', () => {
  it('derives net weight and defaults', () => {
    const item = validateInventoryItem({
      sku: 'G-1',
      metal: 'Gold',
      purity: '22K',
      gross_weight: '10.5',
      stone_weight: 0.75,
    });
    expect(item).toMatchObject({
      sku: 'G-1',
      name: 'G-1',
      metal: 'gold',
      net_weight: 9.75,
      status: 'in_stock',
      making_charge_type: 'per_gram',
    });
  });
  it('rejects missing sku, bad metal and bad status', () => {
    expect(() =>
      validateInventoryItem({ metal: 'gold', purity: '22K' })
    ).toThrow(/sku/);
    expect(() =>
      validateInventoryItem({ sku: 'x', metal: 'copper', purity: '1' })
    ).toThrow(/metal/);
    expect(() =>
      validateInventoryItem({
        sku: 'x',
        metal: 'silver',
        purity: '925',
        status: 'gone',
      })
    ).toThrow(/status/);
  });
});

describe('validateMetalRate', () => {
  it('defaults the date to today', () => {
    expect(
      validateMetalRate(
        { metal: 'silver', purity: '999', rate_per_gram: '92.5' },
        '2026-10-01'
      )
    ).toEqual({
      metal: 'silver',
      purity: '999',
      rate_per_gram: 92.5,
      effective_date: '2026-10-01',
    });
  });
  it('requires a positive rate', () => {
    expect(() =>
      validateMetalRate(
        { metal: 'gold', purity: '24K', rate_per_gram: 0 },
        '2026-10-01'
      )
    ).toThrow();
  });
});

describe('decodeBase64Pdf', () => {
  it('decodes data URLs and rejects junk', () => {
    const b64 = Buffer.from('%PDF-1.4').toString('base64');
    expect(decodeBase64Pdf(`data:application/pdf;base64,${b64}`)?.[0]).toBe(
      0x25
    );
    expect(decodeBase64Pdf(undefined)).toBeNull();
    expect(() => decodeBase64Pdf('not base64!')).toThrow();
  });
});
