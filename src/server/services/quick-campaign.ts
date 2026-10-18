import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { assertCan, type OrgContext } from "../context";
import { NotFoundError, UserError } from "../rbac";
import { templateSlots, mediaHeaderFormat, TEMPLATE_LIMITS, type TemplateComponent, type VariableSlot } from "@/lib/templates";
import { metaClientFor } from "./accounts";
import { MetaApiError } from "../meta/client";
import type { VariableMapping } from "../sending/payload";
import { createCampaign, evaluateCampaign, launchCampaign, type CampaignLike, type Preflight } from "./campaigns";
import { createTrackedLink, validateDestination } from "./links";
import { getSettings } from "./settings";
import { contactFilterSchema, type ContactFilter } from "./contact-filter";

/**
 * One-step campaign: sender number + approved template + audience + quantity.
 * Variables, tracking link and technical checks are handled automatically;
 * only inputs the template genuinely needs are requested.
 */
export const quickCampaignSchema = z.object({
  phoneNumberId: z.string().min(1, "יש לבחור מספר שולח"),
  templateId: z.string().min(1, "יש לבחור תבנית"),
  /** all = every contact; group = one audience; conditions = rule-based filter; contacts = hand-picked. */
  audienceMode: z.enum(["all", "group", "conditions", "contacts"]).default("all"),
  audienceId: z.string().nullable().optional(),
  conditions: contactFilterSchema.pick({ tagIds: true, tagMode: true, excludeTagIds: true, sources: true, activity: true, notSentForDays: true, excludeCampaignIds: true, createdFrom: true }).optional(),
  contactIds: z.array(z.string()).max(5000).optional(),
  maxRecipients: z.number().int().min(1).max(1_000_000).nullable().optional(),
  variables: z.record(z.string(), z.string().max(1000)).optional(),
  linkUrl: z.string().max(2000).nullable().optional(),
  headerMediaUrl: z.string().max(2000).nullable().optional(),
  name: z.string().max(150).optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  respectSendingWindow: z.boolean().optional(),
  /** Explicit confirmation of the "no opt-out line in template" warning. */
  acknowledgeNoOptOut: z.boolean().optional(),
});
export type QuickCampaignInput = z.input<typeof quickCampaignSchema>;
type Parsed = z.infer<typeof quickCampaignSchema>;

/** What the template needs from the user beyond the automatic defaults. */
export type QuickNeeds = {
  textSlots: { key: string; label: string }[];
  needsLink: boolean;
  needsMedia: string | null;
  autoSlots: { key: string; label: string; source: string }[];
};

function isNameSlot(s: VariableSlot) {
  return s.component === "body" && (s.name === "1" || /name|שם/i.test(s.name));
}

export function quickNeeds(components: TemplateComponent[]): QuickNeeds {
  const slots = templateSlots(components);
  const firstName = slots.find(isNameSlot);
  return {
    autoSlots: firstName ? [{ key: firstName.key, label: firstName.label, source: "שם פרטי של איש הקשר (או ״לקוח/ה״ כשאין שם)" }] : [],
    textSlots: slots.filter((s) => s.component !== "button" && s !== firstName).map((s) => ({ key: s.key, label: s.label })),
    needsLink: slots.some((s) => s.component === "button"),
    needsMedia: mediaHeaderFormat(components),
  };
}

function buildMapping(components: TemplateComponent[], input: Parsed): VariableMapping {
  const mapping: VariableMapping = {};
  const needs = quickNeeds(components);
  for (const a of needs.autoSlots) {
    const override = input.variables?.[a.key]?.trim();
    mapping[a.key] = override ? { type: "static", value: override } : { type: "contact_field", field: "first_name", fallback: "לקוח/ה" };
  }
  for (const t of needs.textSlots) {
    const v = input.variables?.[t.key]?.trim();
    if (v) mapping[t.key] = { type: "static", value: v };
  }
  for (const s of templateSlots(components).filter((x) => x.component === "button")) mapping[s.key] = { type: "tracked_link" };
  return mapping;
}

async function load(ctx: OrgContext, input: Parsed) {
  const phone = await db.whatsappPhoneNumber.findFirst({ where: { id: input.phoneNumberId, organizationId: ctx.orgId }, include: { account: true } });
  if (!phone) throw new NotFoundError("מספר השולח לא נמצא");
  const template = await db.messageTemplate.findFirst({ where: { id: input.templateId, organizationId: ctx.orgId } });
  if (!template) throw new NotFoundError("התבנית לא נמצאה");
  if (template.accountId !== phone.accountId) throw new UserError("התבנית שייכת לחשבון WhatsApp אחר");
  if (input.audienceId && !(await db.audience.findFirst({ where: { id: input.audienceId, organizationId: ctx.orgId } }))) throw new NotFoundError("הקבוצה לא נמצאה");
  return { phone, template };
}

function filterOf(input: Parsed): ContactFilter {
  switch (input.audienceMode) {
    case "group":
      if (!input.audienceId) throw new UserError("יש לבחור קבוצה");
      return { audienceIds: [input.audienceId] };
    case "conditions":
      return { ...(input.conditions ?? {}) };
    case "contacts":
      if (!input.contactIds?.length) throw new UserError("יש לבחור לפחות איש קשר אחד");
      return { contactIds: input.contactIds };
    default:
      return {};
  }
}

