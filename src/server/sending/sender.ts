import type { OutboundMessage, Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { hashPhone } from "../crypto";
import { systemContext } from "../context";
import { audit } from "../audit";
import { logger } from "../logger";
import { MetaApiError, type MetaClient } from "../meta/client";
import { backoffMs, type ErrorClass } from "../meta/errors";
import { metaClientFor } from "../services/accounts";
import { suppressPhone } from "../services/suppression";
import { getSettings } from "../services/settings";

export const SERVICE_WINDOW_MS = 24 * 3600_000;
/** A message stuck in SENDING longer than this is considered crashed mid-flight. */
export const STUCK_SENDING_MS = 2 * 60_000;

type ClaimedRow = OutboundMessage;

/**
 * Atomically claims due messages for one sender number. Uses
 * FOR UPDATE SKIP LOCKED so concurrent workers never claim the same row.
 * Non-campaign messages (tests, service replies, unsubscribe confirmations)
 * are claimed first; campaign messages only for RUNNING campaigns, inside the
 * sending window (unless the campaign opted out of it).
 */
export async function claimMessages(
  workerId: string,
  phoneNumberDbId: string,
  opts: { limit: number; campaignLimit: number; windowOpen: boolean },
): Promise<ClaimedRow[]> {
  if (opts.limit <= 0) return [];
  const priority = await db.$queryRaw<ClaimedRow[]>`
    UPDATE outbound_messages SET status = 'SENDING', "lockedAt" = now(), "lockedBy" = ${workerId},
           attempts = attempts + 1, "updatedAt" = now()
    WHERE id IN (
      SELECT m.id FROM outbound_messages m
      WHERE m.status = 'QUEUED' AND m."nextAttemptAt" <= now() AND m."phoneNumberId" = ${phoneNumberDbId}
        AND m.kind <> 'CAMPAIGN'
      ORDER BY m."nextAttemptAt", m.id
      LIMIT ${opts.limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
  const remaining = Math.min(opts.limit - priority.length, opts.campaignLimit);
  if (remaining <= 0) return priority;
  const campaign = await db.$queryRaw<ClaimedRow[]>`
    UPDATE outbound_messages SET status = 'SENDING', "lockedAt" = now(), "lockedBy" = ${workerId},
           attempts = attempts + 1, "updatedAt" = now()
    WHERE id IN (
      SELECT m.id FROM outbound_messages m
      JOIN campaigns c ON c.id = m."campaignId"
      WHERE m.status = 'QUEUED' AND m."nextAttemptAt" <= now() AND m."phoneNumberId" = ${phoneNumberDbId}
        AND m.kind = 'CAMPAIGN' AND c.status = 'RUNNING'
        AND (${opts.windowOpen} OR c."respectSendingWindow" = false)
      ORDER BY m."nextAttemptAt", m.id
      LIMIT ${remaining}
      FOR UPDATE OF m SKIP LOCKED
    )
    RETURNING *`;
  return [...priority, ...campaign];
}

/** Claims one specific message (used for immediate test sends). */
export async function claimMessageById(workerId: string, messageId: string): Promise<ClaimedRow | null> {
  const rows = await db.$queryRaw<ClaimedRow[]>`
    UPDATE outbound_messages SET status = 'SENDING', "lockedAt" = now(), "lockedBy" = ${workerId},
           attempts = attempts + 1, "updatedAt" = now()
    WHERE id = ${messageId} AND status = 'QUEUED'
    RETURNING *`;
  return rows[0] ?? null;
}

async function addEvent(msg: { id: string; organizationId: string }, type: string, dedupeKey: string, detail?: Record<string, unknown>) {
  await db.messageEvent.createMany({
    data: [{ organizationId: msg.organizationId, messageId: msg.id, type, occurredAt: new Date(), dedupeKey, detail: (detail ?? undefined) as Prisma.InputJsonValue | undefined }],
    skipDuplicates: true,
  });
}

async function finishWithoutSending(msg: ClaimedRow, workerId: string, status: "SKIPPED" | "FAILED" | "CANCELLED", code: string, detail: string) {
  await db.outboundMessage.updateMany({
    where: { id: msg.id, lockedBy: workerId, status: "SENDING" },
    data: { status, errorCode: code, errorDetail: detail, lockedAt: null, lockedBy: null, failedAt: status === "FAILED" ? new Date() : undefined },
  });
  await addEvent(msg, status.toLowerCase(), `${status.toLowerCase()}:${msg.id}:${msg.attempts}`, { code });
}

/** Final gate immediately before the API call. Returns a blocking reason or null. */
export async function preSendCheck(msg: ClaimedRow): Promise<{ status: "SKIPPED" | "FAILED" | "CANCELLED"; code: string; detail: string } | null> {
  const suppressed = await db.suppressionEntry.findFirst({
    where: { organizationId: msg.organizationId, phoneHash: msg.toPhoneHash, liftedAt: null },
    select: { id: true },
  });

  if (msg.kind === "CAMPAIGN") {
    if (msg.campaignId) {
      const c = await db.campaign.findUnique({ where: { id: msg.campaignId }, select: { status: true } });
      if (!c || c.status === "CANCELLED") return { status: "CANCELLED", code: "CAMPAIGN_CANCELLED", detail: "הקמפיין בוטל" };
    }
    if (!msg.contactId) return { status: "SKIPPED", code: "CONTACT_DELETED", detail: "איש הקשר נמחק" };
    const contact = await db.contact.findUnique({ where: { id: msg.contactId }, select: { isSuppressed: true, consentStatus: true } });
    if (!contact) return { status: "SKIPPED", code: "CONTACT_DELETED", detail: "איש הקשר נמחק" };
    if (suppressed || contact.isSuppressed) return { status: "SKIPPED", code: "SUPPRESSED", detail: "הנמען ביקש הסרה" };
    if (contact.consentStatus !== "GRANTED") return { status: "SKIPPED", code: "NO_CONSENT", detail: "אין הסכמה תקפה" };
    return null;
  }
  if (msg.kind === "TEST") {
    if (suppressed) return { status: "SKIPPED", code: "SUPPRESSED", detail: "המספר ברשימת ההסרה" };
    const settings = await getSettings(msg.organizationId);
    if (!msg.toPhone || !settings.testRecipients.includes(msg.toPhone)) {
      return { status: "FAILED", code: "NOT_TEST_RECIPIENT", detail: "המספר אינו מוגדר כמספר בדיקה" };
    }
    return null;
  }
  // SERVICE_REPLY / UNSUBSCRIBE_CONFIRMATION: free-form messages only inside the 24h customer-service window.
  const convo = msg.conversationId ? await db.conversation.findUnique({ where: { id: msg.conversationId }, select: { lastInboundAt: true } }) : null;
  if (!convo?.lastInboundAt || Date.now() - convo.lastInboundAt.getTime() > SERVICE_WINDOW_MS) {
    return { status: "FAILED", code: "WINDOW_CLOSED", detail: "חלון השירות של 24 שעות נסגר" };
  }
  // Service replies to someone who opted out of marketing are still allowed (they wrote to us);
  // they are agent-typed free text, never templates/marketing.
  return null;
}

export type SendOutcome = { status: "submitted" | "retry" | "failed" | "skipped" | "uncertain" | "account_error"; errorClass?: ErrorClass };

/** Sends one claimed message and records the outcome. Never throws for API errors. */
export async function processClaimed(msg: ClaimedRow, workerId: string, clientCache = new Map<string, MetaClient>()): Promise<SendOutcome> {
  const block = await preSendCheck(msg);
  if (block) {
    await finishWithoutSending(msg, workerId, block.status, block.code, block.detail);
    return { status: block.status === "FAILED" ? "failed" : "skipped" };
  }

  const phone = await db.whatsappPhoneNumber.findUnique({ where: { id: msg.phoneNumberId }, include: { account: true } });
  if (!phone) {
    await finishWithoutSending(msg, workerId, "FAILED", "NO_SENDER", "מספר השולח נמחק");
    return { status: "failed" };
  }

  let client = clientCache.get(phone.accountId);
  try {
    if (!client) {
      client = metaClientFor(phone.account);
      clientCache.set(phone.accountId, client);
    }
  } catch {
    return handleAccountError(msg, workerId, phone.accountId, phone.id, "לא הוגדר אסימון גישה לחשבון");
  }

  const body = { ...(msg.payload as Record<string, unknown>), biz_opaque_callback_data: msg.bizOpaqueId };
  try {
    const { wamid } = await client.sendMessage(phone.phoneNumberId, body);
    await recordSubmitted(msg, workerId, wamid);
    return { status: "submitted" };
  } catch (err) {
    if (!(err instanceof MetaApiError)) {
      // Unknown local failure after the request may have been sent: be conservative.
      logger.error("unexpected send error", { messageId: msg.id, err });
      await markUncertain(msg, workerId, "LOCAL_ERROR");
      return { status: "uncertain" };
    }
    return handleMetaError(msg, workerId, err, phone);
  }
}

async function recordSubmitted(msg: ClaimedRow, workerId: string, wamid: string) {
  const now = new Date();
  const moved = await db.outboundMessage.updateMany({
    where: { id: msg.id, status: { in: ["SENDING", "UNCERTAIN"] } },
    data: { status: "SUBMITTED", wamid, submittedAt: now, lockedAt: null, lockedBy: null, errorCode: null, errorTitle: null, errorDetail: null },
  });
  if (moved.count === 0) {
    // A status webhook (matched via biz_opaque_callback_data) already advanced it.
    await db.outboundMessage.updateMany({ where: { id: msg.id, wamid: null }, data: { wamid, submittedAt: now, lockedAt: null, lockedBy: null } });
  }
  await addEvent(msg, "submitted", `submitted:${msg.id}`, { wamid });
  if (msg.contactId && (msg.kind === "CAMPAIGN" || msg.kind === "TEST")) {
    await db.contact.updateMany({ where: { id: msg.contactId }, data: { sentCount: { increment: 1 }, lastSentAt: now } });
  }
}

async function markUncertain(msg: ClaimedRow, workerId: string, code: string) {
  await db.outboundMessage.updateMany({
    where: { id: msg.id, status: "SENDING" },
    data: { status: "UNCERTAIN", errorCode: code, errorDetail: "לא התקבל אישור מ-Meta. ההודעה לא תישלח שוב אוטומטית.", lockedAt: null, lockedBy: null },
  });
  await addEvent(msg, "uncertain", `uncertain:${msg.id}:${msg.attempts}`, { code });
}

async function handleMetaError(
  msg: ClaimedRow,
  workerId: string,
  err: MetaApiError,
  phone: { id: string; accountId: string; phoneNumberId: string },
): Promise<SendOutcome> {
  const code = err.code !== null ? String(err.code) : err.httpStatus ? `HTTP_${err.httpStatus}` : "NETWORK";
  const detail = (err.details || err.message).slice(0, 500);
  switch (err.classification) {
    case "UNCERTAIN":
      await markUncertain(msg, workerId, code);
      return { status: "uncertain", errorClass: "UNCERTAIN" };
    case "RETRYABLE":
    case "RATE_LIMITED": {
      if (msg.attempts >= msg.maxAttempts) {
        await db.outboundMessage.updateMany({
          where: { id: msg.id, status: "SENDING" },
          data: { status: "FAILED", errorCode: code, errorTitle: "MAX_ATTEMPTS", errorDetail: detail, failedAt: new Date(), lockedAt: null, lockedBy: null },
        });
        await addEvent(msg, "failed", `failed:${msg.id}:${msg.attempts}`, { code, reason: "max_attempts" });
        return { status: "failed", errorClass: err.classification };
      }
      const next = new Date(Date.now() + backoffMs(msg.attempts, err.classification));
      await db.outboundMessage.updateMany({
        where: { id: msg.id, status: "SENDING" },
        data: { status: "QUEUED", nextAttemptAt: next, errorCode: code, errorDetail: detail, lockedAt: null, lockedBy: null },
      });
      await addEvent(msg, "retry", `retry:${msg.id}:${msg.attempts}`, { code, nextAttemptAt: next.toISOString() });
      return { status: "retry", errorClass: err.classification };
    }
    case "RECIPIENT_OPTED_OUT": {
      await db.outboundMessage.updateMany({
        where: { id: msg.id, status: "SENDING" },
        data: { status: "FAILED", errorCode: code, errorDetail: detail, failedAt: new Date(), lockedAt: null, lockedBy: null },
      });
      await addEvent(msg, "failed", `failed:${msg.id}:${msg.attempts}`, { code });
      if (msg.toPhone) {
        await suppressPhone(systemContext(msg.organizationId, "meta-opt-out"), {
          phoneE164: msg.toPhone,
          reason: "META_USER_STOPPED_MARKETING",
          detail: `Meta error ${code}`,
        });
      }
      return { status: "failed", errorClass: "RECIPIENT_OPTED_OUT" };
    }
    case "ACCOUNT":
      return handleAccountError(msg, workerId, phone.accountId, phone.id, `${detail} (${code})`);
    default:
      await db.outboundMessage.updateMany({
        where: { id: msg.id, status: "SENDING" },
        data: { status: "FAILED", errorCode: code, errorTitle: err.message.slice(0, 200), errorDetail: detail, failedAt: new Date(), lockedAt: null, lockedBy: null },
      });
      await addEvent(msg, "failed", `failed:${msg.id}:${msg.attempts}`, { code });
      return { status: "failed", errorClass: "PERMANENT" };
  }
}

/** Account/token/template-level failure: the message is not at fault — requeue it and pause the campaign. */
async function handleAccountError(msg: ClaimedRow, workerId: string, accountId: string, phoneId: string, reason: string): Promise<SendOutcome> {
  if (msg.kind === "CAMPAIGN" && msg.campaignId) {
    await db.outboundMessage.updateMany({
      where: { id: msg.id, status: "SENDING" },
      data: { status: "QUEUED", attempts: { decrement: 1 }, nextAttemptAt: new Date(Date.now() + 60_000), errorDetail: reason, lockedAt: null, lockedBy: null },
    });
    const paused = await db.campaign.updateMany({
      where: { id: msg.campaignId, status: "RUNNING" },
      data: { status: "PAUSED", pausedReason: `הושהה אוטומטית: ${reason}`.slice(0, 500) },
    });
    if (paused.count) {
      await audit(systemContext(msg.organizationId, "sender"), "campaign.auto_pause", { type: "campaign", id: msg.campaignId }, { reason });
    }
  } else {
    await db.outboundMessage.updateMany({
      where: { id: msg.id, status: "SENDING" },
      data: { status: "FAILED", errorCode: "ACCOUNT", errorDetail: reason, failedAt: new Date(), lockedAt: null, lockedBy: null },
    });
    await addEvent(msg, "failed", `failed:${msg.id}:${msg.attempts}`, { code: "ACCOUNT" });
  }
  await db.whatsappAccount.update({ where: { id: accountId }, data: { status: "ERROR", statusMessage: reason.slice(0, 500) } }).catch(() => {});
  logger.warn("account-level send error", { accountId, phoneId, reason });
  return { status: "account_error", errorClass: "ACCOUNT" };
}

/**
 * Crash recovery: anything left in SENDING past the stuck threshold may or
 * may not have reached Meta. It is marked UNCERTAIN (never resent
 * automatically); a status webhook carrying its biz_opaque_callback_data will
 * reconcile it.
 */
export async function recoverStuckMessages(): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_SENDING_MS);
  const stuck = await db.outboundMessage.findMany({
    where: { status: "SENDING", lockedAt: { lt: cutoff } },
    select: { id: true, organizationId: true, attempts: true },
    take: 1000,
  });
  for (const m of stuck) {
    const res = await db.outboundMessage.updateMany({
      where: { id: m.id, status: "SENDING", lockedAt: { lt: cutoff } },
      data: { status: "UNCERTAIN", errorCode: "UNCERTAIN", errorDetail: "העיבוד נקטע (נפילת שרת?) — ממתין לאישור מ-Meta", lockedAt: null, lockedBy: null },
    });
    if (res.count) await addEvent(m, "uncertain", `uncertain:${m.id}:${m.attempts}`, { reason: "stuck_sending" });
  }
  return stuck.length;
}

/** Count of distinct business-initiated recipients in the moving 24h window (Meta messaging limit semantics). */
export async function uniqueRecipientsLast24h(orgId: string): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(DISTINCT "toPhoneHash") AS n FROM outbound_messages
    WHERE "organizationId" = ${orgId} AND kind IN ('CAMPAIGN', 'TEST')
      AND "submittedAt" > now() - interval '24 hours'`;
  return Number(rows[0]?.n ?? 0);
}

export function phoneHashFor(e164: string) {
  return hashPhone(e164);
}
