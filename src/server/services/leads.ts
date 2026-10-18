import type { LeadStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { assertCan, type OrgContext } from "../context";
import { NotFoundError, UserError } from "../rbac";
import { emitEvent } from "./outgoing-webhooks";

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "חדש",
  CONTACTED: "נוצר קשר",
  QUALIFIED: "רלוונטי",
  WON: "נסגר בהצלחה",
  LOST: "לא רלוונטי",
};

const ATTRIBUTION_WINDOW_MS = 7 * 86400_000;

/** Last campaign that reached this contact in the attribution window. */
async function attributeCampaign(orgId: string, contactId: string): Promise<string | null> {
  const last = await db.outboundMessage.findFirst({
    where: { organizationId: orgId, contactId, kind: "CAMPAIGN", submittedAt: { gte: new Date(Date.now() - ATTRIBUTION_WINDOW_MS) } },
    orderBy: { submittedAt: "desc" },
    select: { campaignId: true },
  });
  return last?.campaignId ?? null;
}

export async function createLeadInternal(
  orgId: string,
  input: { contactId?: string | null; campaignId?: string | null; source: string; notes?: string; value?: number | null; externalId?: string | null },
  opts: { dedupeHours?: number } = {},
) {
  if (input.contactId && opts.dedupeHours) {
    const recent = await db.lead.findFirst({
      where: { organizationId: orgId, contactId: input.contactId, createdAt: { gte: new Date(Date.now() - opts.dedupeHours * 3600_000) } },
    });
    if (recent) return recent;
  }
  const campaignId = input.campaignId ?? (input.contactId ? await attributeCampaign(orgId, input.contactId) : null);
  const lead = await db.lead.create({
    data: {
      organizationId: orgId,
      contactId: input.contactId ?? null,
      campaignId,
      source: input.source.slice(0, 200),
      notes: input.notes?.slice(0, 2000) ?? null,
      value: input.value ?? null,
      externalId: input.externalId ?? null,
    },
  });
  await emitEvent(orgId, "lead.created", { leadId: lead.id, contactId: lead.contactId, campaignId, source: lead.source });
  return lead;
}

export async function createLead(ctx: OrgContext, input: { contactId?: string | null; campaignId?: string | null; source: string; notes?: string; value?: number | null; externalId?: string | null }) {
  if (ctx.actor.type !== "api_key") assertCan(ctx, "inbox:write");
  if (input.contactId && !(await db.contact.findFirst({ where: { id: input.contactId, organizationId: ctx.orgId } }))) throw new NotFoundError("איש הקשר לא נמצא");
  if (input.campaignId && !(await db.campaign.findFirst({ where: { id: input.campaignId, organizationId: ctx.orgId } }))) throw new NotFoundError("הקמפיין לא נמצא");
  return createLeadInternal(ctx.orgId, input);
}

export async function updateLead(ctx: OrgContext, id: string, input: { status?: LeadStatus; notes?: string | null; value?: number | null }) {
  if (ctx.actor.type !== "api_key") assertCan(ctx, "inbox:write");
  const lead = await db.lead.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!lead) throw new NotFoundError("הליד לא נמצא");
  const updated = await db.lead.update({
    where: { id },
    data: { status: input.status, notes: input.notes === undefined ? undefined : input.notes, value: input.value === undefined ? undefined : input.value },
  });
  await emitEvent(ctx.orgId, "lead.updated", { leadId: id, status: updated.status });
  return updated;
}

export async function listLeads(ctx: OrgContext, opts: { status?: LeadStatus; page: number; pageSize: number }) {
  assertCan(ctx, "inbox:read");
  const where: Prisma.LeadWhereInput = { organizationId: ctx.orgId, status: opts.status };
  const [total, rows] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      include: { contact: { select: { id: true, name: true, phoneE164: true } }, campaign: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
  ]);
  return { total, rows };
}

/** Conversion from a customer's website / CRM (via API). Attributed by click token or contact. */
export async function recordConversion(
  ctx: OrgContext,
  input: { type: string; value?: number | null; currency?: string | null; externalId?: string | null; clickToken?: string | null; phone?: string | null; contactId?: string | null; metadata?: Record<string, unknown> },
) {
  let campaignId: string | null = null;
  let contactId: string | null = input.contactId ?? null;
  if (input.clickToken) {
    const r = await db.campaignRecipient.findFirst({ where: { clickToken: input.clickToken, organizationId: ctx.orgId } });
    if (r) {
      campaignId = r.campaignId;
      contactId = contactId ?? r.contactId;
    } else {
      const link = await db.trackedLink.findFirst({ where: { token: input.clickToken, organizationId: ctx.orgId } });
      campaignId = link?.campaignId ?? null;
    }
  }
  if (contactId && !(await db.contact.findFirst({ where: { id: contactId, organizationId: ctx.orgId } }))) throw new UserError("איש הקשר לא נמצא");
  if (!campaignId && contactId) campaignId = await attributeCampaign(ctx.orgId, contactId);
  if (input.externalId) {
    const existing = await db.conversion.findUnique({ where: { organizationId_externalId: { organizationId: ctx.orgId, externalId: input.externalId } } });
    if (existing) return existing; // idempotent
  }
  return db.conversion.create({
    data: {
      organizationId: ctx.orgId,
      campaignId,
      contactId,
      clickToken: input.clickToken ?? null,
      type: input.type.slice(0, 100),
      value: input.value ?? null,
      currency: input.currency ?? null,
      externalId: input.externalId ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
