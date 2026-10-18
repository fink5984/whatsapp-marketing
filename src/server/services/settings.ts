import type { BusinessSettings } from "@/generated/prisma/client";
import { db, type Tx } from "../db";
import { DEFAULT_UNSUBSCRIBE_KEYWORDS } from "@/lib/unsubscribe";

/** Weekday (0 = Sunday) → [start, end] in "HH:MM", business timezone. Missing day = no sending. */
export type SendingWindow = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", [string, string]>>;

export const DEFAULT_SENDING_WINDOW: SendingWindow = {
  "0": ["09:00", "20:00"],
  "1": ["09:00", "20:00"],
  "2": ["09:00", "20:00"],
  "3": ["09:00", "20:00"],
  "4": ["09:00", "20:00"],
  "5": ["09:00", "13:00"],
};

export async function getSettings(orgId: string, tx?: Tx): Promise<BusinessSettings> {
  const client = tx ?? db;
  const existing = await client.businessSettings.findUnique({ where: { organizationId: orgId } });
  if (existing) return existing;
  return client.businessSettings.upsert({
    where: { organizationId: orgId },
    update: {},
    create: {
      organizationId: orgId,
      sendingWindow: DEFAULT_SENDING_WINDOW,
      unsubscribeKeywords: DEFAULT_UNSUBSCRIBE_KEYWORDS,
      allowedRedirectDomains: [],
      testRecipients: [],
      alertEmails: [],
    },
  });
}

export function unsubscribeKeywords(settings: Pick<BusinessSettings, "unsubscribeKeywords">): string[] {
  return settings.unsubscribeKeywords.length > 0 ? settings.unsubscribeKeywords : DEFAULT_UNSUBSCRIBE_KEYWORDS;
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function isWithinSendingWindow(window: SendingWindow, timeZone: string, now = new Date()): boolean {
  const { weekday, minutes } = localParts(now, timeZone);
  const range = window[String(weekday) as keyof SendingWindow];
  if (!range) return false;
  return minutes >= toMinutes(range[0]) && minutes < toMinutes(range[1]);
}

/** Next moment (UTC) the window opens, scanning ahead in 15-minute steps (max 8 days). */
export function nextWindowOpening(window: SendingWindow, timeZone: string, from = new Date()): Date | null {
  if (isWithinSendingWindow(window, timeZone, from)) return from;
  const step = 15 * 60_000;
  const start = Math.ceil(from.getTime() / step) * step;
  for (let t = start; t < from.getTime() + 8 * 24 * 3600_000; t += step) {
    const d = new Date(t);
    if (isWithinSendingWindow(window, timeZone, d)) return d;
  }
  return null;
}

/** Minutes of sending time available per weekday, used for ETA estimates. */
export function windowMinutesPerWeek(window: SendingWindow): number {
  return Object.values(window).reduce((sum, r) => (r ? sum + Math.max(0, toMinutes(r[1]) - toMinutes(r[0])) : sum), 0);
}

export const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
