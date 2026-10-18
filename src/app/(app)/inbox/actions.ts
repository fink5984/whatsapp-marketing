"use server";

import { z } from "zod";
import { defineAction } from "@/server/auth/action";
import { sendReply, updateConversation } from "@/server/services/inbox";
import { createLead, updateLead } from "@/server/services/leads";
import { db } from "@/server/db";
import { UserError } from "@/server/rbac";

const statuses = ["OPEN", "HANDLED", "INTERESTED", "NOT_INTERESTED", "NEEDS_AGENT"] as const;

export const updateConversationAction = defineAction(
  "inbox:write",
  z.object({ id: z.string(), status: z.enum(statuses).optional(), assigneeId: z.string().nullable().optional(), notes: z.string().max(5000).nullable().optional() }),
  async (ctx, { id, ...input }) => {
    await updateConversation(ctx, id, input);
  },
);

export const sendReplyAction = defineAction("inbox:write", z.object({ id: z.string(), text: z.string().trim().min(1).max(4096) }), async (ctx, input) => {
  const m = await sendReply(ctx, input.id, input.text);
  if (m.status === "FAILED") throw new UserError(`השליחה נכשלה: ${m.errorDetail ?? m.errorCode ?? ""}`);
  return m.status;
});

export const createLeadFromConversationAction = defineAction("inbox:write", z.object({ conversationId: z.string(), notes: z.string().max(2000).optional() }), async (ctx, input) => {
  const convo = await db.conversation.findFirst({ where: { id: input.conversationId, organizationId: ctx.orgId } });
  if (!convo) throw new UserError("השיחה לא נמצאה");
  await createLead(ctx, { contactId: convo.contactId, source: "תיבת הודעות", notes: input.notes });
  await updateConversation(ctx, convo.id, { status: "INTERESTED" });
});

export const updateLeadAction = defineAction(
  "inbox:write",
  z.object({ id: z.string(), status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"]).optional(), value: z.number().min(0).max(1e9).nullable().optional() }),
  async (ctx, { id, ...input }) => {
    await updateLead(ctx, id, input);
  },
);
