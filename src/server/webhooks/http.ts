import { NextResponse, type NextRequest } from "next/server";
import { db } from "../db";
import { decryptOptional, safeEqual } from "../crypto";
import { env } from "../env";
import { logger } from "../logger";
import { rateLimit } from "../rate-limit";
import { verifyMetaSignature } from "./signature";
import { ingestWebhook } from "./processor";

/** GET handshake: echo hub.challenge when hub.verify_token matches. */
export function handleVerify(req: NextRequest, expectedToken: string | null) {
  const p = req.nextUrl.searchParams;
  const token = p.get("hub.verify_token") ?? "";
  if (p.get("hub.mode") === "subscribe" && expectedToken && safeEqual(token, expectedToken)) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * POST: verifies X-Hub-Signature-256 against candidate app secrets, persists
 * the event, processes it, and always answers quickly with 200 once stored
 * (Meta retries non-2xx responses).
 */
export async function handleEvent(req: NextRequest, account: { id: string; organizationId: string; appSecretEnc: string | null } | null) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await rateLimit(`webhook:${ip}`, 3000, 60);
  if (!rl.allowed) return new NextResponse("Too Many Requests", { status: 429 });

  const raw = await req.text();
  if (raw.length > 3_000_000) return new NextResponse("Payload too large", { status: 413 });
  const signature = req.headers.get("x-hub-signature-256");

  const secrets: string[] = [];
  const own = decryptOptional(account?.appSecretEnc);
  if (own) secrets.push(own);
  const platform = env().META_APP_SECRET;
  if (platform) secrets.push(platform);
  if (!account) {
    // Shared endpoint: also try the app secrets of the WABAs named in the payload.
    try {
      const ids = ((JSON.parse(raw) as { entry?: { id?: string }[] }).entry ?? []).map((e) => e.id).filter(Boolean) as string[];
      const accounts = await db.whatsappAccount.findMany({ where: { wabaId: { in: ids } }, select: { appSecretEnc: true } });
      for (const a of accounts) {
        const s = decryptOptional(a.appSecretEnc);
        if (s) secrets.push(s);
      }
    } catch {
      return new NextResponse("Bad Request", { status: 400 });
    }
  }
  if (secrets.length === 0) {
    logger.error("webhook rejected: no app secret configured");
    return new NextResponse("Webhook secret not configured", { status: 401 });
  }
  if (!secrets.some((s) => verifyMetaSignature(raw, signature, s))) {
    logger.warn("webhook rejected: bad signature", { ip });
    return new NextResponse("Invalid signature", { status: 401 });
  }
  try {
    await ingestWebhook(raw, account ? { accountId: account.id, organizationId: account.organizationId } : {});
  } catch (err) {
    // Stored events are retried by the worker; only storage failures reach here.
    logger.error("webhook ingest failed", { err });
    return new NextResponse("Temporary failure", { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
