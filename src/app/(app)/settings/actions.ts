"use server";

import { z } from "zod";
import { defineAction } from "@/server/auth/action";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { getSettings } from "@/server/services/settings";
import { confirmRequiredCompliance, recordComplianceReview } from "@/server/services/compliance";
import { addMember, removeMember, updateMemberRole, updateOrganization } from "@/server/services/organizations";
import { ForbiddenError, UserError } from "@/server/rbac";
import { normalizePhone } from "@/lib/phone";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const optionalUrl = z.union([z.literal(""), z.string().url()]).optional();

export const saveBusinessAction = defineAction(
  "settings:write",
  z.object({
    orgName: z.string().trim().min(1).max(150),
    industry: z.string().max(50).nullable(),
    displayName: z.string().max(150).optional(),
    legalName: z.string().max(200).optional(),
    businessIdNumber: z.string().max(30).optional(),
    contactPhone: z.string().max(30).optional(),
    contactEmail: z.union([z.literal(""), z.string().email()]).optional(),
    websiteUrl: optionalUrl,
    privacyPolicyUrl: optionalUrl,
    logoUrl: optionalUrl,
    timezone: z.string().max(60),
    defaultWhatsappAccountId: z.string().nullable().optional(),
  }),
  async (ctx, input) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone });
    } catch {
      throw new UserError("אזור זמן לא תקין");
    }
    if (input.defaultWhatsappAccountId && !(await db.whatsappAccount.findFirst({ where: { id: input.defaultWhatsappAccountId, organizationId: ctx.orgId } }))) throw new UserError("חשבון לא נמצא");
    await getSettings(ctx.orgId);
    await updateOrganization(ctx, { name: input.orgName, industry: input.industry });
    const { orgName: _o, industry: _i, ...rest } = input;
    await db.businessSettings.update({
      where: { organizationId: ctx.orgId },
      data: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v === "" ? null : v])),
    });
    await audit(ctx, "settings.update", { type: "settings", id: "business" });
  },
);

export const saveSendingAction = defineAction(
  "settings:write",
  z.object({
    sendingWindow: z.partialRecord(z.enum(["0", "1", "2", "3", "4", "5", "6"]), z.tuple([hhmm, hhmm])),
    safetyRollingCap: z.number().int().min(1).max(1_000_000),
    defaultMessagesPerSecond: z.number().int().min(1).max(80),
    testRecipients: z.array(z.string()).max(10),
    allowedRedirectDomains: z.array(z.string().regex(/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/i, "דומיין לא תקין")).max(50),
    perContactClickTracking: z.boolean(),
  }),
  async (ctx, input) => {
    const settings = await getSettings(ctx.orgId);
    for (const [day, [from, to]] of Object.entries(input.sendingWindow)) if (from >= to) throw new UserError(`שעות שליחה לא תקינות ביום ${day}`);
    const tests: string[] = [];
    for (const p of input.testRecipients.filter((x) => x.trim())) {
      const n = normalizePhone(p, settings.defaultCountry);
      if (!n.ok) throw new UserError(`מספר בדיקה לא תקין: ${p}`);
      tests.push(n.e164);
    }
    await db.businessSettings.update({ where: { organizationId: ctx.orgId }, data: { ...input, testRecipients: [...new Set(tests)], allowedRedirectDomains: input.allowedRedirectDomains.map((d) => d.toLowerCase()) } });
    await audit(ctx, "settings.update", { type: "settings", id: "sending" }, { safetyRollingCap: input.safetyRollingCap });
  },
);

