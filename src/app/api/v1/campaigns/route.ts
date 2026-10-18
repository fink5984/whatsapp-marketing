import { db } from "@/server/db";
import { apiRoute } from "@/server/api/handler";
import { messageStatusCounts } from "@/server/services/campaigns";

export const dynamic = "force-dynamic";

/** GET /api/v1/campaigns — latest 100 campaigns with status counts. */
export const GET = apiRoute("campaigns:read", async (ctx) => {
  const rows = await db.campaign.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, name: true, status: true, eligibleCount: true, excludedCount: true, scheduledAt: true, launchedAt: true, completedAt: true, createdAt: true, template: { select: { name: true } } },
  });
  const stats = await messageStatusCounts(ctx.orgId, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, template: r.template?.name ?? null, messages: stats.get(r.id) ?? null }));
});
