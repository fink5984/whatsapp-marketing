"use server";

import { z } from "zod";
import { defineAction } from "@/server/auth/action";
import { deleteRule, saveRule, toggleRule } from "@/server/services/automations";
import { createApiKey, revokeApiKey } from "@/server/services/api-keys";
import { createWebhookEndpoint, deleteWebhookEndpoint } from "@/server/services/outgoing-webhooks";

export const saveRuleAction = defineAction(
  "automations:write",
  z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(100), trigger: z.string(), conditions: z.unknown(), actions: z.unknown(), isActive: z.boolean(), priority: z.number().int().min(0).max(1000).optional() }),
  async (ctx, { id, ...input }) => saveRule(ctx, input, id),
);
export const deleteRuleAction = defineAction("automations:write", z.object({ id: z.string() }), async (ctx, input) => deleteRule(ctx, input.id));
export const toggleRuleAction = defineAction("automations:write", z.object({ id: z.string(), isActive: z.boolean() }), async (ctx, input) => toggleRule(ctx, input.id, input.isActive));

export const createApiKeyAction = defineAction(
  "apikeys:manage",
  z.object({ name: z.string().trim().min(1).max(100), scopes: z.array(z.string()).min(1), expiresInDays: z.number().int().min(1).max(3650).nullable().optional() }),
  async (ctx, input) => (await createApiKey(ctx, input)).plaintext,
);
export const revokeApiKeyAction = defineAction("apikeys:manage", z.object({ id: z.string() }), async (ctx, input) => revokeApiKey(ctx, input.id));

export const createWebhookAction = defineAction(
  "automations:write",
  z.object({ name: z.string().trim().min(1).max(100), url: z.string().trim().url(), events: z.array(z.string()).min(1) }),
  async (ctx, input) => (await createWebhookEndpoint(ctx, input)).secret,
);
export const deleteWebhookAction = defineAction("automations:write", z.object({ id: z.string() }), async (ctx, input) => deleteWebhookEndpoint(ctx, input.id));
