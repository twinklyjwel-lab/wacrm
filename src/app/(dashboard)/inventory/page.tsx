'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Gem, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ImportDialog } from '@/components/jewellery/import-dialog';
import { InventoryItemDialog, type InventoryItem } from '@/components/jewellery/inventory-item-dialog';
import { MetalRatesPanel } from '@/components/jewellery/metal-rates-panel';
import {
  EmptyState,
  fetchJson,
  NativeSelect,
  PageHeader,
  Spinner,
  StatCard,
  StatusChip,
  weightFmt,
} from '@/components/jewellery/shared';

type Tab = 'gold' | 'silver' | 'rates';

export default function InventoryPage() {
  const t = useTranslations('Jewellery.inventory');
  const canEdit = useCan('send-messages');
  const [tab, setTab] = useState<Tab>('gold');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'in_stock' | 'reserved' | 'sold' | 'all'>('in_stock');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from('inventory_items')
      .select('*')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(2000);
    setItems((data ?? []) as InventoryItem[]);
    setLoading(false);
  }, []);
  useEffect(() => {
    // load() only sets state after its awaited fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const metal = tab === 'rates' ? 'gold' : tab;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (i) =>
        i.metal === metal &&
        (status === 'all' || i.status === status) &&
        (!q || i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q)),
    );
  }, [items, metal, status, search]);

  const stats = useMemo(() => {
    const inStock = items.filter((i) => i.metal === metal && i.status === 'in_stock');
    return { count: inStock.length, weight: inStock.reduce((s, i) => s + Number(i.net_weight), 0) };
  }, [items, metal]);

  async function remove(item: InventoryItem) {
    if (!confirm(t('confirmDelete', { sku: item.sku }))) return;
    try {
      await fetchJson(`/api/inventory/${item.id}`, { method: 'DELETE' });
      setItems((list) => list.filter((i) => i.id !== item.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorDelete'));
    }
  }

  const list = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <StatCard label={t('inStockCount')} value={stats.count} />
        <StatCard label={t('inStockWeight')} value={weightFmt(stats.weight)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('searchPlaceholder')} className="pl-8" />
        </div>
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="in_stock">{t('status.in_stock')}</option>
          <option value="reserved">{t('status.reserved')}</option>
          <option value="sold">{t('status.sold')}</option>
          <option value="all">{t('status.all')}</option>
        </NativeSelect>
      </div>
      {visible.length === 0 ? (
        <EmptyState icon={<Gem className="h-10 w-10" />} title={t('empty')} hint={t('emptyHint')} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>{t('table.item')}</TableHead>
                <TableHead>{t('table.purity')}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">{t('table.gross')}</TableHead>
                <TableHead className="text-right">{t('table.net')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('table.making')}</TableHead>
                <TableHead className="hidden text-right md:table-cell">{t('table.priority')}</TableHead>
                <TableHead>{t('table.status')}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((i) => (
                <TableRow key={i.id} className="border-border">
                  <TableCell>
                    <div className="text-foreground">{i.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {i.sku}
                      {i.category ? ` · ${i.category}` : ''}
                    </div>
                  </TableCell>
                  <TableCell>{i.purity}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{weightFmt(i.gross_weight)}</TableCell>
                  <TableCell className="text-right tabular-nums">{weightFmt(i.net_weight)}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {Number(i.making_charge)} {t(`makingShort.${i.making_charge_type}`)}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{i.priority}</TableCell>
                  <TableCell>
                    <StatusChip status={i.status} label={t(`status.${i.status}`)} />
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('edit')}
                          onClick={() => {
                            setEditing(i);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" aria-label={t('delete')} onClick={() => remove(i)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          tab !== 'rates' && (
            <>
              <GatedButton canAct={canEdit} gateReason="import inventory" variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" />
                {t('import')}
              </GatedButton>
              <GatedButton
                canAct={canEdit}
                gateReason="add inventory"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                {t('add')}
              </GatedButton>
            </>
          )
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="gold">{t('tabs.gold')}</TabsTrigger>
          <TabsTrigger value="silver">{t('tabs.silver')}</TabsTrigger>
          <TabsTrigger value="rates">{t('tabs.rates')}</TabsTrigger>
        </TabsList>
        <TabsContent value="gold" className="pt-4">
          {loading ? <Spinner /> : list}
        </TabsContent>
        <TabsContent value="silver" className="pt-4">
          {loading ? <Spinner /> : list}
        </TabsContent>
        <TabsContent value="rates" className="pt-4">
          <MetalRatesPanel />
        </TabsContent>
      </Tabs>

      <InventoryItemDialog open={dialogOpen} onOpenChange={setDialogOpen} item={editing} defaultMetal={metal} onSaved={load} />
      <ImportDialog kind="inventory" open={importOpen} onOpenChange={setImportOpen} onDone={load} />
    </div>
  );
}
