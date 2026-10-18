import { apiRoute } from "@/server/api/handler";
import { campaignReport } from "@/server/services/analytics";

export const dynamic = "force-dynamic";

/** GET /api/v1/campaigns/:id — full performance report. */
export const GET = apiRoute<{ id: string }>("campaigns:read", async (ctx, _req, { id }) => {
  const r = await campaignReport(ctx, id);
  const c = r.campaign;
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    eligibleCount: c.eligibleCount,
    excludedCount: c.excludedCount,
    launchedAt: c.launchedAt,
    completedAt: c.completedAt,
    messages: r.stats ?? null,
    failures: r.failures,
    exclusions: r.exclusions,
    replies: r.replies,
    leads: r.leads,
    unsubscribes: r.unsubscribes,
    cost: r.cost,
  };
});
