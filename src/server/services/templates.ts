import type { Prisma } from "@/generated/prisma/client";
import type { TemplateCategory, TemplateStatus } from "@/generated/prisma/enums";
import { db } from "../db";
import { assertCan, type OrgContext } from "../context";
import { audit } from "../audit";
import { NotFoundError, UserError } from "../rbac";
import { MetaApiError, type GraphTemplate } from "../meta/client";
import { metaClientFor } from "./accounts";
import { analyzeTemplate, TEMPLATE_LIMITS, validateTemplate, type TemplateComponent } from "@/lib/templates";
import { getSettings, unsubscribeKeywords } from "./settings";

export const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  DRAFT: "טיוטה",
  PENDING: "ממתינה לאישור",
  APPROVED: "מאושרת",
  REJECTED: "נדחתה",
  PAUSED: "מושהית",
  DISABLED: "מושבתת",
  IN_APPEAL: "בערעור",
  ARCHIVED: "בארכיון",
  DELETED: "נמחקה",
  UNKNOWN: "לא ידוע",
};

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  MARKETING: "שיווק",
  UTILITY: "שירות / עדכון",
  AUTHENTICATION: "אימות",
};

export function mapMetaStatus(s: string | undefined): TemplateStatus {
  switch ((s ?? "").toUpperCase()) {
    case "APPROVED":
      return "APPROVED";
    case "PENDING":
    case "IN_REVIEW":
      return "PENDING";
    case "REJECTED":
      return "REJECTED";
    case "PAUSED":
      return "PAUSED";
    case "DISABLED":
      return "DISABLED";
    case "IN_APPEAL":
      return "IN_APPEAL";
    case "ARCHIVED":
      return "ARCHIVED";
    case "DELETED":
    case "PENDING_DELETION":
      return "DELETED";
    default:
      return "UNKNOWN";
  }
}

function mapCategory(c: string | undefined): TemplateCategory {
  const u = (c ?? "").toUpperCase();
  return u === "UTILITY" ? "UTILITY" : u === "AUTHENTICATION" ? "AUTHENTICATION" : "MARKETING";
}

function analysisFields(components: TemplateComponent[], keywords: string[]) {
  const a = analyzeTemplate(components, keywords);
  return { hasUnsubscribeFooter: a.hasUnsubscribeFooter, hasUnsubscribeButton: a.hasUnsubscribeButton, hasAdvertisingLabel: a.hasAdvertisingLabel };
}

export async function listTemplates(ctx: OrgContext, opts: { status?: TemplateStatus; accountId?: string; q?: string } = {}) {
  assertCan(ctx, "templates:read");
  return db.messageTemplate.findMany({
    where: {
      organizationId: ctx.orgId,
      status: opts.status ?? { not: "DELETED" },
      accountId: opts.accountId,
      name: opts.q ? { contains: opts.q, mode: "insensitive" } : undefined,
    },
    include: { account: { select: { name: true } } },
    orderBy: [{ updatedAt: "desc" }],
  });
}

export async function getTemplate(ctx: OrgContext, id: string) {
  assertCan(ctx, "templates:read");
  const t = await db.messageTemplate.findFirst({ where: { id, organizationId: ctx.orgId }, include: { account: true } });
  if (!t) throw new NotFoundError("התבנית לא נמצאה");
  return t;
}

