'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchJson, NativeSelect } from './shared';

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  metal: 'gold' | 'silver';
  purity: string;
  gross_weight: number;
  stone_weight: number;
  net_weight: number;
  making_charge_type: 'per_gram' | 'percent' | 'fixed';
  making_charge: number;
  priority: number;
  status: 'in_stock' | 'reserved' | 'sold';
  notes: string | null;
  sold_invoice_id?: string | null;
}

type Form = Record<
  | 'sku'
  | 'name'
  | 'category'
  | 'metal'
  | 'purity'
  | 'gross_weight'
  | 'stone_weight'
  | 'net_weight'
  | 'making_charge_type'
  | 'making_charge'
  | 'priority'
  | 'status'
  | 'notes',
  string
>;

function toForm(item: InventoryItem | null, metal: 'gold' | 'silver'): Form {
  return {
    sku: item?.sku ?? '',
    name: item?.name ?? '',
    category: item?.category ?? '',
    metal: item?.metal ?? metal,
    purity: item?.purity ?? (metal === 'gold' ? '22K' : '925'),
    gross_weight: item ? String(item.gross_weight) : '',
    stone_weight: item ? String(item.stone_weight) : '',
    net_weight: item ? String(item.net_weight) : '',
    making_charge_type: item?.making_charge_type ?? 'per_gram',
    making_charge: item ? String(item.making_charge) : '',
    priority: item ? String(item.priority) : '0',
    status: item?.status ?? 'in_stock',
    notes: item?.notes ?? '',
  };
}

export function InventoryItemDialog({
  open,
  onOpenChange,
  item,
  defaultMetal,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItem | null;
  defaultMetal: 'gold' | 'silver';
  onSaved: () => void;
}) {
  const t = useTranslations('Jewellery.inventory');
  const tf = useTranslations('Jewellery.fields');
  const [form, setForm] = useState<Form>(toForm(item, defaultMetal));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(toForm(item, defaultMetal));
  }, [open, item, defaultMetal]);

  const set = (k: keyof Form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setSaving(true);
    try {
      const body = {
        ...form,
        net_weight: form.net_weight === '' ? undefined : form.net_weight,
      };
      if (item) {
        await fetchJson(`/api/inventory/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        const { results } = await fetchJson<{
          results: { ok: boolean; error?: string }[];
        }>('/api/inventory', {
          method: 'POST',
          body: JSON.stringify({ items: [body] }),
        });
        if (!results[0]?.ok)
          throw new Error(results[0]?.error ?? t('errorSave'));
      }
      toast.success(t('toastSaved'));
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorSave'));
    } finally {
      setSaving(false);
    }
  }

  const field = (
    k: keyof Form,
    opts: { decimal?: boolean; label?: string } = {}
  ) => (
    <div className="space-y-1.5">
      <Label>{opts.label ?? tf(k)}</Label>
      <Input
        value={form[k]}
        onChange={set(k)}
        inputMode={opts.decimal ? 'decimal' : undefined}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? t('editTitle') : t('addTitle')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('sku')}
          {field('name')}
          <div className="space-y-1.5">
            <Label>{tf('metal')}</Label>
            <NativeSelect
              className="w-full"
              value={form.metal}
              onChange={set('metal')}
            >
              <option value="gold">{t('gold')}</option>
              <option value="silver">{t('silver')}</option>
            </NativeSelect>
          </div>
          {field('purity')}
          {field('category')}
          <div className="space-y-1.5">
            <Label>{tf('status')}</Label>
            <NativeSelect
              className="w-full"
              value={form.status}
              onChange={set('status')}
            >
              <option value="in_stock">{t('status.in_stock')}</option>
              <option value="reserved">{t('status.reserved')}</option>
              <option value="sold">{t('status.sold')}</option>
            </NativeSelect>
          </div>
          {field('gross_weight', { decimal: true })}
          {field('stone_weight', { decimal: true })}
          {field('net_weight', { decimal: true, label: t('netWeightAuto') })}
          {field('priority')}
          <div className="space-y-1.5">
            <Label>{tf('making_charge_type')}</Label>
            <NativeSelect
              className="w-full"
              value={form.making_charge_type}
              onChange={set('making_charge_type')}
            >
              <option value="per_gram">{t('making.per_gram')}</option>
              <option value="percent">{t('making.percent')}</option>
              <option value="fixed">{t('making.fixed')}</option>
            </NativeSelect>
          </div>
          {field('making_charge', { decimal: true })}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{tf('notes')}</Label>
            <Input value={form.notes} onChange={set('notes')} />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={save}
            disabled={saving || !form.sku.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
