import { z } from "zod";
import { db } from "@/server/db";
import { apiRoute, jsonBody } from "@/server/api/handler";
import { serializeContact } from "@/server/api/contacts";
import { updateContact } from "@/server/services/contacts";
import { NotFoundError } from "@/server/rbac";

export const dynamic = "force-dynamic";

export const GET = apiRoute<{ id: string }>("contacts:read", async (ctx, _req, { id }) => {
  const c = await db.contact.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!c) throw new NotFoundError("Contact not found");
  return serializeContact(c);
});

/** PATCH /api/v1/contacts/:id — profile fields only (consent/suppression cannot be changed here). */
export const PATCH = apiRoute<{ id: string }>("contacts:write", async (ctx, req, { id }) => {
  const body = await jsonBody(
    req,
    z.object({ name: z.string().max(200).nullable().optional(), source: z.string().max(100).nullable().optional(), notes: z.string().max(2000).nullable().optional(), attributes: z.record(z.string(), z.string()).optional() }),
  );
  const c = await updateContact(ctx, id, body);
  return serializeContact(c);
});
