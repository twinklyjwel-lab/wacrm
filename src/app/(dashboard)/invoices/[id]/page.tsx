'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, Gift, Loader2, Trash2, Upload } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RedeemDialog } from '@/components/jewellery/redeem-dialog';
import {
  dateFmt,
  fetchJson,
  inrFmt,
  MetalChip,
  ptsFmt,
  Spinner,
  StatCard,
  StatusChip,
  weightFmt,
} from '@/components/jewellery/shared';

interface InvoiceDetail {
  invoice: {
    id: string;
    external_id: string;
    invoice_date: string;
    source: string;
    subtotal: number;
    making_total: number;
    discount: number;
    tax: number;
    total: number;
    points_earned: number;
    points_redeemed: number;
    redeemed_value: number;
    pdf_path: string | null;
    contact: { id: string; name: string | null; phone: string } | null;
    items: {
      id: string;
      sku: string | null;
      description: string;
      metal: string | null;
      purity: string | null;
      net_weight: number;
      metal_rate_per_gram: number | null;
      making_charge: number;
      quantity: number;
      amount: number;
    }[];
  };
  pdfUrl: string | null;
  messages: { id: string; kind: string; status: string; send_at: string; sent_at: string | null; last_error: string | null }[];
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('Jewellery.invoiceDetail');
  const tk = useTranslations('Jewellery.messageKinds');
  const ts = useTranslations('Jewellery.messageStatus');
  const router = useRouter();
  const canEdit = useCan('send-messages');
  const canAdmin = useCan('edit-settings');
  const fileRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);

  const load = useCallback(() => {
    fetchJson<InvoiceDetail>(`/api/invoices/${id}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Error'));
  }, [id]);
  useEffect(load, [load]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await fetchJson(`/api/invoices/${id}/pdf`, { method: 'POST', body: form });
      toast.success(t('toastPdf'));
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorPdf'));
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (!confirm(t('confirmDelete'))) return;
    try {
      await fetchJson(`/api/invoices/${id}`, { method: 'DELETE' });
      toast.success(t('toastDeleted'));
      router.push('/invoices');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorDelete'));
    }
  }

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data) return <Spinner />;
  const inv = data.invoice;

  return (
    <div className="space-y-6">
      <Link href="/invoices" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        {t('back')}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title', { number: inv.external_id })}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {dateFmt(inv.invoice_date, true)} · {inv.contact?.name ?? '—'} · {inv.contact?.phone}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
          {data.pdfUrl && (
            <a
              href={data.pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-muted"
            >
              <ExternalLink className="h-4 w-4" />
              {t('viewPdf')}
            </a>
          )}
          <GatedButton canAct={canEdit} gateReason="upload invoice PDFs" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {inv.pdf_path ? t('replacePdf') : t('attachPdf')}
          </GatedButton>
          {inv.contact && (
            <GatedButton
              canAct={canEdit}
              gateReason="redeem points"
              onClick={() => setRedeemOpen(true)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Gift className="h-4 w-4" />
              {t('redeem')}
            </GatedButton>
          )}
          <GatedButton canAct={canAdmin} gateReason="delete invoices" variant="outline" onClick={remove}>
            <Trash2 className="h-4 w-4" />
          </GatedButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('total')} value={inrFmt(inv.total)} hint={t('taxDiscount', { tax: inrFmt(inv.tax), discount: inrFmt(inv.discount) })} />
        <StatCard label={t('pointsEarned')} value={`+${ptsFmt(inv.points_earned)}`} />
        <StatCard label={t('pointsRedeemed')} value={ptsFmt(inv.points_redeemed)} hint={inrFmt(inv.redeemed_value)} />
        <StatCard label={t('source')} value={<span className="text-base uppercase">{inv.source}</span>} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>{t('items.item')}</TableHead>
              <TableHead>{t('items.metal')}</TableHead>
              <TableHead className="text-right">{t('items.weight')}</TableHead>
              <TableHead className="text-right">{t('items.rate')}</TableHead>
              <TableHead className="hidden text-right sm:table-cell">{t('items.making')}</TableHead>
              <TableHead className="text-right">{t('items.amount')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inv.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  {t('items.none')}
                </TableCell>
              </TableRow>
            ) : (
              inv.items.map((it) => (
                <TableRow key={it.id} className="border-border">
                  <TableCell>
                    <div className="text-foreground">{it.description}</div>
                    {it.sku && <div className="text-xs text-muted-foreground">{it.sku}</div>}
                  </TableCell>
                  <TableCell>
                    <MetalChip metal={it.metal} purity={it.purity} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{weightFmt(it.net_weight)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {it.metal_rate_per_gram != null ? `${inrFmt(it.metal_rate_per_gram)}/g` : '—'}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{inrFmt(it.making_charge)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inrFmt(it.amount)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">{t('messagesTitle')}</h2>
        {data.messages.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('noMessages')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {data.messages.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-foreground">{tk(m.kind)}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {dateFmt(m.sent_at ?? m.send_at, true)}
                  <StatusChip status={m.status} label={ts(m.status)} />
                </span>
                {m.last_error && <p className="w-full text-xs text-muted-foreground">{m.last_error}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {inv.contact && (
        <RedeemDialog open={redeemOpen} onOpenChange={setRedeemOpen} contactId={inv.contact.id} invoiceId={inv.id} onDone={load} />
      )}
    </div>
  );
}