/** Pulls all templates of the account from Meta and reconciles local state. */
export async function syncTemplates(ctx: OrgContext, accountId: string) {
  assertCan(ctx, "templates:write");
  const account = await db.whatsappAccount.findFirst({ where: { id: accountId, organizationId: ctx.orgId } });
  if (!account) throw new NotFoundError("החשבון לא נמצא");
  const keywords = unsubscribeKeywords(await getSettings(ctx.orgId));
  let remote: GraphTemplate[];
  try {
    remote = await metaClientFor(account).listTemplates(account.wabaId);
  } catch (err) {
    throw new UserError(err instanceof MetaApiError ? `סנכרון נכשל: ${err.message}` : "סנכרון נכשל — אין חיבור ל-Meta");
  }
  const seen = new Set<string>();
  for (const t of remote) {
    const components = (t.components ?? []) as TemplateComponent[];
    const data = {
      metaTemplateId: t.id,
      category: mapCategory(t.category),
      status: mapMetaStatus(t.status),
      rejectedReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
      qualityScore: t.quality_score?.score ?? null,
      components: components as unknown as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
      ...analysisFields(components, keywords),
    };
    const row = await db.messageTemplate.upsert({
      where: { accountId_name_language: { accountId, name: t.name, language: t.language } },
      update: data,
      create: { ...data, organizationId: ctx.orgId, accountId, name: t.name, language: t.language },
    });
    seen.add(row.id);
  }
  // Templates that disappeared from Meta (deleted there) are marked, not hard-deleted (campaign history).
  const missing = await db.messageTemplate.updateMany({
    where: { organizationId: ctx.orgId, accountId, id: { notIn: [...seen] }, status: { notIn: ["DRAFT", "DELETED"] }, metaTemplateId: { not: null } },
    data: { status: "DELETED" },
  });
  await db.whatsappAccount.update({ where: { id: accountId }, data: { lastTemplateSyncAt: new Date() } });
  await audit(ctx, "template.sync", { type: "whatsapp_account", id: accountId }, { count: remote.length, removed: missing.count });
  return { count: remote.length, removed: missing.count };
}

export type TemplateDraftInput = {
  accountId: string;
  name: string;
  language: string;
  category: TemplateCategory;
  components: TemplateComponent[];
};

export async function saveTemplateDraft(ctx: OrgContext, input: TemplateDraftInput, id?: string) {
  assertCan(ctx, "templates:write");
  const account = await db.whatsappAccount.findFirst({ where: { id: input.accountId, organizationId: ctx.orgId } });
  if (!account) throw new NotFoundError("החשבון לא נמצא");
  if (input.category === "AUTHENTICATION") throw new UserError("תבניות אימות אינן נתמכות במערכת קמפיינים");
  const keywords = unsubscribeKeywords(await getSettings(ctx.orgId));
  const data = {
    accountId: input.accountId,
    name: input.name,
    language: input.language,
    category: input.category,
    components: input.components as unknown as Prisma.InputJsonValue,
    ...analysisFields(input.components, keywords),
  };
  if (id) {
    const existing = await db.messageTemplate.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!existing) throw new NotFoundError("התבנית לא נמצאה");
    if (existing.status !== "DRAFT" && existing.status !== "REJECTED") throw new UserError("ניתן לערוך רק טיוטות או תבניות שנדחו");
    return db.messageTemplate.update({ where: { id }, data: { ...data, status: "DRAFT", rejectedReason: null } });
  }
  const dup = await db.messageTemplate.findFirst({ where: { accountId: input.accountId, name: input.name, language: input.language } });
  if (dup) throw new UserError("קיימת כבר תבנית בשם ובשפה זו");
  const created = await db.messageTemplate.create({ data: { ...data, organizationId: ctx.orgId, status: "DRAFT" } });
  await audit(ctx, "template.create", { type: "template", id: created.id }, { name: input.name });
  return created;
}

/**
 * Submits a draft to Meta for review. Media headers need a sample file, which
 * is uploaded through the Resumable Upload API to obtain a header handle.
 */
