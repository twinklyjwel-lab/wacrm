'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { dateFmt, fetchJson, inrFmt, MetalChip, Spinner } from './shared';

interface Rate {
  id: string;
  metal: 'gold' | 'silver';
  purity: string;
  rate_per_gram: number;
  effective_date: string;
}

/** Purities offered for today's rate entry. */
const DEFAULT_PURITIES: { metal: 'gold' | 'silver'; purity: string }[] = [
  { metal: 'gold', purity: '24K' },
  { metal: 'gold', purity: '22K' },
  { metal: 'gold', purity: '18K' },
  { metal: 'silver', purity: '999' },
  { metal: 'silver', purity: '925' },
];

function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date()
  );
}

export function MetalRatesPanel() {
  const t = useTranslations('Jewellery.rates');
  const canEdit = useCan('send-messages');
  const [history, setHistory] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayIst());
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from('metal_rates')
      .select('id, metal, purity, rate_per_gram, effective_date')
      .order('effective_date', { ascending: false })
      .order('metal')
      .limit(200);
    const rows = (data ?? []) as Rate[];
    setHistory(rows);
    // Prefill with the latest known rate per purity.
    const latest: Record<string, string> = {};
    for (const r of rows) {
      const k = `${r.metal}|${r.purity}`;
      if (!(k in latest)) latest[k] = String(r.rate_per_gram);
    }
    setValues((v) => ({ ...latest, ...v }));
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const purities = [
    ...DEFAULT_PURITIES,
    ...[...new Set(history.map((r) => `${r.metal}|${r.purity}`))]
      .map((k) => ({
        metal: k.split('|')[0] as 'gold' | 'silver',
        purity: k.split('|')[1],
      }))
      .filter(
        (p) =>
          !DEFAULT_PURITIES.some(
            (d) => d.metal === p.metal && d.purity === p.purity
          )
      ),
  ];

  async function save() {
    const rates = purities
      .map((p) => ({
        ...p,
        rate_per_gram: values[`${p.metal}|${p.purity}`],
        effective_date: date,
      }))
      .filter((r) => r.rate_per_gram && Number(r.rate_per_gram) > 0);
    if (rates.length === 0) {
      toast.error(t('errorNone'));
      return;
    }
    setSaving(true);
    try {
      const { results } = await fetchJson<{
        results: { ok: boolean; error?: string }[];
      }>('/api/metal-rates', {
        method: 'POST',
        body: JSON.stringify({ rates }),
      });
      const failed = results.find((r) => !r.ok);
      if (failed) throw new Error(failed.error);
      toast.success(t('toastSaved'));
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorSave'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="border-border bg-card rounded-xl border p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-foreground text-sm font-semibold">
              {t('todayTitle')}
            </h2>
            <p className="text-muted-foreground text-xs">{t('todayHint')}</p>
          </div>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {purities.map((p) => {
            const k = `${p.metal}|${p.purity}`;
            return (
              <label key={k} className="space-y-1.5">
                <MetalChip metal={p.metal} purity={p.purity} />
                <Input
                  inputMode="decimal"
                  placeholder={t('perGram')}
                  value={values[k] ?? ''}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [k]: e.target.value }))
                  }
                />
              </label>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <GatedButton
            canAct={canEdit}
            gateReason="update metal rates"
            onClick={save}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t('save')}
          </GatedButton>
        </div>
      </div>

      {history.length > 0 && (
        <div className="border-border bg-card overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>{t('date')}</TableHead>
                <TableHead>{t('metal')}</TableHead>
                <TableHead className="text-right">{t('rate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((r) => (
                <TableRow key={r.id} className="border-border">
                  <TableCell className="text-muted-foreground">
                    {dateFmt(`${r.effective_date}T12:00:00+05:30`)}
                  </TableCell>
                  <TableCell>
                    <MetalChip metal={r.metal} purity={r.purity} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {inrFmt(r.rate_per_gram)}/g
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
