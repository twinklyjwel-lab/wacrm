'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
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
import { fetchJson, inrFmt, NativeSelect } from './shared';

interface Line {
  sku: string;
  description: string;
  metal: string;
  purity: string;
  net_weight: string;
  metal_rate_per_gram: string;
  making_charge: string;
  amount: string;
}

const emptyLine = (): Line => ({
  sku: '',
  description: '',
  metal: 'gold',
  purity: '22K',
  net_weight: '',
  metal_rate_per_gram: '',
  making_charge: '',
  amount: '',
});

function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

const num = (s: string) => (s.trim() === '' ? 0 : Number(s));

export function InvoiceFormDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (invoiceId: string) => void;
}) {
  const t = useTranslations('Jewellery.invoiceForm');
  const tf = useTranslations('Jewellery.fields');
  const [externalId, setExternalId] = useState('');
  const [date, setDate] = useState(todayIst());
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [discount, setDiscount] = useState('');
  const [tax, setTax] = useState('');
  const [pdf, setPdf] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const subtotal = useMemo(() => lines.reduce((s, l) => s + num(l.amount), 0), [lines]);
  const total = Math.max(0, subtotal - num(discount) + num(tax));

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) =>
      ls.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, ...patch };
        // Auto-fill amount from weight × rate + making when not typed by hand.
        const autoKeys: (keyof Line)[] = ['net_weight', 'metal_rate_per_gram', 'making_charge'];
        if (Object.keys(patch).some((k) => autoKeys.includes(k as keyof Line))) {
          const w = num(next.net_weight);
          const r = num(next.metal_rate_per_gram);
          if (w > 0 && r > 0) next.amount = (w * r + num(next.making_charge)).toFixed(2);
        }
        return next;
      }),
    );
  }

  function reset() {
    setExternalId('');
    setDate(todayIst());
    setPhone('');
    setName('');
    setLines([emptyLine()]);
    setDiscount('');
    setTax('');
    setPdf(null);
  }

  async function save() {
    if (!externalId.trim() || !phone.trim()) {
      toast.error(t('errorRequired'));
      return;
    }
    setSaving(true);
    try {
      const invoice = {
        external_id: externalId.trim(),
        invoice_date: date,
        customer: { phone, name: name || undefined },
        items: lines
          .filter((l) => l.description.trim() || num(l.amount) > 0)
          .map((l) => ({
            sku: l.sku || undefined,
            description: l.description || undefined,
            metal: l.metal || undefined,
            purity: l.purity || undefined,
            net_weight: l.net_weight || undefined,
            metal_rate_per_gram: l.metal_rate_per_gram || undefined,
            making_charge: l.making_charge || undefined,
            amount: l.amount || 0,
          })),
        discount: discount || undefined,
        tax: tax || undefined,
        total,
      };
      const { results } = await fetchJson<{
        results: { ok: boolean; error?: string; created?: boolean; invoice_id?: string; points_earned?: number }[];
      }>('/api/invoices', { method: 'POST', body: JSON.stringify({ invoices: [invoice], source: 'manual' }) });
      const r = results[0];
      if (!r?.ok || !r.invoice_id) throw new Error(r?.error ?? t('errorSave'));
      if (r.created === false) {
        toast.info(t('toastExists'));
      } else {
        if (pdf) {
          const form = new FormData();
          form.append('file', pdf);
          await fetchJson(`/api/invoices/${r.invoice_id}/pdf`, { method: 'POST', body: form }).catch((err) =>
            toast.error(err instanceof Error ? err.message : t('errorPdf')),
          );
        }
        toast.success(t('toastCreated', { points: r.points_earned ?? 0 }));
      }
      reset();
      onOpenChange(false);
      onCreated(r.invoice_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorSave'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{tf('external_id')} *</Label>
            <Input value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder="INV-1024" />
          </div>
          <div className="space-y-1.5">
            <Label>{tf('invoice_date')}</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{tf('phone')} *</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" inputMode="tel" />
          </div>
          <div className="space-y-1.5">
            <Label>{tf('name')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{t('items')}</p>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2 sm:grid-cols-8">
              <Input
                className="col-span-2"
                placeholder={tf('description')}
                value={l.description}
                onChange={(e) => setLine(i, { description: e.target.value })}
              />
              <Input placeholder={tf('sku')} value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value })} />
              <NativeSelect value={l.metal} onChange={(e) => setLine(i, { metal: e.target.value })}>
                <option value="gold">{t('gold')}</option>
                <option value="silver">{t('silver')}</option>
              </NativeSelect>
              <Input placeholder={tf('purity')} value={l.purity} onChange={(e) => setLine(i, { purity: e.target.value })} />
              <Input
                placeholder={tf('net_weight')}
                inputMode="decimal"
                value={l.net_weight}
                onChange={(e) => setLine(i, { net_weight: e.target.value })}
              />
              <Input
                placeholder={tf('metal_rate_per_gram')}
                inputMode="decimal"
                value={l.metal_rate_per_gram}
                onChange={(e) => setLine(i, { metal_rate_per_gram: e.target.value })}
              />
              <Input
                placeholder={tf('making_charge')}
                inputMode="decimal"
                value={l.making_charge}
                onChange={(e) => setLine(i, { making_charge: e.target.value })}
              />
              <div className="col-span-2 flex items-center gap-2 sm:col-span-8">
                <Input
                  placeholder={tf('amount')}
                  inputMode="decimal"
                  value={l.amount}
                  onChange={(e) => setLine(i, { amount: e.target.value })}
                  className="max-w-48"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                  aria-label={t('removeLine')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            <Plus className="h-4 w-4" />
            {t('addLine')}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>{tf('discount')}</Label>
            <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{tf('tax')}</Label>
            <Input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('pdf')}</Label>
            <Input type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t('total')}</span>
          <span className="font-semibold text-foreground tabular-nums">{inrFmt(total)}</span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
