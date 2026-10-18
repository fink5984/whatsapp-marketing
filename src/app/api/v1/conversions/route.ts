import { z } from "zod";
import { db } from "@/server/db";
import { apiRoute, jsonBody } from "@/server/api/handler";
import { recordConversion } from "@/server/services/leads";
import { getSettings } from "@/server/services/settings";
import { normalizePhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/conversions — from a customer website/CRM. Attribute with the
 * click token (the /r/<token> path segment, e.g. stored in a cookie on landing)
 * or a phone/contactId. Idempotent on externalId.
 */
export const POST = apiRoute("conversions:write", async (ctx, req) => {
  const body = await jsonBody(
    req,
    z.object({
      type: z.string().min(1).max(100),
      value: z.number().min(0).optional(),
      currency: z.string().length(3).optional(),
      externalId: z.string().max(200).optional(),
      clickToken: z.string().regex(/^[A-Za-z0-9]{6,40}$/).optional(),
      phone: z.string().optional(),
      contactId: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
  );
  let contactId = body.contactId ?? null;
  if (!contactId && body.phone) {
    const p = normalizePhone(body.phone, (await getSettings(ctx.orgId)).defaultCountry);
    if (p.ok) contactId = (await db.contact.findUnique({ where: { organizationId_phoneE164: { organizationId: ctx.orgId, phoneE164: p.e164 } } }))?.id ?? null;
  }
  const conv = await recordConversion(ctx, { ...body, contactId });
  return { id: conv.id, campaignId: conv.campaignId, contactId: conv.contactId };
});
