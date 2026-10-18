import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "../db";
import { decryptSecret, encryptSecret, hmacSha256Hex, randomToken } from "../crypto";
import { assertCan, type OrgContext } from "../context";
import { audit } from "../audit";
import { NotFoundError, UserError } from "../rbac";
import { logger } from "../logger";

export const OUTGOING_EVENTS = [
  "contact.created",
  "contact.unsubscribed",
  "inbound.message",
  "lead.created",
  "lead.updated",
  "message.status",
  "campaign.completed",
  "link.clicked",
] as const;
export type OutgoingEvent = (typeof OUTGOING_EVENTS)[number];

export const OUTGOING_EVENT_LABELS: Record<OutgoingEvent, string> = {
  "contact.created": "איש קשר נוצר",
  "contact.unsubscribed": "בקשת הסרה",
  "inbound.message": "הודעה נכנסת",
  "lead.created": "ליד חדש",
  "lead.updated": "ליד עודכן",
  "message.status": "שינוי סטטוס הודעה",
  "campaign.completed": "קמפיין הסתיים",
  "link.clicked": "הקלקה על קישור",
};

/** Queues a delivery for every active endpoint subscribed to `event`. Never blocks the caller on HTTP. */
export async function emitEvent(orgId: string, event: OutgoingEvent, data: Record<string, unknown>, tx?: Tx) {
  const client = tx ?? db;
  const endpoints = await client.webhookEndpoint.findMany({
    where: { organizationId: orgId, isActive: true, events: { has: event } },
    select: { id: true },
  });
  if (endpoints.length === 0) return;
  const payload = { event, occurredAt: new Date().toISOString(), data } as Prisma.InputJsonValue;
  await client.webhookDelivery.createMany({
    data: endpoints.map((e) => ({ organizationId: orgId, endpointId: e.id, event, payload })),
  });
}

/** Signature header: "t=<unix>,v1=<hex hmac of `${t}.${body}`>" — same scheme as Stripe. */
export function signOutgoing(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

const MAX_DELIVERY_ATTEMPTS = 8;

export async function deliverPendingWebhooks(fetchImpl: typeof fetch = fetch, batch = 25) {
  const due = await db.webhookDelivery.findMany({
    where: { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: new Date() } },
    include: { endpoint: true },
    orderBy: { nextAttemptAt: "asc" },
    take: batch,
  });
  for (const d of due) {
    // Optimistic claim so parallel workers don't double-deliver.
    const claimed = await db.webhookDelivery.updateMany({
      where: { id: d.id, attempts: d.attempts, status: d.status },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 5 * 60_000) },
    });
    if (claimed.count === 0) continue;
    if (!d.endpoint.isActive) {
      await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "DEAD", lastError: "endpoint disabled" } });
      continue;
    }
    const body = JSON.stringify({ id: d.id, ...(d.payload as object) });
    let responseCode: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetchImpl(d.endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-wcm-event": d.event,
          "x-wcm-delivery": d.id,
          "x-wcm-signature": signOutgoing(decryptSecret(d.endpoint.secretEnc), body),
        },
        body,
        signal: AbortSignal.timeout(10_000),
        redirect: "manual",
      });
      responseCode = res.status;
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const attempts = d.attempts + 1;
    if (!error) {
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: { status: "SUCCEEDED", responseCode, deliveredAt: new Date(), lastError: null },
      });
    } else {
      const dead = attempts >= MAX_DELIVERY_ATTEMPTS;
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: {
          status: dead ? "DEAD" : "FAILED",
          responseCode,
          lastError: error.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + Math.min(6 * 3600_000, 30_000 * 2 ** attempts)),
        },
      });
      if (dead) logger.warn("outgoing webhook dead-lettered", { deliveryId: d.id, endpointId: d.endpointId });
    }
  }
  return due.length;
}

function validateEndpointUrl(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new UserError("כתובת URL לא תקינה");
  }
  if (u.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && u.protocol === "http:")) {
    throw new UserError("נדרשת כתובת HTTPS");
  }
  if (process.env.NODE_ENV === "production" && /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname)) {
    throw new UserError("לא ניתן לשלוח Webhooks לכתובות פנימיות");
  }
}

export async function createWebhookEndpoint(ctx: OrgContext, input: { name: string; url: string; events: string[] }) {
  assertCan(ctx, "automations:write");
  validateEndpointUrl(input.url);
  const events = input.events.filter((e): e is OutgoingEvent => (OUTGOING_EVENTS as readonly string[]).includes(e));
  if (events.length === 0) throw new UserError("יש לבחור לפחות אירוע אחד");
  const secret = `whsec_${randomToken(24)}`;
  const endpoint = await db.webhookEndpoint.create({
    data: { organizationId: ctx.orgId, name: input.name, url: input.url, events, secretEnc: encryptSecret(secret) },
  });
  await audit(ctx, "webhook.create", { type: "webhook_endpoint", id: endpoint.id }, { url: input.url, events });
  return { endpoint, secret };
}

export async function deleteWebhookEndpoint(ctx: OrgContext, id: string) {
  assertCan(ctx, "automations:write");
  const ep = await db.webhookEndpoint.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!ep) throw new NotFoundError();
  await db.webhookEndpoint.delete({ where: { id: ep.id } });
  await audit(ctx, "webhook.delete", { type: "webhook_endpoint", id }, { url: ep.url });
}
