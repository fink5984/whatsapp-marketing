"use server";

import { z } from "zod";
import { defineAction } from "@/server/auth/action";
import { deleteTemplate, saveTemplateDraft, submitTemplate } from "@/server/services/templates";
import { sendTestMessage } from "@/server/services/campaigns";
import { UserError } from "@/server/rbac";

const buttonSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("QUICK_REPLY"), text: z.string().max(25) }),
  z.object({ type: z.literal("URL"), text: z.string().max(25), url: z.string().max(2000), example: z.array(z.string()).optional() }),
  z.object({ type: z.literal("PHONE_NUMBER"), text: z.string().max(25), phone_number: z.string().max(20) }),
]);
const componentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("HEADER"), format: z.enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT"]), text: z.string().max(60).optional(), example: z.any().optional() }),
  z.object({ type: z.literal("BODY"), text: z.string().max(1024), example: z.any().optional() }),
  z.object({ type: z.literal("FOOTER"), text: z.string().max(60) }),
  z.object({ type: z.literal("BUTTONS"), buttons: z.array(buttonSchema).max(10) }),
]);

export const saveTemplateAction = defineAction(
  "templates:write",
  z.object({
    id: z.string().optional(),
    accountId: z.string(),
    name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "אותיות אנגליות קטנות, ספרות וקו תחתון בלבד"),
    language: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/),
    category: z.enum(["MARKETING", "UTILITY"]),
    components: z.array(componentSchema).min(1),
  }),
  async (ctx, { id, ...input }) => (await saveTemplateDraft(ctx, input, id)).id,
);

/** FormData: id + optional header sample file. */
export const submitTemplateAction = defineAction("templates:write", z.instanceof(FormData), async (ctx, form) => {
  const id = String(form.get("id") ?? "");
  if (!id) throw new UserError("חסר מזהה תבנית");
  const file = form.get("file");
  const sample = file instanceof File && file.size > 0 ? { bytes: await file.arrayBuffer(), mimeType: file.type, fileName: file.name } : undefined;
  await submitTemplate(ctx, id, sample);
});

export const deleteTemplateAction = defineAction("templates:write", z.object({ id: z.string() }), async (ctx, input) => deleteTemplate(ctx, input.id));

export const testTemplateAction = defineAction(
  "campaigns:write",
  z.object({ templateId: z.string(), phone: z.string().min(3).max(40), sampleValues: z.record(z.string(), z.string().max(500)).optional(), headerMediaUrl: z.string().url().optional() }),
  async (ctx, input) => sendTestMessage(ctx, input),
);
