import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "./db";
import type { OrgContext } from "./context";

export async function audit(
  ctx: OrgContext,
  action: string,
  entity: { type?: string; id?: string | null } = {},
  metadata: Record<string, unknown> = {},
  tx?: Tx,
) {
  const client = tx ?? db;
  await client.auditLog.create({
    data: {
      organizationId: ctx.orgId,
      actorType: ctx.actor.type,
      actorUserId: ctx.actor.type === "user" ? ctx.actor.userId : null,
      actorApiKeyId: ctx.actor.type === "api_key" ? ctx.actor.apiKeyId : null,
      action,
      entityType: entity.type ?? null,
      entityId: entity.id ?? null,
      metadata: metadata as Prisma.InputJsonValue,
      ip: ctx.ip ?? null,
    },
  });
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "auth.login": "התחברות",
  "auth.login_failed": "ניסיון התחברות כושל",
  "auth.logout": "התנתקות",
  "contact.create": "יצירת איש קשר",
  "contact.update": "עדכון איש קשר",
  "contact.delete": "מחיקת איש קשר",
  "contact.export": "ייצוא אנשי קשר",
  "contact.import": "ייבוא אנשי קשר",
  "consent.grant": "תיעוד הסכמה",
  "consent.revoke": "ביטול הסכמה",
  "suppression.add": "הוספה לרשימת הסרה",
  "suppression.lift": "חידוש הרשמה (הסכמה חדשה)",
  "campaign.create": "יצירת קמפיין",
  "campaign.update": "עדכון קמפיין",
  "campaign.launch": "הפעלת קמפיין",
  "campaign.pause": "השהיית קמפיין",
  "campaign.resume": "חידוש קמפיין",
  "campaign.cancel": "ביטול קמפיין",
  "campaign.auto_pause": "השהיה אוטומטית של קמפיין",
  "campaign.requeue_uncertain": "שליחה חוזרת להודעות לא ודאיות",
  "template.create": "יצירת תבנית",
  "template.submit": "שליחת תבנית לאישור",
  "template.delete": "מחיקת תבנית",
  "template.sync": "סנכרון תבניות",
  "template.test_send": "שליחת בדיקה",
  "account.create": "חיבור חשבון WhatsApp",
  "account.update": "עדכון חשבון WhatsApp",
  "account.delete": "ניתוק חשבון WhatsApp",
  "account.health_check": "בדיקת תקינות חשבון",
  "account.quality_alert": "התראת איכות חשבון",
  "settings.update": "עדכון הגדרות",
  "compliance.review": "עדכון בדיקת תאימות",
  "member.invite": "הזמנת משתמש",
  "member.update": "עדכון הרשאות משתמש",
  "member.remove": "הסרת משתמש",
  "apikey.create": "יצירת מפתח API",
  "apikey.revoke": "ביטול מפתח API",
  "webhook.create": "יצירת Webhook יוצא",
  "webhook.delete": "מחיקת Webhook יוצא",
  "automation.create": "יצירת כלל אוטומציה",
  "automation.update": "עדכון כלל אוטומציה",
  "automation.delete": "מחיקת כלל אוטומציה",
  "retention.purge": "מחיקת מידע לפי מדיניות שמירה",
};
