"use server";

import { z } from "zod";
import { defineAction } from "@/server/auth/action";
import {
  cancelCampaign,
  createCampaign,
  launchCampaign,
  pauseCampaign,
  preflight,
  previewAudience,
  requeueUncertain,
  resumeCampaign,
  sendTestMessage,
  updateCampaignDraft,
} from "@/server/services/campaigns";
import { createTrackedLink } from "@/server/services/links";
import { contactFilterSchema } from "@/server/services/contact-filter";
import { variableMappingSchema } from "@/server/sending/payload";
import { db } from "@/server/db";
import { listContacts } from "@/server/services/contacts";
import { eligibilityOf } from "@/lib/consent";
import { previewQuickCampaign, quickCampaignSchema, quickSendCampaign, uploadHeaderMedia } from "@/server/services/quick-campaign";

const draftSchema = z.object({
  name: z.string().trim().min(1, "שם קמפיין חסר").max(150),
  description: z.string().max(1000).nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  accountId: z.string().nullable().optional(),
  phoneNumberId: z.string().nullable().optional(),
  templateId: z.string().nullable().optional(),
  audienceFilter: contactFilterSchema.optional(),
  variableMapping: variableMappingSchema.optional(),
  headerMediaUrl: z.string().url("כתובת לא תקינה").startsWith("https://", "נדרשת כתובת https").nullable().optional().or(z.literal("")),
  trackedLinkId: z.string().nullable().optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  maxRecipients: z.number().int().min(1).max(1_000_000).nullable().optional(),
  messagesPerSecond: z.number().int().min(1).max(80).nullable().optional(),
  respectSendingWindow: z.boolean().optional(),
});

export const createCampaignAction = defineAction("campaigns:write", draftSchema, async (ctx, input) => (await createCampaign(ctx, { ...input, headerMediaUrl: input.headerMediaUrl || null })).id);

export const updateCampaignAction = defineAction("campaigns:write", draftSchema.partial().extend({ id: z.string() }), async (ctx, { id, ...input }) => {
  await updateCampaignDraft(ctx, id, { ...input, ...(input.headerMediaUrl !== undefined ? { headerMediaUrl: input.headerMediaUrl || null } : {}) });
});

export const previewAudienceAction = defineAction("campaigns:read", z.object({ id: z.string() }), async (ctx, input) => previewAudience(ctx, input.id));

export const preflightAction = defineAction("campaigns:read", z.object({ id: z.string() }), async (ctx, input) => preflight(ctx, input.id));

export const launchCampaignAction = defineAction(
  "campaigns:launch",
  z.object({ id: z.string(), confirmedEligibleCount: z.number().int().min(0).optional(), acknowledgeNoOptOut: z.boolean().optional() }),
  async (ctx, input) => launchCampaign(ctx, input.id, { confirmedEligibleCount: input.confirmedEligibleCount, acknowledgeNoOptOut: input.acknowledgeNoOptOut }),
);

export const pauseCampaignAction = defineAction("campaigns:launch", z.object({ id: z.string() }), async (ctx, input) => pauseCampaign(ctx, input.id));
export const resumeCampaignAction = defineAction("campaigns:launch", z.object({ id: z.string() }), async (ctx, input) => resumeCampaign(ctx, input.id));
export const cancelCampaignAction = defineAction("campaigns:launch", z.object({ id: z.string() }), async (ctx, input) => cancelCampaign(ctx, input.id));
export const requeueUncertainAction = defineAction("campaigns:launch", z.object({ id: z.string() }), async (ctx, input) => requeueUncertain(ctx, input.id));

export const testCampaignAction = defineAction("campaigns:write", z.object({ id: z.string(), phone: z.string().min(3).max(40) }), async (ctx, input) => sendTestMessage(ctx, { campaignId: input.id, phone: input.phone }));

export const createLinkAction = defineAction(
  "campaigns:write",
  z.object({ campaignId: z.string(), name: z.string().trim().min(1).max(100), destinationUrl: z.string().trim().min(8).max(2000) }),
  async (ctx, input) => {
    const link = await createTrackedLink(ctx, input);
    await db.campaign.updateMany({ where: { id: input.campaignId, organizationId: ctx.orgId, status: "DRAFT" }, data: { trackedLinkId: link.id } });
    return { id: link.id, token: link.token };
  },
);

export const duplicateCampaignAction = defineAction("campaigns:write", z.object({ id: z.string() }), async (ctx, input) => {
  const c = await db.campaign.findFirst({ where: { id: input.id, organizationId: ctx.orgId } });
  if (!c) throw new Error("not found");
  const copy = await createCampaign(ctx, {
    name: `${c.name} (עותק)`,
    description: c.description,
    tags: c.tags,
    accountId: c.accountId,
    phoneNumberId: c.phoneNumberId,
    templateId: c.templateId,
    audienceFilter: c.audienceFilter,
    variableMapping: c.variableMapping,
    headerMediaUrl: c.headerMediaUrl,
    trackedLinkId: c.trackedLinkId,
    maxRecipients: c.maxRecipients,
    messagesPerSecond: c.messagesPerSecond,
    respectSendingWindow: c.respectSendingWindow,
  });
  return copy.id;
});

// ─── Quick send (one page) ───

export const previewQuickAction = defineAction("campaigns:read", quickCampaignSchema, async (ctx, input) => previewQuickCampaign(ctx, input));
export const quickSendAction = defineAction("campaigns:launch", quickCampaignSchema, async (ctx, input) => quickSendCampaign(ctx, input));

/** Contact search for manual recipient selection — each result carries its eligibility. */
export const searchRecipientsAction = defineAction("contacts:read", z.object({ q: z.string().trim().max(100) }), async (ctx, input) => {
  const { total, rows } = await listContacts(ctx, input.q ? { q: input.q } : {}, { page: 1, pageSize: 30, sort: "name", dir: "asc" });
  return { total, rows: rows.map((c) => ({ id: c.id, name: c.name, phone: c.phoneE164, eligibility: eligibilityOf(c) })) };
});

export const uploadHeaderMediaAction = defineAction("campaigns:write", z.instanceof(FormData), async (ctx, form) => {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("no file");
  return uploadHeaderMedia(ctx, { phoneNumberId: String(form.get("phoneNumberId") ?? ""), format: String(form.get("format") ?? ""), file: { bytes: await file.arrayBuffer(), mimeType: file.type, fileName: file.name } });
});
