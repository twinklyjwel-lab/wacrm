const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

/** ₹1,23,456.5 → "₹1,23,456.5" (Indian digit grouping). */
export function formatInr(n: number): string {
  return inr.format(Number.isFinite(n) ? n : 0);
}

const int = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export function formatPoints(n: number): string {
  return int.format(Number.isFinite(n) ? n : 0);
}
