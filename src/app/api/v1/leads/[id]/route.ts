import { z } from "zod";
import { apiRoute, jsonBody } from "@/server/api/handler";
import { updateLead } from "@/server/services/leads";

export const dynamic = "force-dynamic";

export const PATCH = apiRoute<{ id: string }>("leads:write", async (ctx, req, { id }) => {
  const body = await jsonBody(req, z.object({ status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"]).optional(), notes: z.string().max(2000).nullable().optional(), value: z.number().min(0).nullable().optional() }));
  const lead = await updateLead(ctx, id, body);
  return { id: lead.id, status: lead.status };
});
