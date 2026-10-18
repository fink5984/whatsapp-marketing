import type { WhatsappAccount } from "@/generated/prisma/client";
import { db } from "../db";
import { decryptOptional, encryptSecret, randomAlphanumeric } from "../crypto";
import { assertCan, type OrgContext } from "../context";
import { audit } from "../audit";
import { NotFoundError, UserError } from "../rbac";
import { MetaApiError, MetaClient, type FetchLike } from "../meta/client";
import { appUrl, env } from "../env";
import { logger } from "../logger";

/** Test seam: lets tests inject a fake Graph API transport. */
let metaFetchOverride: FetchLike | undefined;
export function setMetaFetchForTests(f: FetchLike | undefined) {
  metaFetchOverride = f;
}

export function metaClientFor(account: Pick<WhatsappAccount, "accessTokenEnc">): MetaClient {
  const token = decryptOptional(account.accessTokenEnc);
  if (!token) throw new UserError("לחשבון זה לא הוגדר אסימון גישה (Access Token)");
  const e = env();
  const baseUrl = e.NODE_ENV !== "production" ? e.META_GRAPH_BASE_URL : undefined;
  return new MetaClient({ accessToken: token, version: e.META_GRAPH_API_VERSION, fetchImpl: metaFetchOverride, baseUrl });
}

export function webhookUrlsFor(account: Pick<WhatsappAccount, "webhookKey">) {
  return {
    perAccount: `${appUrl()}/api/webhooks/whatsapp/${account.webhookKey}`,
    shared: `${appUrl()}/api/webhooks/whatsapp`,
  };
}

