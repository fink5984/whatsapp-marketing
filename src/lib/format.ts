const nf = new Intl.NumberFormat("he-IL");

export function fmtNumber(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : nf.format(n);
}

export function fmtPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function fmtMoney(n: number | null | undefined, currency = "USD"): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("he-IL", { style: "currency", currency, maximumFractionDigits: n < 10 ? 3 : 2 }).format(n);
}

/** Dates are stored in UTC and rendered in the business timezone. */
export function fmtDateTime(d: Date | string | null | undefined, timeZone = "Asia/Jerusalem"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("he-IL", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(d));
}

export function fmtDate(d: Date | string | null | undefined, timeZone = "Asia/Jerusalem"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("he-IL", { timeZone, dateStyle: "medium" }).format(new Date(d));
}

export function fmtRelative(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("he", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return "הרגע";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return fmtDate(d);
}

/** For <input type="datetime-local"> in the business timezone. */
export function toLocalInputValue(d: Date | null | undefined, timeZone = "Asia/Jerusalem"): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** Request-time helpers (keep impure clock reads out of component bodies). */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86400_000);
}
export function ageMs(d: Date): number {
  return Date.now() - d.getTime();
}
