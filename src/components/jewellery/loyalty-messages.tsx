'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { MessageCircle, RotateCcw, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  dateFmt,
  EmptyState,
  fetchJson,
  NativeSelect,
  Spinner,
  StatusChip,
} from './shared';

interface Row {
  id: string;
  kind: string;
  status: string;
  send_at: string;
  sent_at: string | null;
  days_before: number | null;
  last_error: string | null;
  attempts: number;
  contact: { name: string | null; phone: string } | null;
}

export function LoyaltyMessages() {
  const t = useTranslations('Jewellery.messages');
  const tk = useTranslations('Jewellery.messageKinds');
  const ts = useTranslations('Jewellery.messageStatus');
  const canAct = useCan('send-messages');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [status, setStatus] = useState('all');
  const [kind, setKind] = useState('all');

  const load = useCallback(async () => {
    let q = createClient()
      .from('loyalty_scheduled_messages')
      .select(
        'id, kind, status, send_at, sent_at, days_before, last_error, attempts, contact:contacts(name, phone)'
      )
      .order('send_at', { ascending: status === 'pending' })
      .limit(300);
    if (status !== 'all') q = q.eq('status', status);
    if (kind !== 'all') q = q.eq('kind', kind);
    const { data } = await q;
    setRows((data ?? []) as unknown as Row[]);
  }, [status, kind]);
  useEffect(() => {
    // load() only sets state after its awaited fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(id: string, action: 'retry' | 'cancel') {
    try {
      await fetchJson('/api/loyalty/messages', {
        method: 'POST',
        body: JSON.stringify({ id, action }),
      });
      toast.success(action === 'retry' ? t('toastRetry') : t('toastCancel'));
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <NativeSelect
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">{t('allStatuses')}</option>
          {['pending', 'sent', 'failed', 'skipped', 'cancelled'].map((s) => (
            <option key={s} value={s}>
              {ts(s)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">{t('allKinds')}</option>
          {['feedback', 'expiry_reminder', 'birthday', 'anniversary'].map(
            (k) => (
              <option key={k} value={k}>
                {tk(k)}
              </option>
            )
          )}
        </NativeSelect>
      </div>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<MessageCircle className="h-10 w-10" />}
          title={t('empty')}
          hint={t('emptyHint')}
        />
      ) : (
        <div className="border-border bg-card overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>{t('table.customer')}</TableHead>
                <TableHead>{t('table.message')}</TableHead>
                <TableHead>{t('table.when')}</TableHead>
                <TableHead>{t('table.status')}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="border-border align-top">
                  <TableCell>
                    <div className="text-foreground">
                      {r.contact?.name ?? '—'}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {r.contact?.phone}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-foreground">
                      {tk(r.kind)}
                      {r.days_before
                        ? ` · ${t('daysBefore', { days: r.days_before })}`
                        : ''}
                    </div>
                    {r.last_error && (
                      <div className="text-muted-foreground max-w-xs text-xs">
                        {r.last_error}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                    {dateFmt(r.sent_at ?? r.send_at, true)}
                  </TableCell>
                  <TableCell>
                    <StatusChip status={r.status} label={ts(r.status)} />
                  </TableCell>
                  <TableCell>
                    {canAct &&
                      ['failed', 'skipped', 'cancelled'].includes(r.status) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => act(r.id, 'retry')}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {t('retry')}
                        </Button>
                      )}
                    {canAct && r.status === 'pending' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => act(r.id, 'cancel')}
                      >
                        <X className="h-3.5 w-3.5" />
                        {t('cancel')}
                      </Button>
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
}
