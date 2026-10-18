import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { assertCan, systemContext, type OrgContext } from "../context";
import { audit } from "../audit";
import { NotFoundError } from "../rbac";
import { normalizeForMatch } from "@/lib/unsubscribe";
import { createLeadInternal } from "./leads";
import { logger } from "../logger";

export const AUTOMATION_TRIGGERS = ["INBOUND_KEYWORD", "BUTTON_REPLY", "ANY_INBOUND"] as const;
export const TRIGGER_LABELS: Record<(typeof AUTOMATION_TRIGGERS)[number], string> = {
  INBOUND_KEYWORD: "הודעה נכנסת מכילה מילת מפתח",
  BUTTON_REPLY: "לחיצה על כפתור תגובה",
  ANY_INBOUND: "כל הודעה נכנסת",
};

export const conditionsSchema = z.object({
  keywords: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  match: z.enum(["exact", "contains"]).default("contains"),
});

/**
 * Actions deliberately exclude sending messages: automations may organize
 * and route, never initiate marketing outreach.
 */
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("TAG_CONTACT"), tagId: z.string() }),
  z.object({ type: z.literal("CREATE_LEAD") }),
  z.object({ type: z.literal("SET_CONVERSATION_STATUS"), status: z.enum(["OPEN", "HANDLED", "INTERESTED", "NOT_INTERESTED", "NEEDS_AGENT"]) }),
  z.object({ type: z.literal("ASSIGN"), userId: z.string() }),
]);
export const actionsSchema = z.array(actionSchema).min(1).max(10);
export type AutomationAction = z.infer<typeof actionSchema>;

export const ACTION_LABELS: Record<AutomationAction["type"], string> = {
  TAG_CONTACT: "הוספת תגית לאיש הקשר",
  CREATE_LEAD: "יצירת ליד",
  SET_CONVERSATION_STATUS: "עדכון סטטוס שיחה",
  ASSIGN: "שיוך לנציג",
};

export type InboundContext = {
  contactId: string;
  conversationId: string;
  inboundId: string;
  text: string | null;
  buttonPayload: string | null;
  buttonText: string | null;
  isButton: boolean;
  campaignId: string | null;
};

export function ruleMatches(trigger: string, conditionsRaw: unknown, msg: Pick<InboundContext, "text" | "buttonPayload" | "buttonText" | "isButton">): boolean {
  const cond = conditionsSchema.safeParse(conditionsRaw);
  if (!cond.success) return false;
  if (trigger === "ANY_INBOUND") return true;
  if (trigger === "BUTTON_REPLY" && !msg.isButton) return false;
  if (trigger === "INBOUND_KEYWORD" && msg.isButton) return false;
  const haystacks = (trigger === "BUTTON_REPLY" ? [msg.buttonText, msg.buttonPayload] : [msg.text]).filter(Boolean).map((t) => normalizeForMatch(t!));
  if (cond.data.keywords.length === 0) return trigger === "BUTTON_REPLY";
  return cond.data.keywords.some((kw) => {
    const k = normalizeForMatch(kw);
    return haystacks.some((h) => (cond.data.match === "exact" ? h === k : ` ${h} `.includes(` ${k} `) || h.includes(k)));
  });
}

export async function runAutomations(orgId: string, msg: InboundContext) {
  const rules = await db.automationRule.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { priority: "asc" } });
  for (const rule of rules) {
    if (!ruleMatches(rule.trigger, rule.conditions, msg)) continue;
    const actions = actionsSchema.safeParse(rule.actions);
    if (!actions.success) continue;
    try {
      for (const a of actions.data) await executeAction(orgId, a, msg);
      await db.automationRule.update({ where: { id: rule.id }, data: { fireCount: { increment: 1 }, lastFiredAt: new Date() } });
    } catch (err) {
      logger.error("automation failed", { ruleId: rule.id, err });
    }
  }
}

