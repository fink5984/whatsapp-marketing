/**
 * Template component model (mirrors the Graph API shape) + pure helpers shared
 * by the server and the template editor/preview UI.
 */
import { isUnsubscribeText, normalizeForMatch } from "./unsubscribe";

export type HeaderFormat = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

export type TemplateButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string; example?: string[] }
  | { type: "PHONE_NUMBER"; text: string; phone_number: string };

export type TemplateComponent =
  | { type: "HEADER"; format: HeaderFormat; text?: string; example?: { header_text?: string[]; header_handle?: string[] } }
  | { type: "BODY"; text: string; example?: { body_text?: string[][] } }
  | { type: "FOOTER"; text: string }
  | { type: "BUTTONS"; buttons: TemplateButton[] };

/** Limits per Meta's message-template documentation. */
export const TEMPLATE_LIMITS = {
  nameMax: 512,
  headerTextMax: 60,
  headerVariablesMax: 1,
  bodyMax: 1024,
  footerMax: 60,
  buttonsMax: 10,
  urlButtonsMax: 2,
  phoneButtonsMax: 1,
  buttonTextMax: 25,
  urlMax: 2000,
  mediaMaxMb: { IMAGE: 5, VIDEO: 16, DOCUMENT: 100 } as Record<string, number>,
  mediaTypes: {
    IMAGE: ["image/jpeg", "image/png"],
    VIDEO: ["video/mp4", "video/3gpp"],
    DOCUMENT: ["application/pdf"],
  } as Record<string, string[]>,
};

export const ADVERTISING_LABEL = "פרסומת";

const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function extractVars(text: string | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(VAR_RE)].map((m) => m[1]);
}

export function getComponent<T extends TemplateComponent["type"]>(components: TemplateComponent[], type: T) {
  return components.find((c) => c.type === type) as Extract<TemplateComponent, { type: T }> | undefined;
}

export type VariableSlot = {
  key: string; // "header.1" | "body.1" | "body.first_name" | "button.0"
  component: "header" | "body" | "button";
  name: string;
  buttonIndex?: number;
  label: string;
};

/** Every placeholder the sender has to fill when sending the template. */
export function templateSlots(components: TemplateComponent[]): VariableSlot[] {
  const slots: VariableSlot[] = [];
  const header = getComponent(components, "HEADER");
  if (header?.format === "TEXT") {
    for (const v of extractVars(header.text)) slots.push({ key: `header.${v}`, component: "header", name: v, label: `כותרת {{${v}}}` });
  }
  const body = getComponent(components, "BODY");
  for (const v of [...new Set(extractVars(body?.text))]) slots.push({ key: `body.${v}`, component: "body", name: v, label: `גוף {{${v}}}` });
  const buttons = getComponent(components, "BUTTONS");
  buttons?.buttons.forEach((b, i) => {
    if (b.type === "URL" && extractVars(b.url).length) {
      slots.push({ key: `button.${i}`, component: "button", name: extractVars(b.url)[0], buttonIndex: i, label: `כפתור "${b.text}" (סיומת קישור)` });
    }
  });
  return slots;
}

export function mediaHeaderFormat(components: TemplateComponent[]): HeaderFormat | null {
  const h = getComponent(components, "HEADER");
  return h && h.format !== "TEXT" ? h.format : null;
}

export type TemplateAnalysis = {
  hasUnsubscribeFooter: boolean;
  hasUnsubscribeButton: boolean;
  unsubscribeButtonIndex: number | null;
  hasAdvertisingLabel: boolean;
};

export function analyzeTemplate(components: TemplateComponent[], keywords?: string[]): TemplateAnalysis {
  const footer = getComponent(components, "FOOTER");
  const body = getComponent(components, "BODY");
  const header = getComponent(components, "HEADER");
  const buttons = getComponent(components, "BUTTONS")?.buttons ?? [];
  const unsubscribeButtonIndex = buttons.findIndex((b) => b.type === "QUICK_REPLY" && isUnsubscribeText(b.text, keywords));
  const textHasOptOut = (t?: string) =>
    !!t && (normalizeForMatch(t).includes(normalizeForMatch("השיבו הסר")) || normalizeForMatch(t).includes("הסרה") || /\bstop\b/i.test(t));
  const start = normalizeForMatch(`${header?.format === "TEXT" ? header.text ?? "" : ""} ${body?.text ?? ""}`).slice(0, 40);
  return {
    hasUnsubscribeFooter: textHasOptOut(footer?.text) || textHasOptOut(body?.text),
    hasUnsubscribeButton: unsubscribeButtonIndex >= 0,
    unsubscribeButtonIndex: unsubscribeButtonIndex >= 0 ? unsubscribeButtonIndex : null,
    hasAdvertisingLabel: start.startsWith(normalizeForMatch(ADVERTISING_LABEL)),
  };
}

export type ValidationIssue = { level: "error" | "warning"; message: string };

