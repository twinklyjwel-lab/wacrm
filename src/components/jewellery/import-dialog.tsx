'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  chunk,
  groupInvoiceRows,
  guessMapping,
  IMPORT_FIELDS,
  missingRequired,
  parseCsv,
  rowToRecord,
  type Cell,
  type ImportKind,
  type Mapping,
} from '@/lib/loyalty/import';
import { fetchJson, NativeSelect } from './shared';

const ENDPOINT: Record<ImportKind, { url: string; key: string }> = {
  invoices: { url: '/api/invoices', key: 'invoices' },
  inventory: { url: '/api/inventory', key: 'items' },
  customers: { url: '/api/customers/import', key: 'customers' },
};

/** Batch size per request — small enough to stay well inside route timeouts. */
const BATCH = 50;

interface RowResult {
  ok: boolean;
  error?: string;
  created?: boolean;
  external_id?: string | null;
  key?: string | null;
}

async function readFile(file: File): Promise<Cell[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    return (await readSheet(file)) as Cell[][];
  }
  if (/\.xls$/i.test(file.name)) {
    throw new Error('xls');
  }
  return parseCsv(await file.text());
}

export function ImportDialog({
  kind,
  open,
  onOpenChange,
  onDone,
}: {
  kind: ImportKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const t = useTranslations('Jewellery.import');
  const tf = useTranslations('Jewellery.fields');
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Cell[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<{
    ok: number;
    dup: number;
    failed: { label: string; error: string }[];
  } | null>(null);

  function reset() {
    setFileName('');
    setHeaders([]);
    setRows([]);
    setMapping({});
    setSummary(null);
    setProgress(0);
  }

  async function onFile(file: File) {
    reset();
    try {
      const grid = await readFile(file);
      if (grid.length < 2) {
        toast.error(t('errorEmpty'));
        return;
      }
      const head = grid[0].map((h) => String(h ?? '').trim());
      setFileName(file.name);
      setHeaders(head);
      setRows(grid.slice(1));
      setMapping(guessMapping(head, kind));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message === 'xls'
          ? t('errorXls')
          : t('errorRead')
      );
    }
  }

  const missing = missingRequired(mapping, kind);

  async function runImport() {
    setRunning(true);
    setProgress(0);
    const payloads: unknown[] =
      kind === 'invoices'
        ? groupInvoiceRows(rows, mapping).map((inv) => inv)
        : rows
            .map((r) => rowToRecord(r, mapping))
            .filter((r) => Object.values(r).some((v) => v != null));
    const batches = chunk(payloads, BATCH);
    let ok = 0;
    let dup = 0;
    const failed: { label: string; error: string }[] = [];
    try {
      for (let i = 0; i < batches.length; i++) {
        const { results } = await fetchJson<{ results: RowResult[] }>(
          ENDPOINT[kind].url,
          {
            method: 'POST',
            body: JSON.stringify({
              [ENDPOINT[kind].key]: batches[i],
              source: 'csv',
            }),
          }
        );
        for (const r of results) {
          if (!r.ok)
            failed.push({
              label: r.external_id ?? r.key ?? '?',
              error: r.error ?? '',
            });
          else if (r.created === false) dup++;
          else ok++;
        }
        setProgress(Math.round(((i + 1) / batches.length) * 100));
      }
      setSummary({ ok, dup, failed });
      if (ok > 0) toast.success(t('toastDone', { count: ok }));
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorImport'));
      setSummary({ ok, dup, failed });
    } finally {
      setRunning(false);
    }
  }

  const fields = IMPORT_FIELDS[kind];
  const recordCount =
    kind === 'invoices' && headers.length
      ? groupInvoiceRows(rows, mapping).length
      : rows.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !running) reset();
        if (!running) onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t(`title.${kind}`)}</DialogTitle>
          <DialogDescription>{t(`description.${kind}`)}</DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = '';
          }}
        />

        {!headers.length ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="border-border bg-muted/40 text-muted-foreground hover:border-primary hover:text-foreground flex h-36 w-full flex-col items-center justify-center rounded-xl border border-dashed text-sm"
          >
            <Upload className="mb-2 h-6 w-6" />
            {t('chooseFile')}
            <span className="mt-1 text-xs">{t('fileHint')}</span>
          </button>
        ) : (
          <div className="space-y-4">
            <div className="border-border bg-muted/40 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <FileSpreadsheet className="text-primary h-4 w-4 shrink-0" />
                <span className="truncate">{fileName}</span>
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {t('recordCount', { count: recordCount })}
              </span>
            </div>

            <div>
              <p className="text-foreground mb-2 text-sm font-medium">
                {t('mapColumns')}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {fields.map((f) => (
                  <label
                    key={f.key}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="text-muted-foreground min-w-0 truncate">
                      {tf(f.key)}
                      {f.required && <span className="text-red-400"> *</span>}
                    </span>
                    <NativeSelect
                      className="w-44 shrink-0"
                      value={mapping[f.key] ?? ''}
                      onChange={(e) =>
                        setMapping((m) => ({
                          ...m,
                          [f.key]:
                            e.target.value === ''
                              ? null
                              : Number(e.target.value),
                        }))
                      }
                    >
                      <option value="">{t('notMapped')}</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || t('column', { n: i + 1 })}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                ))}
              </div>
              {missing.length > 0 && (
                <p className="mt-2 text-xs text-red-400">
                  {t('missingRequired', {
                    fields: missing.map((k) => tf(k)).join(', '),
                  })}
                </p>
              )}
              {kind === 'invoices' && (
                <p className="text-muted-foreground mt-2 text-xs">
                  {t('invoiceHint')}
                </p>
              )}
            </div>

            {running && (
              <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                <div
                  className="bg-primary h-1.5 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            {summary && (
              <div className="border-border bg-muted/40 rounded-lg border p-3 text-sm">
                <p className="text-foreground">
                  {t('resultOk', { count: summary.ok })}
                </p>
                {summary.dup > 0 && (
                  <p className="text-muted-foreground">
                    {t('resultDup', { count: summary.dup })}
                  </p>
                )}
                {summary.failed.length > 0 && (
                  <>
                    <p className="text-red-400">
                      {t('resultFailed', { count: summary.failed.length })}
                    </p>
                    <ul className="text-muted-foreground mt-1 max-h-32 overflow-y-auto text-xs">
                      {summary.failed.slice(0, 50).map((f, i) => (
                        <li key={i}>
                          {f.label}: {f.error}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {headers.length > 0 && !running && (
            <Button variant="outline" onClick={() => inputRef.current?.click()}>
              {t('otherFile')}
            </Button>
          )}
          <Button
            onClick={runImport}
            disabled={
              !headers.length ||
              missing.length > 0 ||
              running ||
              recordCount === 0
            }
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('importBtn', { count: recordCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
