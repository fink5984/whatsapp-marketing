import { z } from "zod";
import { db } from "@/server/db";
import { apiRoute, jsonBody } from "@/server/api/handler";
import { createLead } from "@/server/services/leads";
import { getSettings } from "@/server/services/settings";
import { UserError } from "@/server/rbac";
import { normalizePhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/** POST /api/v1/leads — by contactId or phone (existing contact). Campaign attributed automatically when omitted. */
export const POST = apiRoute("leads:write", async (ctx, req) => {
  const body = await jsonBody(
    req,
    z.object({
      contactId: z.string().optional(),
      phone: z.string().optional(),
      campaignId: z.string().optional(),
      source: z.string().min(1).max(200).default("API"),
      notes: z.string().max(2000).optional(),
      value: z.number().min(0).optional(),
      externalId: z.string().max(200).optional(),
    }),
  );
  let contactId = body.contactId ?? null;
  if (!contactId && body.phone) {
    const p = normalizePhone(body.phone, (await getSettings(ctx.orgId)).defaultCountry);
    if (!p.ok) throw new UserError(p.reason);
    contactId = (await db.contact.findUnique({ where: { organizationId_phoneE164: { organizationId: ctx.orgId, phoneE164: p.e164 } } }))?.id ?? null;
  }
  const lead = await createLead(ctx, { ...body, contactId });
  return { id: lead.id, campaignId: lead.campaignId, contactId: lead.contactId, status: lead.status };
});
