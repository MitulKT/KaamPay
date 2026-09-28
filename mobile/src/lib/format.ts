// Indian money + dates. Backend sends UTC ISO strings without a zone; treat them as UTC and show IST.

export function inr(x: number | null | undefined, decimals = 2): string {
  const n = Number(x || 0);
  const neg = n < 0;
  const [whole, frac] = Math.abs(n).toFixed(decimals).split('.');
  let head = whole.slice(0, -3);
  const tail = whole.slice(-3);
  head = head.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const w = head ? `${head},${tail}` : tail;
  return `${neg ? '-' : ''}₹${w}${frac ? '.' + frac : ''}`;
}

export const inr0 = (x: number | null | undefined) => inr(x, 0);

export function toDate(s?: string | null): Date | null {
  if (!s) return null;
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
}

const IST = 'Asia/Kolkata';

export function fmtDate(s?: string | null): string {
  const d = toDate(s);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: IST }) : '';
}

export function fmtDateTime(s?: string | null): string {
  const d = toDate(s);
  return d
    ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: IST })
    : '';
}

export function isoDay(d: Date = new Date()): string {
  // YYYY-MM-DD in IST
  return d.toLocaleDateString('en-CA', { timeZone: IST });
}

export function monthRange(offset = 0): { from: string; to: string } {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: IST }));
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  const p = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: p(first), to: p(last) };
}

export function pcs(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)} pcs`;
}

export function initials(name?: string): string {
  return (name || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}
