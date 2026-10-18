import type { ConversationStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { hashPhone } from "../crypto";
import { actorUserId, assertCan, type OrgContext } from "../context";
import { NotFoundError, UserError } from "../rbac";
import { buildTextPayload } from "../sending/payload";
import { claimMessageById, processClaimed, SERVICE_WINDOW_MS } from "../sending/sender";

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  OPEN: "פתוחה",
  HANDLED: "טופל",
  INTERESTED: "מתעניין",
  NOT_INTERESTED: "לא מעוניין",
  NEEDS_AGENT: "ממתין לנציג",
};

export async function listConversations(
  ctx: OrgContext,
  opts: { status?: ConversationStatus; assignee?: string; q?: string; unread?: boolean; page: number; pageSize: number },
) {
  assertCan(ctx, "inbox:read");
  const where: Prisma.ConversationWhereInput = {
    organizationId: ctx.orgId,
    status: opts.status,
    assigneeId: opts.assignee === "me" ? actorUserId(ctx) : opts.assignee === "none" ? null : opts.assignee || undefined,
    unreadCount: opts.unread ? { gt: 0 } : undefined,
    ...(opts.q
      ? {
          OR: [
            { contact: { name: { contains: opts.q, mode: "insensitive" } } },
            { contact: { phoneE164: { contains: opts.q.replace(/\D/g, "").replace(/^0/, "") || opts.q } } },
            { inboundMessages: { some: { text: { contains: opts.q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    db.conversation.count({ where }),
    db.conversation.findMany({
      where,
      include: {
        contact: { select: { id: true, name: true, phoneE164: true, isSuppressed: true, consentStatus: true } },
        assignee: { select: { id: true, name: true } },
        phoneNumber: { select: { displayPhoneNumber: true } },
        inboundMessages: { orderBy: { receivedAt: "desc" }, take: 1, select: { text: true, isUnsubscribe: true } },
      },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
  ]);
  return { total, rows };
}

export async function getConversation(ctx: OrgContext, id: string) {
  assertCan(ctx, "inbox:read");
  const convo = await db.conversation.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      contact: { include: { tags: { include: { tag: true } } } },
      assignee: { select: { id: true, name: true } },
      phoneNumber: { select: { id: true, displayPhoneNumber: true } },
    },
  });
  if (!convo) throw new NotFoundError("השיחה לא נמצאה");
  const [inbound, outbound] = await Promise.all([
    db.inboundMessage.findMany({ where: { organizationId: ctx.orgId, conversationId: id }, orderBy: { receivedAt: "asc" }, take: 500 }),
    db.outboundMessage.findMany({
      where: { organizationId: ctx.orgId, contactId: convo.contactId, phoneNumberId: convo.phoneNumberId },
      include: { campaign: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 500,
    }),
  ]);
  const timeline = [
    ...inbound.map((m) => ({ id: m.id, direction: "in" as const, at: m.receivedAt, text: m.text, type: m.type, isUnsubscribe: m.isUnsubscribe, status: null as string | null, label: null as string | null })),
    ...outbound.map((m) => ({
      id: m.id,
      direction: "out" as const,
      at: m.submittedAt ?? m.createdAt,
      text: outboundPreview(m.payload),
      type: m.kind,
      isUnsubscribe: false,
      status: m.status as string | null,
      label: m.campaign?.name ?? (m.kind === "UNSUBSCRIBE_CONFIRMATION" ? "אישור הסרה" : m.kind === "TEST" ? "בדיקה" : null),
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const windowOpen = !!convo.lastInboundAt && Date.now() - convo.lastInboundAt.getTime() < SERVICE_WINDOW_MS;
  const windowClosesAt = convo.lastInboundAt ? new Date(convo.lastInboundAt.getTime() + SERVICE_WINDOW_MS) : null;
  if (convo.unreadCount > 0) await db.conversation.update({ where: { id }, data: { unreadCount: 0 } });
  return { convo, timeline, windowOpen, windowClosesAt };
}

function outboundPreview(payload: unknown): string {
  const p = payload as { type?: string; text?: { body?: string }; template?: { name?: string }; redacted?: boolean };
  if (p?.redacted) return "[נמחק]";
  if (p?.type === "text") return p.text?.body ?? "";
  if (p?.type === "template") return `[תבנית: ${p.template?.name ?? ""}]`;
  return "";
}

export async function updateConversation(ctx: OrgContext, id: string, input: { status?: ConversationStatus; assigneeId?: string | null; notes?: string | null }) {
  assertCan(ctx, "inbox:write");
  const convo = await db.conversation.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!convo) throw new NotFoundError("השיחה לא נמצאה");
  if (input.assigneeId) {
    const m = await db.organizationMember.findFirst({ where: { organizationId: ctx.orgId, userId: input.assigneeId } });
    if (!m) throw new NotFoundError("המשתמש לא נמצא");
  }
  return db.conversation.update({
    where: { id },
    data: { status: input.status, assigneeId: input.assigneeId === undefined ? undefined : input.assigneeId, notes: input.notes === undefined ? undefined : input.notes },
  });
}

/**
 * Agent reply. Only free-form text inside the 24h customer-service window —
 * outside it WhatsApp requires an approved template (i.e. a campaign/test).
 */
export async function sendReply(ctx: OrgContext, conversationId: string, text: string) {
  assertCan(ctx, "inbox:write");
  const body = text.trim();
  if (!body) throw new UserError("ההודעה ריקה");
  if (body.length > 4096) throw new UserError("ההודעה ארוכה מדי");
  const convo = await db.conversation.findFirst({ where: { id: conversationId, organizationId: ctx.orgId }, include: { contact: true } });
  if (!convo) throw new NotFoundError("השיחה לא נמצאה");
  if (!convo.lastInboundAt || Date.now() - convo.lastInboundAt.getTime() > SERVICE_WINDOW_MS) {
    throw new UserError("חלון השירות של 24 שעות נסגר. ניתן לפנות לנמען רק באמצעות תבנית מאושרת ובכפוף להסכמה.");
  }
  const msg = await db.outboundMessage.create({
    data: {
      organizationId: ctx.orgId,
      kind: "SERVICE_REPLY",
      contactId: convo.contactId,
      conversationId,
      phoneNumberId: convo.phoneNumberId,
      toPhone: convo.contact.phoneE164,
      toPhoneHash: hashPhone(convo.contact.phoneE164),
      payload: buildTextPayload(convo.contact.phoneE164, body) as Prisma.InputJsonValue,
      maxAttempts: 3,
      createdById: actorUserId(ctx),
    },
  });
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  const claimed = await claimMessageById(`web:${process.pid}`, msg.id);
  if (claimed) await processClaimed(claimed, `web:${process.pid}`);
  return db.outboundMessage.findUniqueOrThrow({ where: { id: msg.id } });
}
