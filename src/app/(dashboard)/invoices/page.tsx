'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FileText, Loader2, Plus, Search, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ImportDialog } from '@/components/jewellery/import-dialog';
import { InvoiceFormDialog } from '@/components/jewellery/invoice-form-dialog';
import { dateFmt, EmptyState, inrFmt, PageHeader, ptsFmt, Spinner } from '@/components/jewellery/shared';

const PAGE = 50;

interface InvoiceRow {
  id: string;
  external_id: string;
  invoice_date: string;
  total: number;
  points_earned: number;
  points_redeemed: number;
  source: string;
  pdf_path: string | null;
  contact: { name: string | null; phone: string } | null;
}

function clean(q: string) {
  return q.replace(/[^\p{L}\p{N} +@.\-_/]/gu, '').trim();
}

export default function InvoicesPage() {
  const t = useTranslations('Jewellery.invoices');
  const router = useRouter();
  const canEdit = useCan('send-messages');
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      const supabase = createClient();
      let q = supabase
        .from('invoices')
        .select('id, external_id, invoice_date, total, points_earned, points_redeemed, source, pdf_path, contact:contacts(name, phone)')
        .order('invoice_date', { ascending: false })
        .range(offset, offset + PAGE);
      const term = clean(query);
      if (term) {
        const { data: contacts } = await supabase
          .from('contacts')
          .select('id')
          .or(`name.ilike.*${term}*,phone.ilike.*${term.replace(/\s+/g, '')}*`)
          .limit(200);
        const ids = (contacts ?? []).map((c) => c.id);
        q = ids.length
          ? q.or(`external_id.ilike.*${term}*,contact_id.in.(${ids.join(',')})`)
          : q.ilike('external_id', `*${term}*`);
      }
      const { data } = await q;
      const list = (data ?? []) as unknown as InvoiceRow[];
      setHasMore(list.length > PAGE);
      const page = list.slice(0, PAGE);
      setRows((prev) => (offset === 0 ? page : [...prev, ...page]));
    },
    [query],
  );

  useEffect(() => {
    // Show the spinner while a new search loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    load(0).finally(() => setLoading(false));
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            <GatedButton canAct={canEdit} gateReason="import invoices" variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" />
              {t('import')}
            </GatedButton>
            <GatedButton
              canAct={canEdit}
              gateReason="create invoices"
              onClick={() => setFormOpen(true)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              {t('new')}
            </GatedButton>
          </>
        }
      />

      <form
        className="relative max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search);
        }}
      >
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onBlur={() => setQuery(search)}
          placeholder={t('searchPlaceholder')}
          className="pl-8"
        />
      </form>

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon={<FileText className="h-10 w-10" />} title={query ? t('noMatches') : t('empty')} hint={query ? undefined : t('emptyHint')} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>{t('table.invoice')}</TableHead>
                <TableHead>{t('table.customer')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('table.date')}</TableHead>
                <TableHead className="text-right">{t('table.total')}</TableHead>
                <TableHead className="hidden text-right md:table-cell">{t('table.points')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('table.source')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer border-border hover:bg-muted/50"
                  onClick={() => router.push(`/invoices/${r.id}`)}
                >
                  <TableCell className="font-medium text-foreground">
                    <span className="flex items-center gap-1.5">
                      {r.external_id}
                      {r.pdf_path && <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-label="PDF" />}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="text-foreground">{r.contact?.name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{r.contact?.phone}</div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{dateFmt(r.invoice_date)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inrFmt(r.total)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    +{ptsFmt(r.points_earned)}
                    {r.points_redeemed > 0 && <span className="text-muted-foreground"> / −{ptsFmt(r.points_redeemed)}</span>}
                  </TableCell>
                  <TableCell className="hidden text-xs uppercase text-muted-foreground lg:table-cell">{r.source}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {hasMore && !loading && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              await load(rows.length);
              setLoadingMore(false);
            }}
          >
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('loadMore')}
          </Button>
        </div>
      )}

      <ImportDialog kind="invoices" open={importOpen} onOpenChange={setImportOpen} onDone={() => load(0)} />
      <InvoiceFormDialog open={formOpen} onOpenChange={setFormOpen} onCreated={(id) => router.push(`/invoices/${id}`)} />
    </div>
  );
}
