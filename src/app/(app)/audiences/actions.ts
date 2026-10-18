"use server";

import { z } from "zod";
import { defineAction } from "@/server/auth/action";
import { deleteAudience, saveAudience } from "@/server/services/audiences";
import { contactFilterSchema } from "@/server/services/contact-filter";

export const saveAudienceAction = defineAction(
  "audiences:write",
  z.object({
    id: z.string().optional(),
    name: z.string().trim().min(1, "שם חסר").max(100),
    description: z.string().max(500).optional(),
    kind: z.enum(["STATIC", "DYNAMIC"]),
    filter: contactFilterSchema.optional(),
  }),
  async (ctx, { id, ...input }) => saveAudience(ctx, input, id),
);

export const deleteAudienceAction = defineAction("audiences:write", z.object({ id: z.string() }), async (ctx, input) => deleteAudience(ctx, input.id));