export async function submitTemplate(ctx: OrgContext, id: string, headerSample?: { bytes: ArrayBuffer; mimeType: string; fileName: string }) {
  assertCan(ctx, "templates:write");
  const t = await db.messageTemplate.findFirst({ where: { id, organizationId: ctx.orgId }, include: { account: true } });
  if (!t) throw new NotFoundError("התבנית לא נמצאה");
  if (t.status !== "DRAFT" && t.status !== "REJECTED") throw new UserError("התבנית כבר נשלחה לאישור");
  const components = structuredClone(t.components as unknown as TemplateComponent[]);
  const issues = validateTemplate({ name: t.name, category: t.category, components });
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) throw new UserError(errors.map((e) => e.message).join(" · "));

  const client = metaClientFor(t.account);
  const header = components.find((c) => c.type === "HEADER");
  if (header && header.type === "HEADER" && header.format !== "TEXT") {
    if (!headerSample) throw new UserError("כותרת מדיה מחייבת קובץ לדוגמה");
    const allowed = TEMPLATE_LIMITS.mediaTypes[header.format] ?? [];
    if (!allowed.includes(headerSample.mimeType)) throw new UserError(`סוג קובץ לא נתמך לכותרת ${header.format}`);
    if (headerSample.bytes.byteLength > (TEMPLATE_LIMITS.mediaMaxMb[header.format] ?? 5) * 1024 * 1024) throw new UserError("הקובץ גדול מדי");
    const appId = t.account.metaAppId || process.env.META_APP_ID;
    if (!appId) throw new UserError("להעלאת מדיה נדרש Meta App ID בהגדרות החשבון");
    try {
      const handle = await client.uploadTemplateMedia(appId, headerSample);
      header.example = { header_handle: [handle] };
    } catch (err) {
      throw new UserError(err instanceof MetaApiError ? `העלאת הקובץ נכשלה: ${err.message}` : "העלאת הקובץ נכשלה");
    }
  }

  try {
    const res = await client.createTemplate(t.account.wabaId, {
      name: t.name,
      language: t.language,
      category: t.category,
      components,
      ...(components.some((c) => c.type === "BODY" && /\{\{\s*[A-Za-z_]/.test(c.text)) ? { parameter_format: "named" } : {}),
    });
    await db.messageTemplate.update({
      where: { id },
      data: {
        metaTemplateId: res.id,
        status: mapMetaStatus(res.status),
        // Meta may re-categorize templates; trust its answer.
        category: mapCategory(res.category ?? t.category),
        components: components as unknown as Prisma.InputJsonValue,
        rejectedReason: null,
        lastSyncedAt: new Date(),
      },
    });
    await audit(ctx, "template.submit", { type: "template", id }, { name: t.name, metaId: res.id });
    return res;
  } catch (err) {
    if (err instanceof MetaApiError) {
      throw new UserError(`Meta דחתה את הבקשה: ${err.details || err.message}${err.code ? ` (קוד ${err.code})` : ""}`);
    }
    throw err;
  }
}

export async function deleteTemplate(ctx: OrgContext, id: string) {
  assertCan(ctx, "templates:write");
  const t = await db.messageTemplate.findFirst({ where: { id, organizationId: ctx.orgId }, include: { account: true } });
  if (!t) throw new NotFoundError("התבנית לא נמצאה");
  const inUse = await db.campaign.count({ where: { templateId: id, status: { in: ["RUNNING", "SCHEDULED", "QUEUED", "PAUSED"] } } });
  if (inUse) throw new UserError("התבנית בשימוש בקמפיין פעיל");
  if (t.metaTemplateId) {
    try {
      await metaClientFor(t.account).deleteTemplate(t.account.wabaId, t.name, t.metaTemplateId);
    } catch (err) {
      throw new UserError(err instanceof MetaApiError ? `מחיקה ב-Meta נכשלה: ${err.message}` : "מחיקה נכשלה");
    }
    await db.messageTemplate.update({ where: { id }, data: { status: "DELETED" } });
  } else {
    const used = await db.campaign.count({ where: { templateId: id } });
    if (used) await db.messageTemplate.update({ where: { id }, data: { status: "DELETED" } });
    else await db.messageTemplate.delete({ where: { id } });
  }
  await audit(ctx, "template.delete", { type: "template", id }, { name: t.name });
}

/** Called from webhook processing (message_template_status_update). */
export async function applyTemplateStatusWebhook(
  accountId: string,
  value: { message_template_id?: number | string; message_template_name?: string; message_template_language?: string; event?: string; reason?: string },
) {
  const where: Prisma.MessageTemplateWhereInput = value.message_template_id
    ? { accountId, metaTemplateId: String(value.message_template_id) }
    : { accountId, name: value.message_template_name, language: value.message_template_language };
  await db.messageTemplate.updateMany({
    where,
    data: {
      status: mapMetaStatus(value.event),
      rejectedReason: value.reason && value.reason !== "NONE" ? value.reason : null,
      lastSyncedAt: new Date(),
    },
  });
}
