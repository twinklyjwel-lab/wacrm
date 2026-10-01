'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Gift, Loader2, Plus, Save } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { RedeemDialog, type LoyaltyCardData } from './redeem-dialog';
import { dateFmt, fetchJson, inrFmt, ptsFmt } from './shared';

interface CardResponse extends LoyaltyCardData {
  invoices: { id: string; external_id: string; invoice_date: string; total: number; points_earned: number }[];
  redemptions: { id: string; points: number; value: number; note: string | null; created_at: string }[];
}

/** Loyalty tab in the contact sheet: special dates, balance, history. */
export function CustomerLoyaltyPanel({ contactId }: { contactId: string }) {
  const t = useTranslations('Jewellery.customer');
  const canEdit = useCan('send-messages');
  const canAdmin = useCan('edit-settings');
  const [data, setData] = useState<CardResponse | null>(null);
  const [profile, setProfile] = useState({ birthday: '', anniversary: '', customer_code: '', loyalty_opt_out: false });
  const [savingProfile, setSavingProfile] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [adjustPoints, setAdjustPoints] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const load = useCallback(() => {
    fetchJson<CardResponse>(`/api/loyalty/contacts/${contactId}`)
      .then(setData)
      .catch((err) => toast.error(err instanceof Error ? err.message : t('errorLoad')));
    void createClient()
      .from('contacts')
      .select('birthday, anniversary, customer_code, loyalty_opt_out')
      .eq('id', contactId)
      .maybeSingle()
      .then(({ data: c }) => {
        if (c)
          setProfile({
            birthday: c.birthday ?? '',
            anniversary: c.anniversary ?? '',
            customer_code: c.customer_code ?? '',
            loyalty_opt_out: !!c.loyalty_opt_out,
          });
      });
  }, [contactId, t]);
  useEffect(load, [load]);

  async function saveProfile() {
    setSavingProfile(true);
    const { error } = await createClient()
      .from('contacts')
      .update({
        birthday: profile.birthday || null,
        anniversary: profile.anniversary || null,
        customer_code: profile.customer_code.trim() || null,
        loyalty_opt_out: profile.loyalty_opt_out,
      })
      .eq('id', contactId);
    setSavingProfile(false);
    if (error) toast.error(error.code === '23505' ? t('errorCodeTaken') : error.message);
    else toast.success(t('toastSaved'));
  }

  async function adjust() {
    setAdjusting(true);
    try {
      await fetchJson('/api/loyalty/adjust', {
        method: 'POST',
        body: JSON.stringify({ contact_id: contactId, points: Number(adjustPoints), note: adjustNote }),
      });
      toast.success(t('toastAdjusted'));
      setAdjustPoints('');
      setAdjustNote('');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorAdjust'));
    } finally {
      setAdjusting(false);
    }
  }

  const s = data?.summary;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('birthday')}</Label>
            <Input
              type="date"
              className="h-8 text-sm"
              disabled={!canEdit}
              value={profile.birthday}
              onChange={(e) => setProfile((p) => ({ ...p, birthday: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t('anniversary')}</Label>
            <Input
              type="date"
              className="h-8 text-sm"
              disabled={!canEdit}
              value={profile.anniversary}
              onChange={(e) => setProfile((p) => ({ ...p, anniversary: e.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('customerCode')}</Label>
          <Input
            className="h-8 text-sm"
            disabled={!canEdit}
            value={profile.customer_code}
            onChange={(e) => setProfile((p) => ({ ...p, customer_code: e.target.value }))}
          />
        </div>
        <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          {t('optOut')}
          <Switch
            checked={profile.loyalty_opt_out}
            disabled={!canEdit}
            onCheckedChange={(v) => setProfile((p) => ({ ...p, loyalty_opt_out: v === true }))}
          />
        </label>
        {canEdit && (
          <Button size="sm" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {t('save')}
          </Button>
        )}
      </div>

      {!s ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-[11px] text-muted-foreground">{t('active')}</p>
              <p className="text-lg font-semibold tabular-nums text-foreground">{ptsFmt(s.activePoints)}</p>
              <p className="text-xs text-muted-foreground">{t('worth', { value: inrFmt(s.activeValue) })}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-[11px] text-muted-foreground">{t('lifetime')}</p>
              <p className="text-lg font-semibold tabular-nums text-foreground">{ptsFmt(s.lifetimeEarned)}</p>
              <p className="text-xs text-muted-foreground">{t('expired', { points: ptsFmt(s.expiredPoints) })}</p>
            </div>
          </div>

          {(s.bonusEnding.length > 0 || s.expiring.length > 0) && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {s.bonusEnding.map((b) => (
                <li key={b.until}>
                  {t('bonusUntil', {
                    points: ptsFmt(b.points),
                    value: inrFmt(data!.settings.bonus_value),
                    date: dateFmt(b.until),
                  })}
                </li>
              ))}
              {s.expiring.slice(0, 4).map((e) => (
                <li key={e.date}>{t('expiresOn', { points: ptsFmt(e.points), date: dateFmt(e.expiresAt) })}</li>
              ))}
            </ul>
          )}

          {canEdit && s.activePoints > 0 && (
            <Button size="sm" variant="outline" className="w-full" onClick={() => setRedeemOpen(true)}>
              <Gift className="size-3.5" />
              {t('redeem')}
            </Button>
          )}

          {canAdmin && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-foreground">{t('adjustTitle')}</p>
              <div className="flex gap-2">
                <Input
                  className="h-8 w-24 text-sm"
                  inputMode="numeric"
                  placeholder={t('points')}
                  value={adjustPoints}
                  onChange={(e) => setAdjustPoints(e.target.value.replace(/\D/g, ''))}
                />
                <Input className="h-8 text-sm" placeholder={t('reason')} value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} />
                <Button size="sm" variant="outline" onClick={adjust} disabled={adjusting || !adjustPoints || !adjustNote.trim()}>
                  {adjusting ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                </Button>
              </div>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs font-medium text-foreground">{t('purchases')}</p>
            {data!.invoices.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('noPurchases')}</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {data!.invoices.map((inv) => (
                  <li key={inv.id}>
                    <Link href={`/invoices/${inv.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-muted/50">
                      <span>
                        <span className="block text-foreground">{inv.external_id}</span>
                        <span className="block text-muted-foreground">{dateFmt(inv.invoice_date)}</span>
                      </span>
                      <span className="text-right">
                        <span className="block tabular-nums text-foreground">{inrFmt(inv.total)}</span>
                        <span className="block text-muted-foreground">+{ptsFmt(inv.points_earned)} pts</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data!.redemptions.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-foreground">{t('redemptions')}</p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {data!.redemptions.map((r) => (
                  <li key={r.id}>
                    {dateFmt(r.created_at)} · −{ptsFmt(r.points)} pts · {inrFmt(r.value)}
                    {r.note ? ` · ${r.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <RedeemDialog open={redeemOpen} onOpenChange={setRedeemOpen} contactId={contactId} onDone={load} />
    </div>
  );
}
