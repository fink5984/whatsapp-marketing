/**
 * Classification of WhatsApp Cloud API failures into what the sender should do.
 *
 * RETRYABLE           transient; Meta did not accept the message → retry with backoff
 * RATE_LIMITED        throughput / spam / pair-rate limit → retry later, longer backoff
 * PERMANENT           this message will never succeed → mark FAILED
 * RECIPIENT_OPTED_OUT recipient stopped marketing messages from this business → FAILED + suppress
 * ACCOUNT             token / account / template-level problem → requeue message, pause campaign
 * UNCERTAIN           request may have reached Meta (timeout/reset) → never auto-resend
 */
export type ErrorClass = "RETRYABLE" | "RATE_LIMITED" | "PERMANENT" | "RECIPIENT_OPTED_OUT" | "ACCOUNT" | "UNCERTAIN";

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80007, 130429, 131048, 131056]);
const RETRYABLE_CODES = new Set([1, 2, 131000, 131016, 133004, 133005]);
const ACCOUNT_CODES = new Set([
  3, // capability
  10, // permission denied
  190, // access token expired/invalid
  200, // permission error
  368, // temporarily blocked for policy violations
  131031, // business account locked
  131042, // payment / billing issue
  131045, // certificate / registration
  131057, // account in maintenance
  132015, // template paused (low quality)
  132016, // template disabled
  133010, // phone number not registered
  135000, // generic user error (account)
]);
const OPTED_OUT_CODES = new Set([131050]);

export function classifyMetaError(httpStatus: number | null, code: number | null): ErrorClass {
  if (code !== null) {
    if (OPTED_OUT_CODES.has(code)) return "RECIPIENT_OPTED_OUT";
    if (RATE_LIMIT_CODES.has(code)) return "RATE_LIMITED";
    if (ACCOUNT_CODES.has(code)) return "ACCOUNT";
    if (RETRYABLE_CODES.has(code)) return "RETRYABLE";
  }
  if (httpStatus === 429) return "RATE_LIMITED";
  if (httpStatus === 401 || httpStatus === 403) return "ACCOUNT";
  if (httpStatus !== null && httpStatus >= 500) return "RETRYABLE";
  return "PERMANENT";
}

/** Errors thrown before any byte could have reached Meta are safe to retry. */
const PRE_CONNECT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED"]);

export function classifyNetworkError(err: unknown): ErrorClass {
  const code = networkErrorCode(err);
  if (code && PRE_CONNECT_CODES.has(code)) return "RETRYABLE";
  return "UNCERTAIN";
}

export function networkErrorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; cause?: { code?: string; name?: string }; name?: string };
  return e.cause?.code ?? e.code ?? (e.name === "TimeoutError" || e.name === "AbortError" ? "TIMEOUT" : null);
}

/** Exponential backoff with full jitter. attempt is 1-based. */
export function backoffMs(attempt: number, kind: ErrorClass, random = Math.random): number {
  const base = kind === "RATE_LIMITED" ? 60_000 : 15_000;
  const cap = kind === "RATE_LIMITED" ? 30 * 60_000 : 20 * 60_000;
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}

/** Hebrew explanations for common codes, shown in failure-reason reports. */
export const META_ERROR_LABELS: Record<string, string> = {
  "131026": "לא ניתן למסור — המספר אינו ב-WhatsApp או שהנמען אינו זמין",
  "131047": "חלון השירות (24 שעות) נסגר — נדרשת תבנית",
  "131049": "Meta בחרה שלא למסור כדי לשמור על איכות חוויית המשתמש (מגבלת הודעות שיווק לנמען)",
  "131050": "הנמען הפסיק לקבל הודעות שיווקיות מהעסק",
  "131051": "סוג הודעה לא נתמך",
  "131053": "שגיאת העלאת מדיה",
  "131030": "הנמען אינו ברשימת מספרי הבדיקה המורשים",
  "131031": "חשבון העסק נעול",
  "131042": "בעיית תשלום בחשבון Meta",
  "131048": "הגבלת קצב עקב סימון ספאם",
  "131056": "יותר מדי הודעות לאותו נמען בזמן קצר",
  "130429": "חריגה ממגבלת קצב השליחה",
  "132000": "מספר המשתנים לא תואם לתבנית",
  "132001": "התבנית לא קיימת בשפה זו",
  "132005": "הטקסט לאחר מילוי המשתנים ארוך מדי",
  "132007": "התוכן מפר את מדיניות התבניות",
  "132012": "פורמט משתנה שגוי",
  "132015": "התבנית הושהתה עקב איכות נמוכה",
  "132016": "התבנית הושבתה",
  "133010": "מספר השולח אינו רשום ב-Cloud API",
  "190": "אסימון הגישה פג תוקף או אינו תקין",
  "368": "החשבון נחסם זמנית עקב הפרת מדיניות",
  "SUPPRESSED": "הנמען ביקש הסרה",
  "NO_CONSENT": "אין הסכמה מתועדת",
  "CONTACT_DELETED": "איש הקשר נמחק",
  "WINDOW_CLOSED": "חלון השירות נסגר",
  "NOT_TEST_RECIPIENT": "המספר אינו מוגדר כמספר בדיקה",
  "UNCERTAIN": "לא התקבל אישור מ-Meta — ייתכן שההודעה נשלחה",
  "MAX_ATTEMPTS": "מוצו ניסיונות השליחה",
  "CAMPAIGN_CANCELLED": "הקמפיין בוטל",
};