export async function listAccounts(ctx: OrgContext) {
  assertCan(ctx, "accounts:read");
  return db.whatsappAccount.findMany({
    where: { organizationId: ctx.orgId },
    include: { phoneNumbers: { orderBy: { createdAt: "asc" } }, _count: { select: { templates: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function getAccount(ctx: OrgContext, id: string) {
  assertCan(ctx, "accounts:read");
  const account = await db.whatsappAccount.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { phoneNumbers: { orderBy: { createdAt: "asc" } } },
  });
  if (!account) throw new NotFoundError("החשבון לא נמצא");
  return account;
}

export type AccountInput = {
  name: string;
  wabaId: string;
  accessToken?: string;
  metaAppId?: string;
  appSecret?: string;
  webhookVerifyToken?: string;
};

export async function createAccount(ctx: OrgContext, input: AccountInput) {
  assertCan(ctx, "accounts:write");
  if (!/^\d{5,25}$/.test(input.wabaId.trim())) throw new UserError("WhatsApp Business Account ID צריך להכיל ספרות בלבד");
  const exists = await db.whatsappAccount.findFirst({ where: { wabaId: input.wabaId.trim() } });
  if (exists) {
    throw new UserError(exists.organizationId === ctx.orgId ? "חשבון זה כבר מחובר" : "חשבון WhatsApp זה כבר מחובר לעסק אחר במערכת");
  }
  const account = await db.whatsappAccount.create({
    data: {
      organizationId: ctx.orgId,
      name: input.name.trim(),
      wabaId: input.wabaId.trim(),
      metaAppId: input.metaAppId?.trim() || null,
      accessTokenEnc: input.accessToken ? encryptSecret(input.accessToken.trim()) : null,
      appSecretEnc: input.appSecret ? encryptSecret(input.appSecret.trim()) : null,
      webhookVerifyTokenEnc: encryptSecret(input.webhookVerifyToken?.trim() || randomAlphanumeric(32)),
      webhookKey: randomAlphanumeric(24),
      status: "PENDING_SETUP",
    },
  });
  await audit(ctx, "account.create", { type: "whatsapp_account", id: account.id }, { wabaId: account.wabaId });
  return account;
}

/** Secrets are write-only: empty input keeps the stored value. */
export async function updateAccount(ctx: OrgContext, id: string, input: Partial<AccountInput>) {
  assertCan(ctx, "accounts:write");
  const account = await db.whatsappAccount.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!account) throw new NotFoundError("החשבון לא נמצא");
  const newWaba = input.wabaId?.trim();
  if (newWaba && newWaba !== account.wabaId) {
    if (!/^\d{5,25}$/.test(newWaba)) throw new UserError("WhatsApp Business Account ID צריך להכיל ספרות בלבד");
    if (await db.whatsappAccount.findFirst({ where: { wabaId: newWaba, id: { not: id } } })) throw new UserError("חשבון WhatsApp זה כבר מחובר במערכת");
  }
  const updated = await db.whatsappAccount.update({
    where: { id },
    data: {
      name: input.name?.trim() || undefined,
      ...(newWaba && newWaba !== account.wabaId ? { wabaId: newWaba, status: "PENDING_SETUP" as const, statusMessage: null } : {}),
      metaAppId: input.metaAppId !== undefined ? input.metaAppId.trim() || null : undefined,
      accessTokenEnc: input.accessToken ? encryptSecret(input.accessToken.trim()) : undefined,
      appSecretEnc: input.appSecret ? encryptSecret(input.appSecret.trim()) : undefined,
      webhookVerifyTokenEnc: input.webhookVerifyToken ? encryptSecret(input.webhookVerifyToken.trim()) : undefined,
    },
  });
  await audit(ctx, "account.update", { type: "whatsapp_account", id }, {
    changed: Object.keys(input).filter((k) => (input as Record<string, unknown>)[k]),
  });
  return updated;
}

export async function deleteAccount(ctx: OrgContext, id: string) {
  assertCan(ctx, "accounts:write");
  const account = await db.whatsappAccount.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!account) throw new NotFoundError("החשבון לא נמצא");
  const active = await db.campaign.count({
    where: { organizationId: ctx.orgId, accountId: id, status: { in: ["RUNNING", "SCHEDULED", "QUEUED", "PAUSED"] } },
  });
  if (active > 0) throw new UserError("לא ניתן לנתק חשבון שיש לו קמפיינים פעילים או מתוזמנים");
  await db.whatsappAccount.delete({ where: { id } });
  await audit(ctx, "account.delete", { type: "whatsapp_account", id }, { wabaId: account.wabaId });
}

export type HealthResult = {
  ok: boolean;
  checks: { key: string; label: string; ok: boolean; detail?: string }[];
};

/**
 * Verifies the connection against the Graph API: token works, WABA is
 * reachable, phone numbers are registered, app is subscribed to webhooks.
 * Also syncs phone numbers + quality + messaging limit into the DB.
 */
export async function runHealthCheck(ctx: OrgContext, id: string): Promise<HealthResult> {
  assertCan(ctx, "accounts:write");
  const account = await db.whatsappAccount.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!account) throw new NotFoundError("החשבון לא נמצא");
  const checks: HealthResult["checks"] = [];
  const fail = (key: string, label: string, detail: string) => checks.push({ key, label, ok: false, detail });

  if (!account.accessTokenEnc) {
    fail("token", "אסימון גישה", "לא הוגדר Access Token");
  } else {
    const client = metaClientFor(account);
    try {
      const waba = await client.getWaba(account.wabaId);
      checks.push({ key: "waba", label: "גישה לחשבון WhatsApp Business", ok: true, detail: waba.name });
      await db.whatsappAccount.update({
        where: { id },
        data: { templateNamespace: waba.message_template_namespace ?? null, currency: waba.currency ?? null },
      });

      const numbers = await client.listPhoneNumbers(account.wabaId);
      if (numbers.length === 0) fail("numbers", "מספרי טלפון", "לא נמצאו מספרים בחשבון");
      for (const n of numbers) {
        let limitTier: string | undefined;
        try {
          limitTier = (await client.getPhoneNumber(n.id)).whatsapp_business_manager_messaging_limit;
        } catch {
          /* optional */
        }
        const owner = await db.whatsappPhoneNumber.findUnique({ where: { phoneNumberId: n.id } });
        if (owner && owner.organizationId !== ctx.orgId) {
          fail(`number:${n.id}`, `מספר ${n.display_phone_number}`, "המספר משויך לעסק אחר במערכת");
          continue;
        }
        const data = {
          displayPhoneNumber: n.display_phone_number ?? null,
          verifiedName: n.verified_name ?? null,
          qualityRating: n.quality_rating ?? null,
          nameStatus: n.name_status ?? null,
          throughputLevel: n.throughput?.level ?? null,
          messagingLimitTier: limitTier ?? owner?.messagingLimitTier ?? null,
          status: (n.platform_type === "CLOUD_API" || !n.platform_type ? "CONNECTED" : "ERROR") as "CONNECTED" | "ERROR",
          lastCheckedAt: new Date(),
        };
        await db.whatsappPhoneNumber.upsert({
          where: { phoneNumberId: n.id },
          update: data,
          create: { ...data, organizationId: ctx.orgId, accountId: id, phoneNumberId: n.id },
        });
        checks.push({
          key: `number:${n.id}`,
          label: `מספר ${n.display_phone_number ?? n.id}`,
          ok: data.status === "CONNECTED",
          detail:
            data.status === "CONNECTED"
              ? `איכות: ${n.quality_rating ?? "לא ידוע"}${limitTier ? ` · מגבלה: ${limitTier}` : ""}`
              : `המספר אינו רשום ב-Cloud API (${n.platform_type})`,
        });
      }

      try {
        const subs = await client.listSubscribedApps(account.wabaId);
        const subscribed = subs.data.length > 0;
        checks.push({
          key: "webhooks",
          label: "רישום אפליקציה ל-Webhooks",
          ok: subscribed,
          detail: subscribed ? subs.data.map((s) => s.whatsapp_business_api_data?.name).filter(Boolean).join(", ") : "יש ללחוץ 'רישום ל-Webhooks'",
        });
      } catch (err) {
        fail("webhooks", "רישום אפליקציה ל-Webhooks", err instanceof Error ? err.message : "שגיאה");
      }
    } catch (err) {
      let msg = err instanceof MetaApiError ? `${err.message}${err.code ? ` (קוד ${err.code})` : ""}` : "שגיאת תקשורת עם Meta";
      if (err instanceof MetaApiError && err.code === 100) {
        // Common mix-up: the Phone Number ID was entered instead of the WhatsApp Business Account ID.
        try {
          const asPhone = await client.getPhoneNumber(account.wabaId);
          if (asPhone.display_phone_number) {
            msg = `המזהה שהוזן (${account.wabaId}) הוא Phone Number ID של המספר ${asPhone.display_phone_number} — ולא WhatsApp Business Account ID. ב-API Setup העתיקו את "WhatsApp Business Account ID" ועדכנו דרך "עדכון פרטים".`;
          }
        } catch {
          msg = `המזהה שהוזן אינו WhatsApp Business Account ID, או שלאסימון אין גישה אליו. בדקו את המזהה ב-API Setup ואת הרשאות ה-System User.`;
        }
      }
      fail("waba", "גישה לחשבון WhatsApp Business", msg);
      logger.warn("health check failed", { accountId: id, err });
    }
  }

  const hasAppSecret = !!account.appSecretEnc || !!env().META_APP_SECRET;
  checks.push({
    key: "app_secret",
    label: "App Secret לאימות חתימת Webhooks",
    ok: hasAppSecret,
    detail: hasAppSecret ? undefined : "ללא App Secret לא ניתן לאמת שה-Webhooks הגיעו מ-Meta — האירועים יידחו",
  });
  checks.push({
    key: "webhook_traffic",
    label: "התקבלו אירועי Webhook",
    ok: !!account.lastWebhookAt,
    detail: account.lastWebhookAt ? `אחרון: ${account.lastWebhookAt.toISOString()}` : "טרם התקבל אירוע. יש להגדיר את כתובת ה-Webhook ב-Meta",
  });

  const critical = checks.filter((c) => ["token", "waba", "numbers", "app_secret"].includes(c.key) || c.key.startsWith("number:"));
  const ok = critical.every((c) => c.ok);
  await db.whatsappAccount.update({
    where: { id },
    data: {
      status: ok ? "CONNECTED" : "ERROR",
      statusMessage: ok ? null : critical.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail ?? ""}`).join(" | ").slice(0, 500),
      lastHealthCheckAt: new Date(),
    },
  });
  await audit(ctx, "account.health_check", { type: "whatsapp_account", id }, { ok });
  return { ok, checks };
}

export async function subscribeWebhooks(ctx: OrgContext, id: string) {
  assertCan(ctx, "accounts:write");
  const account = await db.whatsappAccount.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!account) throw new NotFoundError("החשבון לא נמצא");
  try {
    await metaClientFor(account).subscribeAppToWaba(account.wabaId);
  } catch (err) {
    throw new UserError(err instanceof MetaApiError ? `Meta: ${err.message}` : "הרישום נכשל");
  }
  await db.whatsappAccount.update({ where: { id }, data: { webhookSubscribedAt: new Date() } });
}

export async function setPhoneNumberOptions(ctx: OrgContext, phoneId: string, input: { isDefault?: boolean; messagesPerSecond?: number | null }) {
  assertCan(ctx, "accounts:write");
  const phone = await db.whatsappPhoneNumber.findFirst({ where: { id: phoneId, organizationId: ctx.orgId } });
  if (!phone) throw new NotFoundError("המספר לא נמצא");
  await db.$transaction(async (tx) => {
    if (input.isDefault) await tx.whatsappPhoneNumber.updateMany({ where: { organizationId: ctx.orgId }, data: { isDefault: false } });
    await tx.whatsappPhoneNumber.update({
      where: { id: phoneId },
      data: {
        isDefault: input.isDefault ?? undefined,
        messagesPerSecond: input.messagesPerSecond === undefined ? undefined : input.messagesPerSecond,
      },
    });
  });
}
