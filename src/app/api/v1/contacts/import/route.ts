import { apiRoute, jsonBody } from "@/server/api/handler";
import { apiImport, apiImportSchema } from "@/server/api/contacts";

export const dynamic = "force-dynamic";

/** POST /api/v1/contacts/import — bulk upsert (up to 5,000 per request). */
export const POST = apiRoute("contacts:write", async (ctx, req) => {
  const body = await jsonBody(req, apiImportSchema);
  const { importId, stats } = await apiImport(ctx, body);
  return { importId, ...stats };
});
