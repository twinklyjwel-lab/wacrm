'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Cake, Heart } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { dateFmt, dayMonthFmt, inrFmt, ptsFmt, Spinner, StatCard } from './shared';

interface LotRow {
  contact_id: string;
  remaining: number;
  bonus_until: string;
  expires_at: string;
  contact: { name: string | null; phone: string } | null;
}

interface PersonRow {
  id: string;
  name: string | null;
  phone: string;
  birthday: string | null;
  anniversary: string | null;
}

const DAY = 86_400_000;

/** Days from today (IST) until the next occurrence of a yyyy-mm-dd date's month/day. */
function daysUntil(md: string, today: Date): number {
  const [, m, d] = md.split('-').map(Number);
  const y = today.getUTCFullYear();
  let next = Date.UTC(y, m - 1, d);
  const base = Date.UTC(y, today.getUTCMonth(), today.getUTCDate());
  if (next < base) next = Date.UTC(y + 1, m - 1, d);
  return Math.round((next - base) / DAY);
}

export function LoyaltyOverview({ bonusValue, baseValue }: { bonusValue: number; baseValue: number }) {
  const t = useTranslations('Jewellery.overview');
  const [lots, setLots] = useState<LotRow[] | null>(null);
  const [people, setPeople] = useState<PersonRow[]>([]);

  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const [l, p] = await Promise.all([
        supabase
          .from('loyalty_lots')
          .select('contact_id, remaining, bonus_until, expires_at, contact:contacts(name, phone)')
          .gt('remaining', 0)
          .gt('expires_at', new Date().toISOString())
          .order('expires_at', { ascending: true })
          .limit(5000),
        supabase
          .from('contacts')
          .select('id, name, phone, birthday, anniversary')
          .or('birthday.not.is.null,anniversary.not.is.null')
          .limit(5000),
      ]);
      setLots((l.data ?? []) as unknown as LotRow[]);
      setPeople((p.data ?? []) as PersonRow[]);
    })();
  }, []);

  const now = useMemo(() => new Date(), []);
  const stats = useMemo(() => {
    if (!lots) return null;
    let points = 0;
    let value = 0;
    let expiring30 = 0;
    const customers = new Set<string>();
    const soon = new Map<string, { name: string; phone: string; points: number; expiresAt: string }>();
    for (const lot of lots) {
      const rate = new Date(lot.bonus_until) > now ? bonusValue : baseValue;
      points += lot.remaining;
      value += lot.remaining * rate;
      customers.add(lot.contact_id);
      if (new Date(lot.expires_at).getTime() - now.getTime() <= 30 * DAY) {
        expiring30 += lot.remaining;
        const s = soon.get(lot.contact_id);
        if (s) s.points += lot.remaining;
        else
          soon.set(lot.contact_id, {
            name: lot.contact?.name ?? '—',
            phone: lot.contact?.phone ?? '',
            points: lot.remaining,
            expiresAt: lot.expires_at,
          });
      }
    }
    return { points, value, expiring30, customers: customers.size, soon: [...soon.values()] };
  }, [lots, now, bonusValue, baseValue]);

  const occasions = useMemo(() => {
    const ist = new Date(now.getTime() + 330 * 60_000);
    const out: { kind: 'birthday' | 'anniversary'; name: string; phone: string; date: string; inDays: number }[] = [];
    for (const p of people) {
      for (const kind of ['birthday', 'anniversary'] as const) {
        const d = p[kind];
        if (!d) continue;
        const inDays = daysUntil(d, ist);
        if (inDays <= 7) out.push({ kind, name: p.name ?? p.phone, phone: p.phone, date: d, inDays });
      }
    }
    return out.sort((a, b) => a.inDays - b.inDays);
  }, [people, now]);

  if (!stats) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('activePoints')} value={ptsFmt(stats.points)} />
        <StatCard label={t('liability')} value={inrFmt(stats.value)} hint={t('liabilityHint')} />
        <StatCard label={t('expiring30')} value={ptsFmt(stats.expiring30)} />
        <StatCard label={t('customers')} value={ptsFmt(stats.customers)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">{t('expiringTitle')}</h2>
          {stats.soon.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('expiringNone')}</p>
          ) : (
            <ul className="mt-2 max-h-96 divide-y divide-border overflow-y-auto">
              {stats.soon.map((s) => (
                <li key={s.phone} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-foreground">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">{s.phone}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block tabular-nums text-foreground">{ptsFmt(s.points)} pts</span>
                    <span className="block text-xs text-muted-foreground">{t('from', { date: dateFmt(s.expiresAt) })}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">{t('occasionsTitle')}</h2>
          {occasions.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('occasionsNone')}</p>
          ) : (
            <ul className="mt-2 max-h-96 divide-y divide-border overflow-y-auto">
              {occasions.map((o) => (
                <li key={`${o.kind}-${o.phone}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    {o.kind === 'birthday' ? (
                      <Cake className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Heart className="h-4 w-4 shrink-0 text-primary" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{o.name}</span>
                      <span className="block text-xs text-muted-foreground">{o.phone}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">
                    {dayMonthFmt(o.date)} · {o.inDays === 0 ? t('today') : t('inDays', { days: o.inDays })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
