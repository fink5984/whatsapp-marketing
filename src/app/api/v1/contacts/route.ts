import { z } from "zod";
import { db } from "@/server/db";
import { apiRoute, jsonBody } from "@/server/api/handler";
import { apiContactSchema, apiImport, serializeContact } from "@/server/api/contacts";
import { getSettings } from "@/server/services/settings";
import { UserError } from "@/server/rbac";
import { normalizePhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/** GET /api/v1/contacts?phone=…  |  ?updatedSince=ISO&limit=100&cursor=id */
export const GET = apiRoute("contacts:read", async (ctx, req) => {
  const q = req.nextUrl.searchParams;
  const phone = q.get("phone");
  if (phone) {
    const settings = await getSettings(ctx.orgId);
    const p = normalizePhone(phone, settings.defaultCountry);
    if (!p.ok) throw new UserError(p.reason);
    const c = await db.contact.findUnique({ where: { organizationId_phoneE164: { organizationId: ctx.orgId, phoneE164: p.e164 } } });
    return c ? serializeContact(c) : null;
  }
  const limit = z.coerce.number().int().min(1).max(500).catch(100).parse(q.get("limit") ?? 100);
  const since = q.get("updatedSince") ? new Date(q.get("updatedSince")!) : undefined;
  const cursor = q.get("cursor") ?? undefined;
  const rows = await db.contact.findMany({
    where: { organizationId: ctx.orgId, ...(since && !isNaN(since.getTime()) ? { updatedAt: { gte: since } } : {}) },
    orderBy: { id: "asc" },
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
  return { items: rows.map(serializeContact), nextCursor: rows.length === limit ? rows[rows.length - 1].id : null };
});

/** POST /api/v1/contacts — create or update one contact (consent only with proof). */
export const POST = apiRoute("contacts:write", async (ctx, req) => {
  const body = await jsonBody(req, apiContactSchema.extend({ source: z.string().max(100).default("API") }));
  const result = await apiImport(ctx, { source: body.source, contacts: [body] });
  if (result.stats.invalid) throw new UserError(result.stats.errors[0]?.reason ?? "מספר לא תקין");
  const settings = await getSettings(ctx.orgId);
  const p = normalizePhone(body.phone, settings.defaultCountry);
  const c = p.ok ? await db.contact.findUnique({ where: { organizationId_phoneE164: { organizationId: ctx.orgId, phoneE164: p.e164 } } }) : null;
  return { contact: c ? serializeContact(c) : null, created: result.stats.created === 1, consentRecorded: result.stats.consentRecorded === 1 };
});
