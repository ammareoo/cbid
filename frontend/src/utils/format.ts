/** All timestamps arrive in UTC; display in the signed-in user's time zone. */
let zone = 'Asia/Karachi';
export const setDisplayTimeZone = (tz: string) => { zone = tz; };
export const displayTimeZone = () => zone;

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...opts });

export function formatDate(iso: string | Date | null | undefined) {
  if (!iso) return '—';
  return fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}
export function formatDateTime(iso: string | Date | null | undefined) {
  if (!iso) return '—';
  return fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}
export function formatTime(iso: string | Date) {
  return fmt({ hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}
export function dayKey(iso: string | Date) {
  return fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
export function dayParts(iso: string | Date) {
  const d = new Date(iso);
  return {
    day: fmt({ day: 'numeric' }).format(d),
    month: fmt({ month: 'short' }).format(d),
    weekday: fmt({ weekday: 'long' }).format(d),
  };
}

/** "in 3 days", "2 hours ago" — paired with an absolute date wherever it is shown. */
export function relative(iso: string | Date, now = new Date()) {
  const diff = new Date(iso).getTime() - now.getTime();
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000]];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === 'minute') return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(0, 'minute');
}

export function formatBytes(n: number | null | undefined) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function percent(score: number | null | undefined, total: number | null | undefined) {
  if (score == null || !total) return null;
  return Math.round((score / total) * 1000) / 10;
}

export const initials = (name: string) =>
  name.replace(/^(Dr|Prof|Mr|Ms|Mrs)\.?\s+/i, '').split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');

/** Value for <input type="datetime-local"> in the display zone. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const p = Object.fromEntries(fmt({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/** Interprets a datetime-local value in the display zone and returns UTC ISO. */
export function fromLocalInput(value: string): string {
  const [date, time] = value.split('T');
  const [y, m, d] = (date ?? '').split('-').map(Number);
  const [hh, mm] = (time ?? '00:00').split(':').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  // offset of the zone at that instant
  const asZone = new Date(new Date(guess).toLocaleString('en-US', { timeZone: zone }));
  const asUtc = new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' }));
  const offset = asZone.getTime() - asUtc.getTime();
  return new Date(guess - offset).toISOString();
}
