export const DEFAULT_TZ = 'Asia/Kolkata';

const f = (opts: Intl.DateTimeFormatOptions, tz = DEFAULT_TZ) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, ...opts });
export const fmtDate = (iso: string, tz?: string) => f({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }, tz).format(new Date(iso));
export const fmtDateShort = (iso: string, tz?: string) => f({ weekday: 'short', day: 'numeric', month: 'short' }, tz).format(new Date(iso));
export const fmtTime = (iso: string, tz?: string) => f({ hour: 'numeric', minute: '2-digit', hour12: true }, tz).format(new Date(iso)).toUpperCase();
export const fmtDateTime = (iso: string, tz?: string) => `${fmtDateShort(iso, tz)}, ${fmtTime(iso, tz)}`;
export const tzLabel = (tz = DEFAULT_TZ) => (tz === 'Asia/Kolkata' ? 'IST' : tz);

/** YYYY-MM-DD of an instant as seen in a time zone */
export function dayKey(iso: string | Date, tz = DEFAULT_TZ): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = f({ year: 'numeric', month: '2-digit', day: '2-digit' }, tz).formatToParts(d);
  const g = (t: string) => p.find(x => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** Build a UTC instant from a local date + HH:mm in the given zone (IST has no DST; general offset lookup used anyway). */
export function zonedToUtc(date: string, hhmm: string, tz = DEFAULT_TZ): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const asZoned = new Date(new Date(guess).toLocaleString('en-US', { timeZone: tz }));
  const asUtc = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess - (asZoned.getTime() - asUtc.getTime()));
}

export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
