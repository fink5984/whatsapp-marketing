/**
 * Background worker: sends queued messages, advances campaign states,
 * recovers from crashes, retries webhooks, delivers outgoing webhooks,
 * syncs Google Sheets and applies data retention.
 *
 * Run: `pnpm worker` (tsx). Safe to run several replicas: message claims use
 * SKIP LOCKED and each sender number is paced by one lease holder.
 */
import "dotenv/config";
import os from "node:os";
import { db, disconnectDb } from "@/server/db";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import type { MetaClient } from "@/server/meta/client";
import { advanceCampaigns, phonesWithDueMessages, sendTickForPhone } from "@/server/sending/scheduler";
import { recoverStuckMessages } from "@/server/sending/sender";
import { retryPendingWebhookEvents } from "@/server/webhooks/processor";
import { deliverPendingWebhooks } from "@/server/services/outgoing-webhooks";
import { syncDueSheetSources } from "@/server/services/sheets";
import { applyRetention } from "@/server/services/retention";

env(); // fail fast on misconfiguration

const workerId = `${process.env.WORKER_ID || "worker"}:${os.hostname()}:${process.pid}`;
let stopping = false;
const inFlight = new Set<Promise<unknown>>();
const clientCache = new Map<string, MetaClient>();

function every(name: string, ms: number, fn: () => Promise<unknown>) {
  let running = false;
  const run = async () => {
    if (stopping || running) return;
    running = true;
    const p = fn()
      .catch((err) => logger.error(`${name} failed`, { err }))
      .finally(() => {
        running = false;
        inFlight.delete(p);
      });
    inFlight.add(p);
  };
  const timer = setInterval(run, ms);
  void run();
  return timer;
}

async function sendLoop() {
  const phones = await phonesWithDueMessages();
  await Promise.all(phones.map((id) => sendTickForPhone(workerId, id, clientCache)));
}

async function heartbeat() {
  await db.workerHeartbeat.upsert({
    where: { workerId },
    update: { beatAt: new Date() },
    create: { workerId, hostname: os.hostname(), startedAt: new Date(), beatAt: new Date() },
  });
  await db.workerHeartbeat.deleteMany({ where: { beatAt: { lt: new Date(Date.now() - 24 * 3600_000) } } });
}

async function main() {
  logger.info("worker starting", { workerId });
  // Immediately recover anything a previous crash left mid-flight.
  const recovered = await recoverStuckMessages();
  if (recovered) logger.warn("recovered stuck messages as UNCERTAIN", { count: recovered });

  const timers = [
    every("heartbeat", 15_000, heartbeat),
    every("send", 1_000, sendLoop),
    every("campaigns", 5_000, advanceCampaigns),
    every("recovery", 30_000, recoverStuckMessages),
    every("webhook-retry", 60_000, () => retryPendingWebhookEvents()),
    every("outgoing-webhooks", 10_000, () => deliverPendingWebhooks()),
    every("sheets", 5 * 60_000, syncDueSheetSources),
    every("retention", 6 * 3600_000, applyRetention),
    // Tokens can be rotated in the UI; refresh cached clients periodically.
    every("client-cache", 5 * 60_000, async () => clientCache.clear()),
  ];

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info("worker stopping", { signal, inFlight: inFlight.size });
    timers.forEach(clearInterval);
    const deadline = Date.now() + 25_000;
    while (inFlight.size > 0 && Date.now() < deadline) await Promise.race([...inFlight, new Promise((r) => setTimeout(r, 500))]);
    await db.whatsappPhoneNumber.updateMany({ where: { sendLeaseOwner: workerId }, data: { sendLeaseOwner: null, sendLeaseUntil: null } }).catch(() => {});
    await db.workerHeartbeat.delete({ where: { workerId } }).catch(() => {});
    await disconnectDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

process.on("unhandledRejection", (err) => logger.error("unhandledRejection", { err: err as Error }));

main().catch((err) => {
  logger.error("worker crashed on startup", { err });
  process.exit(1);
});
