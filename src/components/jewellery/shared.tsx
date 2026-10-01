'use client';

import type { ReactNode, SelectHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers:
      init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
        : init?.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error ?? `Request failed (${res.status})`
    );
  }
  return data as T;
}

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});
export function inrFmt(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return inr.format(Number.isFinite(v) ? v : 0);
}

const pts = new Intl.NumberFormat('en-IN');
export function ptsFmt(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return pts.format(Number.isFinite(v) ? v : 0);
}

export function weightFmt(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return `${(Number.isFinite(v) ? v : 0).toFixed(3)} g`;
}

export function dateFmt(
  d: string | null | undefined,
  withTime = false
): string {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(date);
}

/** "1992-08-12" → "12 Aug" (year hidden — it's a recurring date). */
export function dayMonthFmt(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  if (!y || !m || !day) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, day)));
}

export function NativeSelect({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 rounded-lg border px-2.5 text-sm outline-none focus:ring-1 disabled:opacity-60',
        className
      )}
    />
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-foreground text-2xl font-bold">{title}</h1>
        {subtitle && (
          <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="border-border bg-card rounded-xl border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-foreground mt-1 text-xl font-semibold tabular-nums">
        {value}
      </p>
      {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex h-40 items-center justify-center">
      <Loader2 className="text-primary h-6 w-6 animate-spin" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="border-border bg-card flex h-56 flex-col items-center justify-center rounded-xl border px-4 text-center">
      <div className="text-muted-foreground mb-3">{icon}</div>
      <p className="text-foreground text-sm font-medium">{title}</p>
      {hint && (
        <p className="text-muted-foreground mt-1 max-w-md text-xs">{hint}</p>
      )}
    </div>
  );
}

const METAL_STYLES: Record<string, string> = {
  gold: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  silver:
    'border-slate-400/40 bg-slate-400/10 text-slate-600 dark:text-slate-300',
};

export function MetalChip({
  metal,
  purity,
}: {
  metal: string | null;
  purity?: string | null;
}) {
  if (!metal) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize',
        METAL_STYLES[metal] ?? 'border-border text-muted-foreground'
      )}
    >
      {metal}
      {purity ? ` · ${purity}` : ''}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-300',
  sending: 'border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-300',
  sent: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  skipped: 'border-border bg-muted text-muted-foreground',
  cancelled: 'border-border bg-muted text-muted-foreground',
  failed: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300',
  in_stock:
    'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  reserved:
    'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  sold: 'border-border bg-muted text-muted-foreground',
};

export function StatusChip({
  status,
  label,
}: {
  status: string;
  label: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
        STATUS_STYLES[status] ?? 'border-border text-muted-foreground'
      )}
    >
      {label}
    </span>
  );
}