export const saveUnsubscribeAction = defineAction(
  "settings:write",
  z.object({
    unsubscribeFooterText: z.string().trim().min(5).max(60),
    unsubscribeKeywords: z.array(z.string().trim().min(1).max(40)).min(1, "חובה להגדיר לפחות מילת הסרה אחת").max(50),
    sendUnsubscribeConfirmation: z.boolean(),
    unsubscribeConfirmationText: z.string().trim().min(5).max(500),
    requireAdvertisingLabel: z.boolean(),
    labelChangeReason: z.string().max(500).optional(),
  }),
  async (ctx, input) => {
    const settings = await getSettings(ctx.orgId);
    if (input.requireAdvertisingLabel !== settings.requireAdvertisingLabel) {
      if (!ctx.can("org:owner")) throw new ForbiddenError("רק בעלים יכולים לשנות את דרישת המילה 'פרסומת'");
      if (!input.requireAdvertisingLabel && (input.labelChangeReason ?? "").trim().length < 20) throw new UserError("יש לתעד נימוק לביטול הדרישה (לפחות 20 תווים)");
    }
    const { labelChangeReason, ...data } = input;
    await db.businessSettings.update({ where: { organizationId: ctx.orgId }, data });
    await audit(ctx, "settings.update", { type: "settings", id: "unsubscribe" }, { keywords: input.unsubscribeKeywords.length, requireAdvertisingLabel: input.requireAdvertisingLabel, labelChangeReason });
  },
);

export const saveCostsAction = defineAction(
  "settings:write",
  z.object({ costCurrency: z.string().length(3), marketing: z.number().min(0).max(10).nullable(), utility: z.number().min(0).max(10).nullable() }),
  async (ctx, input) => {
    await getSettings(ctx.orgId);
    const rates: Record<string, number> = {};
    if (input.marketing !== null) rates.MARKETING = input.marketing;
    if (input.utility !== null) rates.UTILITY = input.utility;
    await db.businessSettings.update({ where: { organizationId: ctx.orgId }, data: { costCurrency: input.costCurrency.toUpperCase(), costRates: rates } });
    await audit(ctx, "settings.update", { type: "settings", id: "costs" }, rates);
  },
);

export const saveRetentionAction = defineAction(
  "settings:write",
  z.object({
    retentionInboundDays: z.number().int().min(30).max(3650),
    retentionClicksDays: z.number().int().min(30).max(3650),
    retentionWebhookRawDays: z.number().int().min(7).max(365),
    retentionAuditDays: z.number().int().min(365).max(3650),
  }),
  async (ctx, input) => {
    await getSettings(ctx.orgId);
    await db.businessSettings.update({ where: { organizationId: ctx.orgId }, data: input });
    await audit(ctx, "settings.update", { type: "settings", id: "retention" }, input);
  },
);

export const saveAlertsAction = defineAction(
  "settings:write",
  z.object({ alertEmails: z.array(z.string().email()).max(10), alertOnQualityDrop: z.boolean(), alertOnSendErrors: z.boolean() }),
  async (ctx, input) => {
    await getSettings(ctx.orgId);
    await db.businessSettings.update({ where: { organizationId: ctx.orgId }, data: input });
    await audit(ctx, "settings.update", { type: "settings", id: "alerts" });
  },
);

export const complianceReviewAction = defineAction(
  "compliance:write",
  z.object({ ruleCode: z.string(), passed: z.boolean(), evidence: z.string().max(5000), reviewerName: z.string().max(150) }),
  async (ctx, input) => recordComplianceReview(ctx, input),
);

export const addMemberAction = defineAction(
  "users:manage",
  z.object({ email: z.string().email(), name: z.string().trim().min(1).max(100), role: z.enum(["OWNER", "ADMIN", "CAMPAIGN_MANAGER", "VIEWER"]), password: z.string().max(200) }),
  async (ctx, input) => {
    await addMember(ctx, input);
  },
);
export const updateRoleAction = defineAction("users:manage", z.object({ userId: z.string(), role: z.enum(["OWNER", "ADMIN", "CAMPAIGN_MANAGER", "VIEWER"]) }), async (ctx, input) => updateMemberRole(ctx, input.userId, input.role));
export const removeMemberAction = defineAction("users:manage", z.object({ userId: z.string() }), async (ctx, input) => {
  if (input.userId === ctx.user.id) throw new UserError("לא ניתן להסיר את עצמך");
  await removeMember(ctx, input.userId);
});

export const confirmComplianceAction = defineAction("compliance:write", z.object({ notes: z.string().max(2000).optional() }), async (ctx, input) => confirmRequiredCompliance(ctx, input.notes));
