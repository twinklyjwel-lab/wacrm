'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  DEFAULT_TEMPLATE_PARAMS,
  TEMPLATE_SLOTS,
  TEMPLATE_TOKENS,
  type LoyaltySettings,
  type TemplateSlot,
} from '@/lib/loyalty/types';
import { fetchJson, NativeSelect, Spinner } from './shared';

interface TemplateOption {
  name: string;
  language: string;
  status: string | null;
  body_text: string;
  header_type: string | null;
}

type SlotForm = { key: string; params: string };

export function LoyaltySettingsForm() {
  const t = useTranslations('Jewellery.settings');
  const tk = useTranslations('Jewellery.templateSlots');
  const canEdit = useCan('edit-settings');
  const [s, setS] = useState<LoyaltySettings | null>(null);
  const [configured, setConfigured] = useState(true);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [slots, setSlots] = useState<Record<TemplateSlot, SlotForm>>(
    {} as Record<TemplateSlot, SlotForm>
  );
  const [pointsKw, setPointsKw] = useState('');
  const [ordersKw, setOrdersKw] = useState('');
  const [reminders, setReminders] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [{ settings, configured }, tpl] = await Promise.all([
        fetchJson<{ settings: LoyaltySettings; configured: boolean }>(
          '/api/loyalty/settings'
        ),
        createClient()
          .from('message_templates')
          .select('name, language, status, body_text, header_type')
          .order('name'),
      ]);
      setS(settings);
      setConfigured(configured);
      setTemplates((tpl.data ?? []) as TemplateOption[]);
      setPointsKw(settings.points_keywords.join(', '));
      setOrdersKw(settings.orders_keywords.join(', '));
      setReminders(settings.reminder_days.join(', '));
      const next = {} as Record<TemplateSlot, SlotForm>;
      for (const slot of TEMPLATE_SLOTS) {
        const c = settings.templates[slot];
        next[slot] = {
          key: c ? `${c.name}|${c.language}` : '',
          params: (c?.params?.length
            ? c.params
            : DEFAULT_TEMPLATE_PARAMS[slot]
          ).join(', '),
        };
      }
      setSlots(next);
    })().catch((err) =>
      toast.error(err instanceof Error ? err.message : t('errorLoad'))
    );
  }, [t]);

  if (!s) return <Spinner />;
  const set = <K extends keyof LoyaltySettings>(k: K, v: LoyaltySettings[K]) =>
    setS((p) => (p ? { ...p, [k]: v } : p));
  const list = (v: string) =>
    v
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      const tplOut: Record<
        string,
        { name: string; language: string; params: string[] } | null
      > = {};
      for (const slot of TEMPLATE_SLOTS) {
        const f = slots[slot];
        if (!f?.key) {
          tplOut[slot] = null;
          continue;
        }
        const [name, language] = f.key.split('|');
        tplOut[slot] = { name, language, params: list(f.params) };
      }
      const { settings } = await fetchJson<{ settings: LoyaltySettings }>(
        '/api/loyalty/settings',
        {
          method: 'PUT',
          body: JSON.stringify({
            enabled: s.enabled,
            store_name: s.store_name,
            google_review_url: s.google_review_url,
            amount_per_point: s.amount_per_point,
            gst_included_rate: s.gst_included_rate,
            bonus_value: s.bonus_value,
            base_value: s.base_value,
            bonus_months: s.bonus_months,
            expiry_months: s.expiry_months,
            birthday_points: s.birthday_points,
            anniversary_points: s.anniversary_points,
            send_hour: s.send_hour,
            timezone: s.timezone,
            reminder_days: list(reminders).map(Number),
            points_keywords: list(pointsKw),
            orders_keywords: list(ordersKw),
            templates: tplOut,
          }),
        }
      );
      setS(settings);
      setConfigured(true);
      toast.success(t('toastSaved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorSave'));
    } finally {
      setSaving(false);
    }
  }

  const numInput = (k: keyof LoyaltySettings, label: string, hint?: string) => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        inputMode="decimal"
        value={String(s[k] ?? '')}
        disabled={!canEdit}
        onChange={(e) => set(k, e.target.value as never)}
      />
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      {!configured && (
        <div className="text-foreground rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {t('notConfigured')}
        </div>
      )}

      <section className="border-border bg-card rounded-xl border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-foreground text-sm font-semibold">
              {t('enabled')}
            </h2>
            <p className="text-muted-foreground text-xs">{t('enabledHint')}</p>
          </div>
          <Switch
            checked={s.enabled}
            disabled={!canEdit}
            onCheckedChange={(v) => set('enabled', v === true)}
          />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('storeName')}</Label>
            <Input
              value={s.store_name ?? ''}
              disabled={!canEdit}
              onChange={(e) => set('store_name', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('reviewUrl')}</Label>
            <Input
              value={s.google_review_url ?? ''}
              disabled={!canEdit}
              placeholder="https://g.page/r/…/review"
              onChange={(e) => set('google_review_url', e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="border-border bg-card rounded-xl border p-4">
        <h2 className="text-foreground text-sm font-semibold">
          {t('pointsTitle')}
        </h2>
        <p className="text-muted-foreground text-xs">
          {t('pointsSummary', {
            amount: s.amount_per_point,
            bonus: s.bonus_value,
            bonusMonths: s.bonus_months,
            base: s.base_value,
            expiryMonths: s.expiry_months,
          })}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {numInput('amount_per_point', t('amountPerPoint'))}
          {numInput('gst_included_rate', t('gstRate'), t('gstRateHint'))}
          {numInput('bonus_value', t('bonusValue'))}
          {numInput('bonus_months', t('bonusMonths'))}
          {numInput('base_value', t('baseValue'))}
          {numInput('expiry_months', t('expiryMonths'))}
          <div className="space-y-1.5">
            <Label>{t('reminderDays')}</Label>
            <Input
              value={reminders}
              disabled={!canEdit}
              onChange={(e) => setReminders(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {t('reminderDaysHint')}
            </p>
          </div>
          {numInput('birthday_points', t('birthdayPoints'))}
          {numInput('anniversary_points', t('anniversaryPoints'))}
          {numInput(
            'send_hour',
            t('sendHour'),
            t('sendHourHint', { tz: s.timezone })
          )}
        </div>
      </section>

      <section className="border-border bg-card rounded-xl border p-4">
        <h2 className="text-foreground text-sm font-semibold">
          {t('templatesTitle')}
        </h2>
        <p className="text-muted-foreground text-xs">{t('templatesHint')}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('tokens')}:{' '}
          <span className="font-mono">{TEMPLATE_TOKENS.join(', ')}</span>
        </p>
        <div className="mt-4 space-y-4">
          {TEMPLATE_SLOTS.map((slot) => {
            const f = slots[slot] ?? { key: '', params: '' };
            const chosen = templates.find(
              (x) => `${x.name}|${x.language}` === f.key
            );
            return (
              <div
                key={slot}
                className="border-border grid gap-2 rounded-lg border p-3 sm:grid-cols-2"
              >
                <div className="space-y-1.5">
                  <Label>{tk(slot)}</Label>
                  <NativeSelect
                    className="w-full"
                    disabled={!canEdit}
                    value={f.key}
                    onChange={(e) =>
                      setSlots((p) => ({
                        ...p,
                        [slot]: { ...f, key: e.target.value },
                      }))
                    }
                  >
                    <option value="">{t('noTemplate')}</option>
                    {templates.map((x) => (
                      <option
                        key={`${x.name}|${x.language}`}
                        value={`${x.name}|${x.language}`}
                      >
                        {x.name} ({x.language})
                        {x.status && x.status !== 'APPROVED'
                          ? ` — ${x.status}`
                          : ''}
                      </option>
                    ))}
                  </NativeSelect>
                  {slot === 'feedback' && (
                    <p className="text-muted-foreground text-xs">
                      {t('feedbackHint')}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>{t('variables')}</Label>
                  <Input
                    className="font-mono text-xs"
                    disabled={!canEdit}
                    value={f.params}
                    onChange={(e) =>
                      setSlots((p) => ({
                        ...p,
                        [slot]: { ...f, params: e.target.value },
                      }))
                    }
                  />
                </div>
                {chosen && (
                  <p className="bg-muted/50 text-muted-foreground rounded p-2 text-xs whitespace-pre-wrap sm:col-span-2">
                    {chosen.header_type ? `[${chosen.header_type}] ` : ''}
                    {chosen.body_text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="border-border bg-card rounded-xl border p-4">
        <h2 className="text-foreground text-sm font-semibold">
          {t('keywordsTitle')}
        </h2>
        <p className="text-muted-foreground text-xs">{t('keywordsHint')}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('pointsKeywords')}</Label>
            <Input
              value={pointsKw}
              disabled={!canEdit}
              onChange={(e) => setPointsKw(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('ordersKeywords')}</Label>
            <Input
              value={ordersKw}
              disabled={!canEdit}
              onChange={(e) => setOrdersKw(e.target.value)}
            />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <GatedButton
          canAct={canEdit}
          gateReason="edit loyalty settings"
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
  );
}
