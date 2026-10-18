import { apiRoute } from "@/server/api/handler";
import { consentStatusForPhone } from "@/server/api/contacts";
import { UserError } from "@/server/rbac";

export const dynamic = "force-dynamic";

/** GET /api/v1/consent?phone=… — consent + suppression + marketing eligibility. */
export const GET = apiRoute("consents:read", async (ctx, req) => {
  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) throw new UserError("phone is required");
  return consentStatusForPhone(ctx, phone);
});