async function executeAction(orgId: string, a: AutomationAction, msg: InboundContext) {
  switch (a.type) {
    case "TAG_CONTACT": {
      const tag = await db.tag.findFirst({ where: { id: a.tagId, organizationId: orgId } });
      if (tag) await db.contactTag.createMany({ data: [{ contactId: msg.contactId, tagId: tag.id }], skipDuplicates: true });
      break;
    }
    case "CREATE_LEAD":
      await createLeadInternal(orgId, { contactId: msg.contactId, campaignId: msg.campaignId, source: "אוטומציה: תגובה ב-WhatsApp", notes: msg.text ?? undefined }, { dedupeHours: 24 });
      break;
    case "SET_CONVERSATION_STATUS":
      await db.conversation.updateMany({ where: { id: msg.conversationId, organizationId: orgId }, data: { status: a.status } });
      break;
    case "ASSIGN": {
      const member = await db.organizationMember.findFirst({ where: { organizationId: orgId, userId: a.userId } });
      if (member) await db.conversation.updateMany({ where: { id: msg.conversationId, organizationId: orgId }, data: { assigneeId: a.userId } });
      break;
    }
  }
}

export async function listRules(ctx: OrgContext) {
  assertCan(ctx, "automations:read");
  return db.automationRule.findMany({ where: { organizationId: ctx.orgId }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
}

export type RuleInput = { name: string; trigger: string; conditions: unknown; actions: unknown; isActive: boolean; priority?: number };

async function validateRuleInput(ctx: OrgContext, input: RuleInput) {
  const conditions = conditionsSchema.parse(input.conditions);
  const actions = actionsSchema.parse(input.actions);
  for (const a of actions) {
    if (a.type === "TAG_CONTACT" && !(await db.tag.findFirst({ where: { id: a.tagId, organizationId: ctx.orgId } }))) throw new NotFoundError("תגית לא נמצאה");
    if (a.type === "ASSIGN" && !(await db.organizationMember.findFirst({ where: { userId: a.userId, organizationId: ctx.orgId } }))) throw new NotFoundError("משתמש לא נמצא");
  }
  if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(input.trigger)) throw new NotFoundError("טריגר לא מוכר");
  return { conditions, actions };
}

export async function saveRule(ctx: OrgContext, input: RuleInput, id?: string) {
  assertCan(ctx, "automations:write");
  const { conditions, actions } = await validateRuleInput(ctx, input);
  const data = {
    name: input.name.trim(),
    trigger: input.trigger,
    conditions: conditions as Prisma.InputJsonValue,
    actions: actions as Prisma.InputJsonValue,
    isActive: input.isActive,
    priority: input.priority ?? 100,
  };
  if (id) {
    const res = await db.automationRule.updateMany({ where: { id, organizationId: ctx.orgId }, data });
    if (!res.count) throw new NotFoundError();
    await audit(ctx, "automation.update", { type: "automation_rule", id });
    return id;
  }
  const rule = await db.automationRule.create({ data: { ...data, organizationId: ctx.orgId } });
  await audit(ctx, "automation.create", { type: "automation_rule", id: rule.id });
  return rule.id;
}

export async function deleteRule(ctx: OrgContext, id: string) {
  assertCan(ctx, "automations:write");
  const res = await db.automationRule.deleteMany({ where: { id, organizationId: ctx.orgId } });
  if (!res.count) throw new NotFoundError();
  await audit(ctx, "automation.delete", { type: "automation_rule", id });
}

export async function toggleRule(ctx: OrgContext, id: string, isActive: boolean) {
  assertCan(ctx, "automations:write");
  const res = await db.automationRule.updateMany({ where: { id, organizationId: ctx.orgId }, data: { isActive } });
  if (!res.count) throw new NotFoundError();
}

/** Default rules for a new organization. */
export async function seedDefaultRules(orgId: string) {
  const ctx = systemContext(orgId);
  const existing = await db.automationRule.count({ where: { organizationId: ctx.orgId } });
  if (existing) return;
  await db.automationRule.createMany({
    data: [
      {
        organizationId: orgId,
        name: "בקשה לשיחה עם נציג",
        trigger: "INBOUND_KEYWORD",
        conditions: { keywords: ["נציג", "נציגה", "לדבר עם מישהו", "תתקשרו", "שיחה טלפונית", "agent"], match: "contains" },
        actions: [{ type: "SET_CONVERSATION_STATUS", status: "NEEDS_AGENT" }],
        priority: 10,
      },
      {
        organizationId: orgId,
        name: "לחיצה על כפתור התעניינות → ליד",
        trigger: "BUTTON_REPLY",
        conditions: { keywords: ["מעוניין", "מעוניינת", "אני מעוניין", "פרטים נוספים", "כן"], match: "contains" },
        actions: [{ type: "CREATE_LEAD" }, { type: "SET_CONVERSATION_STATUS", status: "INTERESTED" }],
        priority: 20,
      },
    ],
  });
}
