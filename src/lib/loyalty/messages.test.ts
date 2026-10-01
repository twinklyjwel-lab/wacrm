import { describe, expect, it } from 'vitest';

import { buildTemplateBody, expiryDateFromKey } from './messages';

describe('buildTemplateBody', () => {
  it('fills variables in configured order and never sends blanks', () => {
    expect(
      buildTemplateBody(['name', 'points_earned', 'review_url'], {
        name: 'Priya',
        points_earned: '12',
        review_url: '',
      })
    ).toEqual(['Priya', '12', '-']);
  });
});

describe('expiryDateFromKey', () => {
  it('extracts the expiry day from a reminder dedupe key', () => {
    expect(expiryDateFromKey('expiry:3f1c:2027-01-01:7')).toBe('2027-01-01');
    expect(expiryDateFromKey('feedback:abc')).toBeNull();
  });
});
