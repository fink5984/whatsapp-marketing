"use server";

import { z } from "zod";
import { defineAction } from "@/server/auth/action";
import { createAccount, deleteAccount, runHealthCheck, setPhoneNumberOptions, subscribeWebhooks, updateAccount } from "@/server/services/accounts";
import { syncTemplates } from "@/server/services/templates";

const accountSchema = z.object({
  name: z.string().trim().min(1, "שם חסר").max(100),
  wabaId: z.string().trim().regex(/^\d{5,25}$/, "ספרות בלבד"),
  accessToken: z.string().trim().max(1000).optional(),
  metaAppId: z.string().trim().regex(/^\d*$/, "ספרות בלבד").max(30).optional(),
  appSecret: z.string().trim().max(200).optional(),
  webhookVerifyToken: z.string().trim().max(200).optional(),
});

export const createAccountAction = defineAction("accounts:write", accountSchema, async (ctx, input) => (await createAccount(ctx, input)).id);

export const updateAccountAction = defineAction("accounts:write", accountSchema.partial().extend({ id: z.string() }), async (ctx, { id, ...input }) => {
  await updateAccount(ctx, id, input);
});

export const deleteAccountAction = defineAction("accounts:write", z.object({ id: z.string() }), async (ctx, input) => deleteAccount(ctx, input.id));

export const healthCheckAction = defineAction("accounts:write", z.object({ id: z.string() }), async (ctx, input) => runHealthCheck(ctx, input.id));

export const subscribeWebhooksAction = defineAction("accounts:write", z.object({ id: z.string() }), async (ctx, input) => subscribeWebhooks(ctx, input.id));

export const syncTemplatesAction = defineAction("templates:write", z.object({ accountId: z.string() }), async (ctx, input) => syncTemplates(ctx, input.accountId));

export const phoneOptionsAction = defineAction(
  "accounts:write",
  z.object({ id: z.string(), isDefault: z.boolean().optional(), messagesPerSecond: z.number().int().min(1).max(80).nullable().optional() }),
  async (ctx, { id, ...input }) => setPhoneNumberOptions(ctx, id, input),
);
