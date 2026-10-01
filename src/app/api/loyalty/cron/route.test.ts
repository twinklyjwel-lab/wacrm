import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runLoyaltyCron = vi.fn();
vi.mock('@/lib/loyalty/cron', () => ({
  runLoyaltyCron: (...a: unknown[]) => runLoyaltyCron(...a),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({}),
}));

import { GET } from './route';

function req(secret?: string) {
  return new Request('http://localhost/api/loyalty/cron', {
    headers: secret ? { 'x-cron-secret': secret } : {},
  });
}

describe('GET /api/loyalty/cron', () => {
  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = 'shh-secret';
  });
  afterEach(() => {
    delete process.env.AUTOMATION_CRON_SECRET;
  });

  it('503s when the secret is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET;
    expect((await GET(req('x'))).status).toBe(503);
  });

  it('401s on a wrong or missing secret', async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('wrong-secret'))).status).toBe(401);
    expect(runLoyaltyCron).not.toHaveBeenCalled();
  });

  it('runs the tick with the right secret', async () => {
    runLoyaltyCron.mockResolvedValue({
      occasions: {},
      messages: { sent: 2, skipped: 0, failed: 0, retrying: 0 },
    });
    const res = await GET(req('shh-secret'));
    expect(res.status).toBe(200);
    expect((await res.json()).messages.sent).toBe(2);
  });
});
