import { db } from "../db";
import { logger } from "../logger";
import { emitEvent } from "../services/outgoing-webhooks";
import { getSettings, isWithinSendingWindow, type SendingWindow } from "../services/settings";
import { parseMessagingLimit, type MetaClient } from "../meta/client";
import { claimMessages, processClaimed, uniqueRecipientsLast24h } from "./sender";

/** SCHEDULED → RUNNING when due; QUEUED → RUNNING; RUNNING → COMPLETED when nothing is left. */
export async function advanceCampaigns() {
  const now = new Date();
  await db.campaign.updateMany({ where: { status: "SCHEDULED", scheduledAt: { lte: now } }, data: { status: "RUNNING", startedAt: now } });
  await db.campaign.updateMany({ where: { status: "QUEUED" }, data: { status: "RUNNING", startedAt: now } });

  const running = await db.campaign.findMany({ where: { status: "RUNNING" }, select: { id: true, organizationId: true, name: true } });
  for (const c of running) {
    const open = await db.outboundMessage.count({ where: { campaignId: c.id, status: { in: ["QUEUED", "SENDING"] } } });
    if (open > 0) continue;
    const done = await db.campaign.updateMany({ where: { id: c.id, status: "RUNNING" }, data: { status: "COMPLETED", completedAt: new Date() } });
    if (done.count) await emitEvent(c.organizationId, "campaign.completed", { campaignId: c.id, name: c.name });
  }
}

const TICK_MS = 1000;

/**
 * One sending tick for one sender number: acquires the number's lease, then
 * paces claimed messages at messagesPerSecond, respecting the org's rolling
 * 24h unique-recipient cap and sending window.
 */
export async function sendTickForPhone(workerId: string, phoneDbId: string, clientCache: Map<string, MetaClient>): Promise<number> {
  const lease = await db.$executeRaw`
    UPDATE whatsapp_phone_numbers SET "sendLeaseOwner" = ${workerId}, "sendLeaseUntil" = now() + interval '30 seconds'
    WHERE id = ${phoneDbId} AND ("sendLeaseUntil" IS NULL OR "sendLeaseUntil" < now() OR "sendLeaseOwner" = ${workerId})`;
  if (lease === 0) return 0;

  const phone = await db.whatsappPhoneNumber.findUnique({ where: { id: phoneDbId } });
  if (!phone) return 0;
  const settings = await getSettings(phone.organizationId);
  const mps = Math.max(1, Math.min(80, phone.messagesPerSecond ?? settings.defaultMessagesPerSecond));
  const windowOpen = isWithinSendingWindow(settings.sendingWindow as SendingWindow, settings.timezone);
  const tierLimit = parseMessagingLimit(phone.messagingLimitTier);
  const cap = Math.min(settings.safetyRollingCap, tierLimit ?? settings.safetyRollingCap);
  const used = await uniqueRecipientsLast24h(phone.organizationId);
  const campaignLimit = Math.max(0, cap - used);

  const claimed = await claimMessages(workerId, phoneDbId, { limit: mps, campaignLimit, windowOpen });
  if (claimed.length === 0) return 0;
  const spacing = TICK_MS / mps;
  let rateLimited = false;
  for (const [i, msg] of claimed.entries()) {
    if (rateLimited) {
      // Back off the rest of the batch instead of hammering Meta.
      await db.outboundMessage.updateMany({
        where: { id: msg.id, status: "SENDING", lockedBy: workerId },
        data: { status: "QUEUED", attempts: { decrement: 1 }, nextAttemptAt: new Date(Date.now() + 60_000), lockedAt: null, lockedBy: null },
      });
      continue;
    }
    const started = Date.now();
    const outcome = await processClaimed(msg, workerId, clientCache);
    if (outcome.errorClass === "RATE_LIMITED" || outcome.status === "account_error") rateLimited = true;
    const wait = spacing - (Date.now() - started);
    if (wait > 0 && i < claimed.length - 1) await new Promise((r) => setTimeout(r, wait));
  }
  if (rateLimited) logger.warn("rate limited / account error — batch deferred", { phoneDbId });
  return claimed.length;
}

export async function phonesWithDueMessages(): Promise<string[]> {
  const rows = await db.$queryRaw<{ phoneNumberId: string }[]>`
    SELECT DISTINCT "phoneNumberId" FROM outbound_messages WHERE status = 'QUEUED' AND "nextAttemptAt" <= now() LIMIT 200`;
  return rows.map((r) => r.phoneNumberId);
}
