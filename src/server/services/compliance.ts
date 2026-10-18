import type { BusinessSettings, ComplianceCheck } from "@/generated/prisma/client";
import { db } from "../db";
import { actorUserId, assertCan, type OrgContext } from "../context";
import { audit } from "../audit";
import { UserError } from "../rbac";
import { getSettings } from "./settings";

export const FINANCIAL_INDUSTRY = "FINANCIAL_SERVICES";

type RuleKind = "auto" | "attestation";

export type ComplianceRule = {
  code: string;
  title: string;
  kind: RuleKind;
  /** Why the rule exists — shown to the reviewer. */
  basis: string;
  /** What the reviewer must confirm / document. */
  requirement: string;
  /** Required rules block campaign sending until done (once). Others are reminders only. */
  required: boolean;
  minEvidenceLength?: number;
  /** Suggested re-review interval — shown as a reminder, never blocks sending. */
  validityDays?: number;
  appliesTo?: (industry: string | null) => boolean;
  autoCheck?: (s: BusinessSettings) => { ok: boolean; detail: string };
};

const isUrl = (v: string | null | undefined) => {
  try {
    return !!v && ["http:", "https:"].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

/**
 * Documented compliance rules. Each rule cites its basis; this is an
 * operational control, not legal advice — the business remains responsible
 * for legal review of its content and practices.
 */
export const COMPLIANCE_RULES: ComplianceRule[] = [
  {
    code: "BUSINESS_IDENTITY",
    title: "זיהוי המפרסם",
    kind: "auto",
    required: false,
    basis: "חוק התקשורת (בזק ושידורים) סעיף 30א מחייב לכלול בהודעה פרסומית את שם המפרסם ודרכי יצירת קשר עמו. מדיניות WhatsApp מחייבת זהות עסקית ברורה.",
    requirement: "שם עסק לתצוגה, שם משפטי ופרטי קשר (טלפון או דוא״ל) מוגדרים בהגדרות.",
    autoCheck: (s) => {
      const missing = [!s.displayName && "שם לתצוגה", !s.legalName && "שם משפטי", !s.contactPhone && !s.contactEmail && "טלפון/דוא״ל"].filter(Boolean);
      return { ok: missing.length === 0, detail: missing.length ? `חסר: ${missing.join(", ")}` : "הוגדר" };
    },
  },
  {
    code: "PRIVACY_POLICY",
    title: "מדיניות פרטיות",
    kind: "auto",
    required: false,
    basis: "חוק הגנת הפרטיות ותקנות אבטחת מידע; מדיניות WhatsApp Business מחייבת מדיניות פרטיות זמינה ללקוחות.",
    requirement: "כתובת מדיניות פרטיות פומבית מוגדרת בהגדרות העסק.",
    autoCheck: (s) => ({ ok: isUrl(s.privacyPolicyUrl), detail: isUrl(s.privacyPolicyUrl) ? s.privacyPolicyUrl! : "לא הוגדרה כתובת תקינה" }),
  },
  {
    code: "UNSUBSCRIBE_MECHANISM",
    title: "מנגנון הסרה פעיל",
    kind: "auto",
    required: true,
    basis: "סעיף 30א מחייב אפשרות סירוב בכל הודעה פרסומית ומימוש מיידי שלה; מדיניות WhatsApp מחייבת לכבד בקשות opt-out.",
    requirement: "טקסט הסרה ומילות הסרה מוגדרים (המערכת אוכפת הסרה אוטומטית).",
    autoCheck: (s) => {
      const ok = s.unsubscribeFooterText.trim().length > 0 && s.unsubscribeKeywords.length > 0;
      return { ok, detail: ok ? `${s.unsubscribeKeywords.length} מילות הסרה` : "חסרות מילות הסרה או טקסט הסרה" };
    },
  },
  {
    code: "CONSENT_PROCESS",
    title: "מקורות ההסכמה של העסק",
    kind: "attestation",
    required: true,
    basis:
      "מדיניות WhatsApp: פנייה רק למי שמסר את מספרו ונתן הרשאה לקבל הודעות מהעסק; העסק קובע את שיטת קבלת ההרשאה (היא אינה חייבת להיות ייעודית ל-WhatsApp). סעיף 30א: הסכמה מראש לדבר פרסומת, או חריג הלקוח הקיים (30א(ג)).",
    requirement: "אישור חד-פעמי שאנשי הקשר שמסומנים כ״יש הסכמה״ נאספו באחד המקורות המתועדים (טופס, לקוחות קיימים, טופס חתום, שיחה מוקלטת, פנייה יזומה). הערות — לא חובה.",
    minEvidenceLength: 0,
    validityDays: 365,
  },
  {
    code: "META_POLICY_REVIEW",
    title: "מדיניות WhatsApp Business ו-Commerce Policy",
    kind: "attestation",
    required: true,
    basis: "WhatsApp Business Messaging Policy ו-WhatsApp Commerce Policy חלות על כל שימוש. אישור תבנית ע״י Meta אינו מהווה אישור שהמוצר או ההצעה מותרים.",
    requirement: "אישור חד-פעמי שהמוצרים והתכנים עומדים במדיניות. מומלץ לחזור על הסקירה פעם בשנה (תזכורת בלבד).",
    minEvidenceLength: 0,
    validityDays: 365,
  },
  {
    code: "FINANCIAL_SERVICES_REVIEW",
    title: "שירותים פיננסיים והלוואות",
    kind: "attestation",
    required: true,
    basis:
      "WhatsApp Commerce Policy אוסרת מודלים עסקיים כגון הלוואות ליום המשכורת (payday loans), מקדמות על משכורת, הלוואות עמית לעמית (P2P lending), גביית חובות וערבויות שחרור — ללא קשר לרישיונות מקומיים. בישראל חלים בנוסף חוק אשראי הוגן (לרבות דרישות גילוי ואזהרה בפרסומי אשראי) וחוק הפיקוח על שירותים פיננסיים מוסדרים (רישוי נותני אשראי ומתווכי אשראי).",
    requirement:
      "אישור חד-פעמי שהמוצרים אינם בקטגוריות האסורות ושהעסק מחזיק ברישיון הנדרש. מומלץ לציין סוג ומספר רישיון בהערות. תזכורת לסקירה חוזרת כל 6 חודשים (לא חוסמת).",
    minEvidenceLength: 0,
    validityDays: 183,
    appliesTo: (industry) => industry === FINANCIAL_INDUSTRY,
  },
];

export type RuleState = {
  rule: ComplianceRule;
  status: "PASSED" | "FAILED" | "NOT_STARTED" | "EXPIRED";
  detail: string;
  check?: ComplianceCheck;
  reminder?: boolean;
};

export async function evaluateCompliance(orgId: string): Promise<{ ok: boolean; rules: RuleState[] }> {
  const [org, settings, checks] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: orgId } }),
    getSettings(orgId),
    db.complianceCheck.findMany({ where: { organizationId: orgId } }),
  ]);
  const byCode = new Map(checks.map((c) => [c.ruleCode, c]));
  const rules: RuleState[] = [];
  for (const rule of COMPLIANCE_RULES) {
    if (rule.appliesTo && !rule.appliesTo(org.industry)) continue;
    if (rule.kind === "auto") {
      const r = rule.autoCheck!(settings);
      rules.push({ rule, status: r.ok ? "PASSED" : "FAILED", detail: r.detail });
      continue;
    }
    const check = byCode.get(rule.code);
    if (!check || check.status === "NOT_STARTED") rules.push({ rule, status: "NOT_STARTED", detail: "טרם בוצעה סקירה", check });
    else if (check.status === "PASSED" && check.expiresAt && check.expiresAt < new Date())
      rules.push({ rule, status: "PASSED", detail: `אושר — מומלץ לסקור שוב (מאז ${check.expiresAt.toLocaleDateString("he-IL")})`, check, reminder: true });
    else
      rules.push({
        rule,
        status: check.status === "PASSED" ? "PASSED" : "FAILED",
        detail: check.status === "PASSED" ? `נסקר ע״י ${check.reviewerName ?? ""}` : "נמצאה אי-התאמה",
        check,
      });
  }
  // Only required rules block sending; reminders never do.
  return { ok: rules.filter((r) => r.rule.required).every((r) => r.status === "PASSED"), rules };
}

