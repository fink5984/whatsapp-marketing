"use server";

import { z } from "zod";
import { defineAction } from "@/server/auth/action";
import { addManualSuppression } from "@/server/services/suppression";
import { getSettings } from "@/server/services/settings";
import { UserError } from "@/server/rbac";
import { normalizePhone } from "@/lib/phone";

export const addSuppressionAction = defineAction("suppression:write", z.object({ phone: z.string().min(3).max(40), detail: z.string().max(500) }), async (ctx, input) => {
  const settings = await getSettings(ctx.orgId);
  const p = normalizePhone(input.phone, settings.defaultCountry);
  if (!p.ok) throw new UserError(p.reason);
  const res = await addManualSuppression(ctx, p.e164, input.detail || "הסרה ידנית");
  if (!res.created) throw new UserError("המספר כבר ברשימת ההסרה");
});
