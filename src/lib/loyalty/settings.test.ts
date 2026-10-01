import { describe, expect, it } from 'vitest';

import { validateSettingsPatch } from './settings';

describe('validateSettingsPatch', () => {
  it('accepts a full form', () => {
    const r = validateSettingsPatch({
      enabled: true,
      amount_per_point: 100,
      bonus_value: 1.5,
      base_value: 1,
      bonus_months: 1,
      expiry_months: 3,
      birthday_points: 500,
      google_review_url: 'https://g.page/r/abc/review',
      timezone: 'Asia/Kolkata',
      reminder_days: [1, 30, 7, 7],
      points_keywords: [' Points ', 'points', 'Loyalty'],
      templates: {
        feedback: {
          name: 'purchase_thanks',
          language: 'en',
          params: ['name', 'points_earned'],
        },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch.reminder_days).toEqual([30, 7, 1]);
      expect(r.patch.points_keywords).toEqual(['points', 'loyalty']);
      expect(r.patch.templates).toEqual({
        feedback: {
          name: 'purchase_thanks',
          language: 'en',
          params: ['name', 'points_earned'],
        },
      });
    }
  });
  it.each([
    [{ amount_per_point: 0 }, /amount_per_point/],
    [{ bonus_months: 4, expiry_months: 3 }, /bonus period/],
    [{ google_review_url: 'javascript:alert(1)' }, /https/],
    [{ timezone: 'Mars/Base' }, /timezone/],
    [{ templates: { feedback: { name: 'x', params: ['nope'] } } }, /variable/],
    [{ templates: { party: { name: 'x' } } }, /slot/],
  ])('rejects %j', (body, msg) => {
    const r = validateSettingsPatch(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });
});