export async function recordComplianceReview(
  ctx: OrgContext,
  input: { ruleCode: string; passed: boolean; evidence: string; reviewerName: string },
) {
  assertCan(ctx, "compliance:write");
  const rule = COMPLIANCE_RULES.find((r) => r.code === input.ruleCode && r.kind === "attestation");
  if (!rule) throw new UserError("כלל לא מוכר");
  if (input.passed && input.evidence.trim().length < (rule.minEvidenceLength ?? 0)) {
    throw new UserError(`יש לתעד את הבדיקה בפירוט (לפחות ${rule.minEvidenceLength} תווים)`);
  }
  const reviewerName = input.reviewerName.trim() || (ctx.actor.type === "user" ? ctx.actor.name : "system");
  const now = new Date();
  const data = {
    status: input.passed ? ("PASSED" as const) : ("FAILED" as const),
    evidence: input.evidence.trim(),
    reviewerName,
    reviewedById: actorUserId(ctx),
    reviewedAt: now,
    expiresAt: input.passed && rule.validityDays ? new Date(now.getTime() + rule.validityDays * 86400_000) : null,
  };
  await db.complianceCheck.upsert({
    where: { organizationId_ruleCode: { organizationId: ctx.orgId, ruleCode: rule.code } },
    update: data,
    create: { ...data, organizationId: ctx.orgId, ruleCode: rule.code },
  });
  await audit(ctx, "compliance.review", { type: "compliance_rule", id: rule.code }, { passed: input.passed, reviewer: data.reviewerName });
}

/** One-time setup: confirms every required review rule that applies to the business in one step. */
export async function confirmRequiredCompliance(ctx: OrgContext, notes?: string) {
  assertCan(ctx, "compliance:write");
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const rules = COMPLIANCE_RULES.filter((r) => r.kind === "attestation" && r.required && (!r.appliesTo || r.appliesTo(org.industry)));
  for (const r of rules) {
    await recordComplianceReview(ctx, { ruleCode: r.code, passed: true, evidence: notes?.trim() || "אושר בהגדרת התאימות החד-פעמית", reviewerName: "" });
  }
  return rules.length;
}
