/**
 * Consent sources and eligibility — shared by server and UI (no server imports).
 *
 * Policy basis:
 *  - WhatsApp Business Messaging Policy: the recipient gave their number and
 *    opt-in permission to receive messages from the business; the business
 *    chooses the opt-in method (it need not be WhatsApp-specific).
 *  - Israeli Communications Law §30A: prior consent for advertising, or the
 *    existing-customer exception (§30A(c)).
 *  - Opt-outs are always honored, on or off WhatsApp.
 */

export const CONSENT_SOURCES = [
  "WEB_FORM",
  "EXISTING_CUSTOMER",
  "PAPER_FORM",
  "VERBAL_RECORDED",
  "INBOUND_MESSAGE",
  "OTHER_DOCUMENTED",
  "IMPORT_WITH_PROOF",
  "API",
  "MANUAL_WITH_PROOF",
] as const;
export type ConsentSourceCode = (typeof CONSENT_SOURCES)[number];

export const CONSENT_SOURCE_INFO: Record<ConsentSourceCode, { label: string; hint: string; defaultNote: string; bulk: boolean }> = {
  WEB_FORM: {
    label: "טופס הרשמה (אתר / דף נחיתה)",
    hint: "אנשי הקשר נרשמו וסימנו הסכמה לקבל הודעות שיווקיות מהעסק.",
    defaultNote: "נרשמו בטופס וסימנו הסכמה לקבלת הודעות שיווקיות מהעסק",
    bulk: true,
  },
  EXISTING_CUSTOMER: {
    label: "לקוחות קיימים (סעיף 30א(ג))",
    hint: "מסרו את פרטיהם ברכישה או במשא ומתן, הודיעו להם שהפרטים ישמשו לפרסום וניתנה להם אפשרות לסרב — והפרסום הוא על מוצרים או שירותים דומים.",
    defaultNote: "לקוחות קיימים שמסרו פרטים במסגרת רכישה/משא ומתן, קיבלו הודעה על שימוש לפרסום ואפשרות לסרב, ולא סירבו (סעיף 30א(ג))",
    bulk: true,
  },
  PAPER_FORM: {
    label: "טופס חתום",
    hint: "הסכמה בכתב, חתומה.",
    defaultNote: "הסכמה בכתב בטופס חתום",
    bulk: true,
  },
  VERBAL_RECORDED: {
    label: "הסכמה בשיחה מוקלטת",
    hint: "הסכמה בעל-פה שתועדה בהקלטה.",
    defaultNote: "הסכמה בעל-פה בשיחה מוקלטת",
    bulk: true,
  },
  INBOUND_MESSAGE: {
    label: "פנייה יזומה של הלקוח",
    hint: "הלקוח פנה ביוזמתו וביקש לקבל עדכונים והצעות.",
    defaultNote: "הלקוח פנה ביוזמתו וביקש לקבל הודעות מהעסק",
    bulk: true,
  },
  OTHER_DOCUMENTED: {
    label: "אחר (מתועד)",
    hint: "מקור הסכמה אחר שמתועד אצלכם — תארו אותו בקצרה.",
    defaultNote: "הסכמה מתועדת אצל העסק",
    bulk: true,
  },
  IMPORT_WITH_PROOF: { label: "ייבוא עם אסמכתה", hint: "", defaultNote: "", bulk: false },
  API: { label: "API / אינטגרציה", hint: "", defaultNote: "", bulk: false },
  MANUAL_WITH_PROOF: { label: "תיעוד ידני", hint: "", defaultNote: "", bulk: false },
};

export const BULK_CONSENT_SOURCES = CONSENT_SOURCES.filter((s) => CONSENT_SOURCE_INFO[s].bulk);

export function consentSourceLabel(s: string): string {
  return CONSENT_SOURCE_INFO[s as ConsentSourceCode]?.label ?? s;
}

export type EligibilityReason = "ELIGIBLE" | "SUPPRESSED" | "CONSENT_REVOKED" | "NO_CONSENT";

export const ELIGIBILITY_INFO: Record<EligibilityReason, { label: string; explain: string; tone: "success" | "danger" | "warning" }> = {
  ELIGIBLE: { label: "כשיר לשליחה", explain: "יש הסכמה מתועדת ואין בקשת הסרה.", tone: "success" },
  SUPPRESSED: {
    label: "ביקש/ה הסרה",
    explain: "המספר ברשימת ההסרה של העסק. לא יישלחו אליו הודעות שיווקיות מאף מספר של העסק, גם לא אחרי ייבוא חוזר.",
    tone: "danger",
  },
  CONSENT_REVOKED: { label: "הסכמה בוטלה", explain: "ההסכמה בוטלה. אפשר לשלוח שוב רק אחרי הסכמה חדשה.", tone: "danger" },
  NO_CONSENT: {
    label: "אין הסכמה רשומה",
    explain: "לא נרשם מקור הסכמה לאיש הקשר. ייבאו את הרשימה עם מקור הסכמה, או תעדו הסכמה בעמוד איש הקשר.",
    tone: "warning",
  },
};

export function eligibilityOf(c: { consentStatus: string; isSuppressed: boolean }): EligibilityReason {
  if (c.isSuppressed) return "SUPPRESSED";
  if (c.consentStatus === "REVOKED") return "CONSENT_REVOKED";
  if (c.consentStatus !== "GRANTED") return "NO_CONSENT";
  return "ELIGIBLE";
}