/** Live preview without writing anything: eligibility, cost, and any issue that needs attention. */
export async function previewQuickCampaign(ctx: OrgContext, raw: QuickCampaignInput): Promise<Preflight & { needs: QuickNeeds }> {
  assertCan(ctx, "campaigns:read");
  const input = quickCampaignSchema.parse(raw);
  const { phone, template } = await load(ctx, input);
  const components = template.components as unknown as TemplateComponent[];
  const needs = quickNeeds(components);
  const fake: CampaignLike = {
    id: "preview",
    organizationId: ctx.orgId,
    name: input.name || template.name,
    description: null,
    tags: [],
    accountId: phone.accountId,
    phoneNumberId: phone.id,
    templateId: template.id,
    audienceFilter: filterOf(input) as Prisma.JsonValue,
    variableMapping: buildMapping(components, input) as unknown as Prisma.JsonValue,
    headerMediaUrl: input.headerMediaUrl || null,
    trackedLinkId: needs.needsLink && input.linkUrl ? "pending" : null,
    status: "DRAFT",
    scheduledAt: input.scheduledAt ?? null,
    maxRecipients: input.maxRecipients ?? null,
    messagesPerSecond: null,
    respectSendingWindow: input.respectSendingWindow ?? true,
    estimatedCost: null,
    costCurrency: null,
    eligibleCount: 0,
    excludedCount: 0,
    launchedAt: null,
    launchedById: null,
    startedAt: null,
    completedAt: null,
    pausedReason: null,
    failureReason: null,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    template,
    phoneNumber: phone,
    account: { id: phone.account.id, name: phone.account.name, status: phone.account.status },
  };
  const pf = await evaluateCampaign(ctx, fake);
  // Translate generic template-variable failures into the specific missing input.
  const items = pf.items.map((i) => {
    if (i.key === "variables" && !i.ok) return { ...i, label: "יש למלא את ערכי ההודעה החסרים" };
    if (i.key === "link" && !i.ok) return { ...i, label: "יש להזין כתובת לכפתור הקישור" };
    if (i.key === "media" && !i.ok) return { ...i, label: "יש להזין כתובת קובץ לכותרת ההודעה" };
    return i;
  });
  return { ...pf, items, needs };
}

/** Creates and launches in one step. A failed launch leaves no draft behind. */
export async function quickSendCampaign(ctx: OrgContext, raw: QuickCampaignInput) {
  assertCan(ctx, "campaigns:launch");
  const input = quickCampaignSchema.parse(raw);
  const { phone, template } = await load(ctx, input);
  const components = template.components as unknown as TemplateComponent[];
  const needs = quickNeeds(components);
  const settings = await getSettings(ctx.orgId);
  if (needs.needsLink) {
    if (!input.linkUrl) throw new UserError("יש להזין כתובת לכפתור הקישור");
    validateDestination(input.linkUrl, settings.allowedRedirectDomains);
  }
  const date = new Intl.DateTimeFormat("he-IL", { timeZone: settings.timezone, dateStyle: "short", timeStyle: "short" }).format(new Date());
  const campaign = await createCampaign(ctx, {
    name: input.name?.trim() || `${template.name} · ${date}`,
    accountId: phone.accountId,
    phoneNumberId: phone.id,
    templateId: template.id,
    audienceFilter: filterOf(input),
    variableMapping: buildMapping(components, input),
    headerMediaUrl: input.headerMediaUrl || null,
    maxRecipients: input.maxRecipients ?? null,
    scheduledAt: input.scheduledAt ?? null,
    respectSendingWindow: input.respectSendingWindow ?? true,
  });
  try {
    if (needs.needsLink && input.linkUrl) {
      const link = await createTrackedLink(ctx, { name: "קישור", destinationUrl: input.linkUrl, campaignId: campaign.id });
      await db.campaign.update({ where: { id: campaign.id }, data: { trackedLinkId: link.id } });
    }
    const res = await launchCampaign(ctx, campaign.id, { acknowledgeNoOptOut: input.acknowledgeNoOptOut });
    return { campaignId: campaign.id, ...res };
  } catch (err) {
    await db.trackedLink.deleteMany({ where: { campaignId: campaign.id } });
    await db.campaign.deleteMany({ where: { id: campaign.id, status: "DRAFT" } });
    throw err;
  }
}

/** Uploads the header image/video/document to Meta for this send; returns a "media:<id>" reference. */
export async function uploadHeaderMedia(ctx: OrgContext, input: { phoneNumberId: string; format: string; file: { bytes: ArrayBuffer; mimeType: string; fileName: string } }) {
  assertCan(ctx, "campaigns:write");
  const phone = await db.whatsappPhoneNumber.findFirst({ where: { id: input.phoneNumberId, organizationId: ctx.orgId }, include: { account: true } });
  if (!phone) throw new NotFoundError("מספר השולח לא נמצא");
  const allowed = TEMPLATE_LIMITS.mediaTypes[input.format] ?? [];
  if (!allowed.includes(input.file.mimeType)) throw new UserError(`סוג קובץ לא נתמך. מותר: ${allowed.join(", ")}`);
  const maxMb = TEMPLATE_LIMITS.mediaMaxMb[input.format] ?? 5;
  if (input.file.bytes.byteLength > maxMb * 1024 * 1024) throw new UserError(`הקובץ גדול מ-${maxMb}MB`);
  try {
    const id = await metaClientFor(phone.account).uploadMessageMedia(phone.phoneNumberId, input.file);
    return `media:${id}`;
  } catch (err) {
    throw new UserError(err instanceof MetaApiError ? `העלאה ל-Meta נכשלה: ${err.message}` : "העלאה נכשלה");
  }
}
