import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { hashPhone, sha256Hex } from "../crypto";
import { systemContext } from "../context";
import { audit } from "../audit";
import { logger } from "../logger";
import { waIdToE164 } from "@/lib/phone";
import { isUnsubscribeButton, isUnsubscribeText } from "@/lib/unsubscribe";
import { nextOutboundStatus, type IncomingStatus } from "./status";
import { suppressPhone } from "../services/suppression";
import { getSettings, unsubscribeKeywords } from "../services/settings";
import { applyTemplateStatusWebhook } from "../services/templates";
import { emitEvent } from "../services/outgoing-webhooks";
import { runAutomations } from "../services/automations";
import { buildTextPayload } from "../sending/payload";

// ── Payload types (subset of the WhatsApp webhook schema we consume) ──

type WaStatus = {
  id: string;
  status: string;
  timestamp: string;
  recipient_id?: string;
  biz_opaque_callback_data?: string;
  pricing?: { billable?: boolean; category?: string; pricing_model?: string; type?: string };
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
};

type WaMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  button?: { payload?: string; text?: string };
  interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
  context?: { from?: string; id?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  reaction?: { emoji?: string; message_id?: string };
};

type MessagesValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  messages?: WaMessage[];
  statuses?: WaStatus[];
  errors?: { code?: number; title?: string; message?: string }[];
};

type WebhookPayload = {
  object?: string;
  entry?: { id?: string; changes?: { field?: string; value?: Record<string, unknown> }[] }[];
};

/**
 * Persists the raw event first (idempotent on body hash), then processes it.
 * If processing fails, the worker retries from webhook_events.
 */
export async function ingestWebhook(rawBody: string, hint: { accountId?: string; organizationId?: string } = {}) {
  const payloadHash = sha256Hex(rawBody);
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { stored: false, reason: "invalid_json" as const };
  }
  const inserted = await db.webhookEvent.createMany({
    data: [{ payloadHash, payload: payload as Prisma.InputJsonValue, accountId: hint.accountId ?? null, organizationId: hint.organizationId ?? null }],
    skipDuplicates: true,
  });
  if (inserted.count === 0) return { stored: false, reason: "duplicate" as const };
  const event = await db.webhookEvent.findUniqueOrThrow({ where: { payloadHash } });
  await processWebhookEvent(event.id);
  return { stored: true, id: event.id };
}

export async function processWebhookEvent(eventId: string) {
  const event = await db.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event || event.processedAt) return;
  try {
    await processPayload(event.payload as WebhookPayload);
    await db.webhookEvent.update({ where: { id: eventId }, data: { processedAt: new Date(), attempts: { increment: 1 }, lastError: null } });
  } catch (err) {
    logger.error("webhook processing failed", { eventId, err });
    await db.webhookEvent.update({
      where: { id: eventId },
      data: { attempts: { increment: 1 }, lastError: (err instanceof Error ? err.message : String(err)).slice(0, 1000) },
    });
  }
}

