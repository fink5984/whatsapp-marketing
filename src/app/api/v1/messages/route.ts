import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { hashPhone } from "@/server/crypto";
import { apiRoute } from "@/server/api/handler";
import { getSettings } from "@/server/services/settings";
import { normalizePhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

/** GET /api/v1/messages?campaignId=&phone=&updatedSince=&limit=&cursor= */
export const GET = apiRoute("messages:read", async (ctx, req) => {
  const q = req.nextUrl.searchParams;
  const where: Prisma.OutboundMessageWhereInput = { organizationId: ctx.orgId };
  if (q.get("campaignId")) where.campaignId = q.get("campaignId")!;
  if (q.get("phone")) {
    const p = normalizePhone(q.get("phone"), (await getSettings(ctx.orgId)).defaultCountry);
    where.toPhoneHash = p.ok ? hashPhone(p.e164) : "__none__";
  }
  const since = q.get("updatedSince") ? new Date(q.get("updatedSince")!) : null;
  if (since && !isNaN(since.getTime())) where.updatedAt = { gte: since };
  const limit = z.coerce.number().int().min(1).max(500).catch(100).parse(q.get("limit") ?? 100);
  const cursor = q.get("cursor") ?? undefined;
  const rows = await db.outboundMessage.findMany({
    where,
    orderBy: { id: "asc" },
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: { id: true, kind: true, campaignId: true, contactId: true, toPhone: true, templateName: true, status: true, wamid: true, errorCode: true, errorDetail: true, billable: true, submittedAt: true, sentAt: true, deliveredAt: true, readAt: true, failedAt: true, updatedAt: true },
  });
  return { items: rows, nextCursor: rows.length === limit ? rows[rows.length - 1].id : null };
});