/** Local validation before submitting to Meta (Meta remains the final authority). */
export function validateTemplate(input: { name: string; category: string; components: TemplateComponent[] }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (message: string) => issues.push({ level: "error", message });
  const warn = (message: string) => issues.push({ level: "warning", message });

  if (!/^[a-z0-9_]+$/.test(input.name)) err("שם התבנית: אותיות אנגליות קטנות, ספרות וקו תחתון בלבד");
  if (input.name.length > TEMPLATE_LIMITS.nameMax) err("שם התבנית ארוך מדי");

  const header = getComponent(input.components, "HEADER");
  const body = getComponent(input.components, "BODY");
  const footer = getComponent(input.components, "FOOTER");
  const buttons = getComponent(input.components, "BUTTONS")?.buttons ?? [];

  if (!body?.text?.trim()) err("גוף ההודעה הוא שדה חובה");
  if (body && body.text.length > TEMPLATE_LIMITS.bodyMax) err(`גוף ההודעה מוגבל ל-${TEMPLATE_LIMITS.bodyMax} תווים`);

  if (header?.format === "TEXT") {
    if (!header.text?.trim()) err("כותרת טקסט ריקה");
    if ((header.text ?? "").length > TEMPLATE_LIMITS.headerTextMax) err(`כותרת מוגבלת ל-${TEMPLATE_LIMITS.headerTextMax} תווים`);
    if (extractVars(header.text).length > TEMPLATE_LIMITS.headerVariablesMax) err("כותרת יכולה להכיל משתנה אחד לכל היותר");
  }
  if (footer) {
    if (footer.text.length > TEMPLATE_LIMITS.footerMax) err(`Footer מוגבל ל-${TEMPLATE_LIMITS.footerMax} תווים`);
    if (extractVars(footer.text).length) err("Footer אינו יכול להכיל משתנים");
  }

  const vars = extractVars(body?.text);
  const positional = vars.filter((v) => /^\d+$/.test(v)).map(Number);
  const named = vars.filter((v) => !/^\d+$/.test(v));
  if (positional.length && named.length) err("אין לשלב משתנים ממוספרים ושמיים באותה תבנית");
  if (positional.length) {
    const uniq = [...new Set(positional)].sort((a, b) => a - b);
    if (uniq.some((n, i) => n !== i + 1)) err("משתנים ממוספרים חייבים להיות רציפים ולהתחיל מ-{{1}}");
  }
  if (body?.text) {
    const t = body.text.trim();
    if (/^\{\{[^}]+\}\}/.test(t) || /\{\{[^}]+\}\}$/.test(t)) err("גוף ההודעה אינו יכול להתחיל או להסתיים במשתנה");
    const words = t.replace(VAR_RE, "").split(/\s+/).filter(Boolean).length;
    if (vars.length && words < vars.length * 2 + 1) warn("יחס גבוה של משתנים לטקסט עלול לגרום לדחייה");
  }

  if (buttons.length > TEMPLATE_LIMITS.buttonsMax) err(`עד ${TEMPLATE_LIMITS.buttonsMax} כפתורים`);
  if (buttons.filter((b) => b.type === "URL").length > TEMPLATE_LIMITS.urlButtonsMax) err(`עד ${TEMPLATE_LIMITS.urlButtonsMax} כפתורי קישור`);
  if (buttons.filter((b) => b.type === "PHONE_NUMBER").length > TEMPLATE_LIMITS.phoneButtonsMax) err("עד כפתור טלפון אחד");
  buttons.forEach((b, i) => {
    if (!b.text.trim()) err(`כפתור ${i + 1}: טקסט חסר`);
    if (b.text.length > TEMPLATE_LIMITS.buttonTextMax) err(`כפתור ${i + 1}: עד ${TEMPLATE_LIMITS.buttonTextMax} תווים`);
    if (b.type === "URL") {
      if (!/^https:\/\//.test(b.url)) err(`כפתור ${i + 1}: כתובת חייבת להתחיל ב-https://`);
      const v = extractVars(b.url);
      if (v.length > 1) err(`כפתור ${i + 1}: משתנה אחד לכל היותר`);
      if (v.length === 1 && !b.url.trim().endsWith("}}")) err(`כפתור ${i + 1}: המשתנה חייב להיות בסוף הכתובת`);
    }
  });
  // Quick replies must be grouped together (Meta requirement).
  const types = buttons.map((b) => (b.type === "QUICK_REPLY" ? "Q" : "C")).join("");
  if (/Q+C+Q+|C+Q+C+/.test(types)) err("כפתורי תגובה מהירה חייבים להיות מקובצים יחד (לפני או אחרי כפתורי הפעולה)");

  if (input.category === "MARKETING") {
    const a = analyzeTemplate(input.components);
    if (!a.hasUnsubscribeFooter && !a.hasUnsubscribeButton) {
      warn('מומלץ מאוד להוסיף אפשרות הסרה — שורת Footer ("להסרה מרשימת התפוצה, השיבו הסר") או כפתור "הסרה". חוק התקשורת מחייב אפשרות סירוב בכל הודעה פרסומית.');
    }
    if (!a.hasAdvertisingLabel) warn('לפי חוק התקשורת (סעיף 30א) הודעה פרסומית צריכה להיפתח במילה "פרסומת"');
  }
  return issues;
}

/** Renders the template text with sample/real values for the preview bubble. */
export function renderText(text: string | undefined, values: Record<string, string>): string {
  if (!text) return "";
  return text.replace(VAR_RE, (_m, v: string) => values[v] ?? `{{${v}}}`);
}
