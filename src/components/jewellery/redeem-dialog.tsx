'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { planRedemption, type LoyaltySummary } from '@/lib/loyalty/rules';
import type { LoyaltyLot } from '@/lib/loyalty/types';
import { fetchJson, inrFmt, ptsFmt } from './shared';

export interface LoyaltyCardData {
  settings: { bonus_value: number; base_value: number; timezone: string };
  summary: LoyaltySummary;
  lots: LoyaltyLot[];
}

export function RedeemDialog({
  open,
  onOpenChange,
  contactId,
  invoiceId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  invoiceId?: string | null;
  onDone: () => void;
}) {
  const t = useTranslations('Jewellery.redeem');
  const [data, setData] = useState<LoyaltyCardData | null>(null);
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPoints('');
    setNote('');
    fetchJson<LoyaltyCardData>(`/api/loyalty/contacts/${contactId}`)
      .then(setData)
      .catch((err) => toast.error(err instanceof Error ? err.message : t('errorLoad')));
  }, [open, contactId, t]);

  const n = Number(points);
  const plan = useMemo(
    () => (data && Number.isInteger(n) && n > 0 ? planRedemption(data.lots, n, new Date(), data.settings) : null),
    [data, n],
  );

  async function submit() {
    if (!plan) return;
    setSaving(true);
    try {
      await fetchJson('/api/loyalty/redeem', {
        method: 'POST',
        body: JSON.stringify({ contact_id: contactId, points: n, invoice_id: invoiceId ?? null, note: note || null }),
      });
      toast.success(t('toastDone', { points: ptsFmt(n), value: inrFmt(plan.value) }));
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorSave'));
    } finally {
      setSaving(false);
    }
  }

  const bonusPts = plan?.draws.filter((d) => d.rate === data?.settings.bonus_value && d.rate !== data?.settings.base_value)
    .reduce((s, d) => s + d.points, 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {!data ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <p className="text-foreground">
                {t('available', { points: ptsFmt(data.summary.activePoints), value: inrFmt(data.summary.activeValue) })}
              </p>
              {data.summary.bonusPoints > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('bonusSplit', {
                    bonus: ptsFmt(data.summary.bonusPoints),
                    bonusValue: inrFmt(data.settings.bonus_value),
                    base: ptsFmt(data.summary.basePoints),
                    baseValue: inrFmt(data.settings.base_value),
                  })}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t('points')}</Label>
              <div className="flex gap-2">
                <Input inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value.replace(/\D/g, ''))} />
                <Button variant="outline" onClick={() => setPoints(String(data.summary.activePoints))}>
                  {t('all')}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('note')}</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </div>
            {points && (
              <div className="rounded-lg border border-border p-3 text-sm">
                {plan ? (
                  <>
                    <p className="font-medium text-foreground">{t('discount', { value: inrFmt(plan.value) })}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t('fifoNote', { bonus: ptsFmt(bonusPts), base: ptsFmt(n - bonusPts) })}
                    </p>
                  </>
                ) : (
                  <p className="text-red-400">{t('notEnough')}</p>
                )}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button onClick={submit} disabled={!plan || saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
