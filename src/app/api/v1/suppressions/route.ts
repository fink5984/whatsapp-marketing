import { z } from "zod";
import { db } from "@/server/db";
import { apiRoute } from "@/server/api/handler";

export const dynamic = "force-dynamic";

/** GET /api/v1/suppressions?since=ISO — unsubscribe events, e.g. to sync opt-outs back into Google Sheets via n8n. */
export const GET = apiRoute("suppressions:read", async (ctx, req) => {
  const q = req.nextUrl.searchParams;
  const since = q.get("since") ? new Date(q.get("since")!) : new Date(Date.now() - 7 * 86400_000);
  const limit = z.coerce.number().int().min(1).max(1000).catch(500).parse(q.get("limit") ?? 500);
  const rows = await db.suppressionEntry.findMany({
    where: { organizationId: ctx.orgId, createdAt: { gte: isNaN(since.getTime()) ? new Date(0) : since } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, phoneE164: true, contactId: true, reason: true, createdAt: true, liftedAt: true },
  });
  return rows.map((r) => ({ ...r, phone: r.phoneE164, phoneE164: undefined, active: !r.liftedAt }));
});