/** Worker: retry unprocessed events (up to 10 attempts). */
export async function retryPendingWebhookEvents(limit = 50) {
  const pending = await db.webhookEvent.findMany({
    where: { processedAt: null, attempts: { lt: 10 }, receivedAt: { lt: new Date(Date.now() - 30_000) } },
    orderBy: { receivedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const e of pending) await processWebhookEvent(e.id);
  return pending.length;
}

async function processPayload(payload: WebhookPayload) {
  if (payload.object !== "whatsapp_business_account") return;
  for (const entry of payload.entry ?? []) {
    const wabaId = entry.id;
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      switch (change.field) {
        case "messages":
          await handleMessagesChange(wabaId, value as MessagesValue);
          break;
        case "message_template_status_update":
        case "message_template_quality_update":
          await handleTemplateUpdate(wabaId, value);
          break;
        case "phone_number_quality_update":
          await handleQualityUpdate(wabaId, value);
          break;
        case "business_capability_update":
          await handleCapabilityUpdate(wabaId, value);
          break;
        case "account_update":
        case "account_alerts":
        case "account_review_update":
          await handleAccountNotice(wabaId, change.field, value);
          break;
        default:
          logger.debug("unhandled webhook field", { field: change.field });
      }
    }
  }
}

async function accountByWaba(wabaId: string | undefined) {
  if (!wabaId) return null;
  return db.whatsappAccount.findFirst({ where: { wabaId } });
}

async function handleMessagesChange(wabaId: string | undefined, value: MessagesValue) {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;
  const phone = await db.whatsappPhoneNumber.findUnique({ where: { phoneNumberId }, include: { account: true } });
  if (!phone) {
    logger.warn("webhook for unknown phone number", { phoneNumberId });
    return;
  }
  // The phone must belong to the WABA in the envelope — never route across tenants.
  if (wabaId && phone.account.wabaId !== wabaId) {
    logger.warn("webhook WABA/phone mismatch", { wabaId, phoneNumberId });
    return;
  }
  await db.whatsappAccount.update({ where: { id: phone.accountId }, data: { lastWebhookAt: new Date() } });

  for (const st of value.statuses ?? []) await handleStatus(phone.organizationId, st);
  const profileNames = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
  for (const m of value.messages ?? []) await handleInbound(phone, m, profileNames.get(m.from));
}

export async function handleStatus(orgId: string, st: WaStatus) {
  const incoming = st.status as IncomingStatus;
  if (!["sent", "delivered", "read", "failed"].includes(incoming)) return;

  let msg = await db.outboundMessage.findUnique({ where: { wamid: st.id } });
  if (!msg && st.biz_opaque_callback_data) {
    // Reconciles messages whose wamid we never stored (crash after Meta accepted).
    msg = await db.outboundMessage.findUnique({ where: { bizOpaqueId: st.biz_opaque_callback_data } });
  }
  if (!msg || msg.organizationId !== orgId) return; // not sent by this system / other tenant

  const occurredAt = new Date(Number(st.timestamp) * 1000 || Date.now());
  const err = st.errors?.[0];
  const dedupe = await db.messageEvent.createMany({
    data: [
      {
        organizationId: orgId,
        messageId: msg.id,
        type: incoming,
        occurredAt,
        dedupeKey: `${st.id}:${incoming}:${st.timestamp}`,
        detail: { pricing: st.pricing ?? null, error: err ?? null } as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  });
  if (dedupe.count === 0) return; // duplicate delivery of the same event

  const next = nextOutboundStatus(msg.status, incoming);
  const data: Prisma.OutboundMessageUpdateInput = {};
  if (!msg.wamid) {
    data.wamid = st.id;
    data.submittedAt = msg.submittedAt ?? occurredAt;
    data.lockedAt = null;
    data.lockedBy = null;
  }
  if (next) data.status = next;
  if (incoming === "sent" && !msg.sentAt) data.sentAt = occurredAt;
  const firstDelivery = (incoming === "delivered" || incoming === "read") && !msg.deliveredAt;
  if (firstDelivery) data.deliveredAt = occurredAt; // read implies delivered
  const firstRead = incoming === "read" && !msg.readAt;
  if (firstRead) data.readAt = occurredAt;
  if (incoming === "failed" && next === "FAILED") {
    data.failedAt = occurredAt;
    data.errorCode = err?.code !== undefined ? String(err.code) : "UNKNOWN";
    data.errorTitle = err?.title?.slice(0, 200) ?? null;
    data.errorDetail = (err?.error_data?.details ?? err?.message ?? "")?.slice(0, 500) || null;
  }
  if (st.pricing) {
    data.billable = st.pricing.billable ?? null;
    data.pricingCategory = st.pricing.category ?? null;
  }
  if (Object.keys(data).length) await db.outboundMessage.update({ where: { id: msg.id }, data });

  // Engagement counters track business-initiated messages only (not service replies/confirmations).
  if (msg.contactId && (firstDelivery || firstRead) && (msg.kind === "CAMPAIGN" || msg.kind === "TEST")) {
    await db.contact.updateMany({
      where: { id: msg.contactId },
      data: { ...(firstDelivery ? { deliveredCount: { increment: 1 } } : {}), ...(firstRead ? { readCount: { increment: 1 } } : {}) },
    });
  }
  if (incoming === "failed" && err?.code === 131050 && msg.toPhone) {
    await suppressPhone(systemContext(orgId, "meta-opt-out"), { phoneE164: msg.toPhone, reason: "META_USER_STOPPED_MARKETING", detail: "Meta error 131050" });
  }
  if (next) {
    await emitEvent(orgId, "message.status", { messageId: msg.id, campaignId: msg.campaignId, contactId: msg.contactId, status: next, at: occurredAt.toISOString() });
  }
}

type PhoneWithAccount = { id: string; organizationId: string; accountId: string; phoneNumberId: string };

function inboundText(m: WaMessage): { text: string | null; buttonPayload: string | null; buttonText: string | null } {
  switch (m.type) {
    case "text":
      return { text: m.text?.body ?? null, buttonPayload: null, buttonText: null };
    case "button":
      return { text: m.button?.text ?? null, buttonPayload: m.button?.payload ?? null, buttonText: m.button?.text ?? null };
    case "interactive": {
      const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
      return { text: r?.title ?? null, buttonPayload: r?.id ?? null, buttonText: r?.title ?? null };
    }
    case "image":
      return { text: m.image?.caption ?? "[תמונה]", buttonPayload: null, buttonText: null };
    case "video":
      return { text: m.video?.caption ?? "[וידאו]", buttonPayload: null, buttonText: null };
    case "document":
      return { text: m.document?.caption ?? `[מסמך${m.document?.filename ? `: ${m.document.filename}` : ""}]`, buttonPayload: null, buttonText: null };
    case "audio":
      return { text: "[הודעה קולית]", buttonPayload: null, buttonText: null };
    case "reaction":
      return { text: m.reaction?.emoji ? `[תגובה ${m.reaction.emoji}]` : "[תגובה]", buttonPayload: null, buttonText: null };
    default:
      return { text: `[${m.type}]`, buttonPayload: null, buttonText: null };
  }
}

export async function handleInbound(phone: PhoneWithAccount, m: WaMessage, profileName?: string) {
  const orgId = phone.organizationId;
  if (await db.inboundMessage.findUnique({ where: { wamid: m.id }, select: { id: true } })) return; // duplicate

  const e164 = waIdToE164(m.from);
  const settings = await getSettings(orgId);
  const keywords = unsubscribeKeywords(settings);
  const receivedAt = new Date(Number(m.timestamp) * 1000 || Date.now());

  let contact = await db.contact.findUnique({ where: { organizationId_phoneE164: { organizationId: orgId, phoneE164: e164 } } });
  if (!contact) {
    const suppressed = !!(await db.suppressionEntry.findFirst({ where: { organizationId: orgId, phoneHash: hashPhone(e164), liftedAt: null } }));
    contact = await db.contact.upsert({
      where: { organizationId_phoneE164: { organizationId: orgId, phoneE164: e164 } },
      update: {},
      create: {
        organizationId: orgId,
        phoneE164: e164,
        name: profileName?.slice(0, 200) || null,
        source: "הודעה נכנסת ב-WhatsApp",
        isSuppressed: suppressed,
        consentStatus: suppressed ? "REVOKED" : "UNKNOWN",
      },
    });
    await emitEvent(orgId, "contact.created", { contactId: contact.id, phone: e164, source: contact.source });
  } else if (!contact.name && profileName) {
    await db.contact.update({ where: { id: contact.id }, data: { name: profileName.slice(0, 200) } });
  }

  const conversation = await db.conversation.upsert({
    where: { phoneNumberId_contactId: { phoneNumberId: phone.id, contactId: contact.id } },
    update: {},
    create: { organizationId: orgId, phoneNumberId: phone.id, contactId: contact.id },
  });

  const { text, buttonPayload, buttonText } = inboundText(m);
  let campaignId: string | null = null;
  if (m.context?.id) {
    const replied = await db.outboundMessage.findUnique({ where: { wamid: m.context.id }, select: { campaignId: true, organizationId: true } });
    if (replied?.organizationId === orgId) campaignId = replied.campaignId;
  }
  const isButton = m.type === "button" || m.type === "interactive";
  const isUnsub = isButton ? isUnsubscribeButton(buttonPayload, buttonText, keywords) : m.type === "text" && isUnsubscribeText(text, keywords);

  let inbound;
  try {
    inbound = await db.inboundMessage.create({
      data: {
        organizationId: orgId,
        conversationId: conversation.id,
        contactId: contact.id,
        phoneNumberId: phone.id,
        wamid: m.id,
        type: m.type,
        text: text?.slice(0, 4096) ?? null,
        buttonPayload: buttonPayload?.slice(0, 256) ?? null,
        buttonText: buttonText?.slice(0, 256) ?? null,
        contextWamid: m.context?.id ?? null,
        raw: { type: m.type } as Prisma.InputJsonValue,
        isUnsubscribe: isUnsub,
        campaignId,
        receivedAt,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return; // concurrent duplicate
    throw err;
  }

  await db.contact.update({ where: { id: contact.id }, data: { lastInboundAt: receivedAt } });
  await db.conversation.update({
    where: { id: conversation.id },
    data: {
      lastInboundAt: receivedAt,
      lastMessageAt: receivedAt,
      unreadCount: { increment: 1 },
      ...(conversation.status === "HANDLED" ? { status: "OPEN" as const } : {}),
    },
  });

  if (isUnsub) {
    const ctx = systemContext(orgId, "unsubscribe-webhook");
    const res = await suppressPhone(ctx, {
      phoneE164: e164,
      reason: isButton ? "QUICK_REPLY_BUTTON" : "KEYWORD_REPLY",
      detail: (text ?? buttonPayload ?? "").slice(0, 200),
      sourceMessageId: inbound.id,
    });
    await db.conversation.update({ where: { id: conversation.id }, data: { status: "NOT_INTERESTED" } });
    // Confirmation is a free-form reply inside the 24h service window that the user's message just opened.
    if (res.created && settings.sendUnsubscribeConfirmation && settings.unsubscribeConfirmationText.trim()) {
      await db.outboundMessage.create({
        data: {
          organizationId: orgId,
          kind: "UNSUBSCRIBE_CONFIRMATION",
          contactId: contact.id,
          conversationId: conversation.id,
          phoneNumberId: phone.id,
          toPhone: e164,
          toPhoneHash: hashPhone(e164),
          payload: buildTextPayload(e164, settings.unsubscribeConfirmationText) as Prisma.InputJsonValue,
          maxAttempts: 3,
        },
      });
    }
  } else {
    await runAutomations(orgId, { contactId: contact.id, conversationId: conversation.id, inboundId: inbound.id, text, buttonPayload, buttonText, isButton, campaignId });
  }

  await emitEvent(orgId, "inbound.message", {
    contactId: contact.id,
    phone: e164,
    conversationId: conversation.id,
    type: m.type,
    text,
    buttonPayload,
    campaignId,
    isUnsubscribe: isUnsub,
    receivedAt: receivedAt.toISOString(),
  });
}

async function handleTemplateUpdate(wabaId: string | undefined, value: Record<string, unknown>) {
  const account = await accountByWaba(wabaId);
  if (!account) return;
  await applyTemplateStatusWebhook(account.id, value as Parameters<typeof applyTemplateStatusWebhook>[1]);
}

async function handleQualityUpdate(wabaId: string | undefined, value: Record<string, unknown>) {
  const account = await accountByWaba(wabaId);
  if (!account) return;
  const display = String(value.display_phone_number ?? "").replace(/\D/g, "");
  const phones = await db.whatsappPhoneNumber.findMany({ where: { accountId: account.id } });
  const phone = phones.find((p) => (p.displayPhoneNumber ?? "").replace(/\D/g, "") === display);
  const event = String(value.event ?? "");
  if (phone) {
    const quality = event === "FLAGGED" ? "RED" : event === "UNFLAGGED" ? "GREEN" : phone.qualityRating;
    const limit = value.max_daily_conversations_per_business ?? value.current_limit;
    await db.whatsappPhoneNumber.update({
      where: { id: phone.id },
      data: { qualityRating: quality, ...(limit ? { messagingLimitTier: String(limit) } : {}) },
    });
  }
  await audit(systemContext(account.organizationId, "meta-webhook"), "account.quality_alert", { type: "whatsapp_account", id: account.id }, { event, display_phone_number: value.display_phone_number });
  if (event === "FLAGGED" || event === "DOWNGRADE") {
    // Protect the number: pause running campaigns on it.
    if (phone) {
      await db.campaign.updateMany({
        where: { organizationId: account.organizationId, phoneNumberId: phone.id, status: "RUNNING" },
        data: { status: "PAUSED", pausedReason: `הושהה אוטומטית: אירוע איכות ${event} מ-Meta` },
      });
    }
  }
}

async function handleCapabilityUpdate(wabaId: string | undefined, value: Record<string, unknown>) {
  const account = await accountByWaba(wabaId);
  if (!account) return;
  const limit = value.max_daily_conversations_per_business ?? value.max_daily_conversation_per_phone;
  if (limit !== undefined) {
    await db.whatsappPhoneNumber.updateMany({ where: { accountId: account.id }, data: { messagingLimitTier: String(limit) } });
  }
}

async function handleAccountNotice(wabaId: string | undefined, field: string, value: Record<string, unknown>) {
  const account = await accountByWaba(wabaId);
  if (!account) return;
  await audit(systemContext(account.organizationId, "meta-webhook"), "account.quality_alert", { type: "whatsapp_account", id: account.id }, { field, value });
  const event = String(value.event ?? value.ban_info ?? "");
  if (/DISABLED|BANNED|RESTRICT/i.test(event)) {
    await db.whatsappAccount.update({ where: { id: account.id }, data: { status: "ERROR", statusMessage: `Meta: ${field} ${event}`.slice(0, 500) } });
    await db.campaign.updateMany({
      where: { organizationId: account.organizationId, accountId: account.id, status: "RUNNING" },
      data: { status: "PAUSED", pausedReason: `הושהה אוטומטית: ${field} ${event}` },
    });
  }
}
