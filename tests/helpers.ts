import type { Role } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { encryptSecret, randomAlphanumeric } from "@/server/crypto";
import type { OrgContext } from "@/server/context";
import { setMetaFetchForTests } from "@/server/services/accounts";
import { getSettings } from "@/server/services/settings";
import { createOrganizationWithOwner } from "@/server/services/organizations";
import { analyzeTemplate, type TemplateComponent } from "@/lib/templates";

export async function resetDb() {
  // Safety: only ever truncate a dedicated *_test database.
  if (!/\/[^/?]+_test(\?|$)/.test(process.env.DATABASE_URL ?? "")) throw new Error("resetDb refused: not a _test database");
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export function ctxFor(orgId: string, userId: string, role: Role = "OWNER"): OrgContext {
  return { orgId, role, actor: { type: "user", userId, name: "Test" } };
}

let counter = 0;
export async function createOrg(name = "Org") {
  counter++;
  const { org, user } = await createOrganizationWithOwner({
    orgName: `${name} ${counter}`,
    owner: { email: `owner${counter}-${randomAlphanumeric(4)}@test.dev`, name: "Owner", password: "Password123!" },
  });
  return { org, user, ctx: ctxFor(org.id, user.id, "OWNER") };
}

export const MARKETING_COMPONENTS: TemplateComponent[] = [
  { type: "BODY", text: "פרסומת: שלום {{1}}, יש לנו הצעה חדשה עבורך" },
  { type: "FOOTER", text: "להסרה מרשימת התפוצה, השיבו הסר" },
  {
    type: "BUTTONS",
    buttons: [
      { type: "URL", text: "לפרטים", url: "https://t.test/r/{{1}}" },
      { type: "QUICK_REPLY", text: "הסרה" },
    ],
  },
];

/** Connected account + phone + approved template, with org compliance satisfied. */
export async function setupSendingOrg(name = "Sender") {
  const base = await createOrg(name);
  const { org } = base;
  const account = await db.whatsappAccount.create({
    data: {
      organizationId: org.id,
      name: "Main",
      wabaId: String(100000000 + counter),
      accessTokenEnc: encryptSecret("test-token"),
      appSecretEnc: encryptSecret(`app-secret-${org.id}`),
      webhookVerifyTokenEnc: encryptSecret("verify"),
      webhookKey: randomAlphanumeric(24),
      status: "CONNECTED",
    },
  });
  const phone = await db.whatsappPhoneNumber.create({
    data: {
      organizationId: org.id,
      accountId: account.id,
      phoneNumberId: String(200000000 + counter),
      displayPhoneNumber: "+972 3-555-0000",
      status: "CONNECTED",
      qualityRating: "GREEN",
      messagesPerSecond: 50,
    },
  });
  const a = analyzeTemplate(MARKETING_COMPONENTS);
  const template = await db.messageTemplate.create({
    data: {
      organizationId: org.id,
      accountId: account.id,
      name: "promo_offer",
      language: "he",
      category: "MARKETING",
      status: "APPROVED",
      metaTemplateId: `t${counter}`,
      components: MARKETING_COMPONENTS as unknown as Prisma.InputJsonValue,
      hasUnsubscribeFooter: a.hasUnsubscribeFooter,
      hasUnsubscribeButton: a.hasUnsubscribeButton,
      hasAdvertisingLabel: a.hasAdvertisingLabel,
    },
  });
  await getSettings(org.id);
  await db.businessSettings.update({
    where: { organizationId: org.id },
    data: {
      displayName: "Test Biz",
      legalName: "Test Biz Ltd",
      contactPhone: "+97235550000",
      privacyPolicyUrl: "https://example.com/privacy",
      // Always-open window so tests don't depend on wall-clock time.
      sendingWindow: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), ["00:00", "23:59"]])),
      testRecipients: ["+972501111111"],
      costRates: { MARKETING: 0.05 },
      safetyRollingCap: 1000,
    },
  });
  for (const ruleCode of ["CONSENT_PROCESS", "META_POLICY_REVIEW"]) {
    await db.complianceCheck.create({
      data: { organizationId: org.id, ruleCode, status: "PASSED", evidence: "x".repeat(100), reviewerName: "Tester", reviewedAt: new Date(), expiresAt: new Date(Date.now() + 86400_000 * 30) },
    });
  }
  const link = await db.trackedLink.create({
    data: { organizationId: org.id, name: "Landing", token: randomAlphanumeric(10), destinationUrl: "https://example.com/offer" },
  });
  return { ...base, account, phone, template, link };
}

export async function addContacts(orgId: string, phones: string[], consent: "GRANTED" | "UNKNOWN" = "GRANTED") {
  const out = [];
  for (const p of phones) {
    out.push(
      await db.contact.create({
        data: { organizationId: orgId, phoneE164: p, name: `Contact ${p.slice(-4)}`, consentStatus: consent, source: "test" },
      }),
    );
  }
  return out;
}

export type FakeCall = { url: string; method: string; body: Record<string, unknown> | null };

/**
 * Fake Graph API. `responder` can return a status/json pair, throw to
 * simulate network errors, or return undefined for a default success.
 */
export function installFakeMeta(responder?: (call: FakeCall, n: number) => { status: number; json: unknown } | undefined | Promise<{ status: number; json: unknown } | undefined>) {
  const calls: FakeCall[] = [];
  setMetaFetchForTests(async (url, init) => {
    const call: FakeCall = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const r = (await responder?.(call, calls.length)) ?? { status: 200, json: { messages: [{ id: `wamid.${calls.length}.${randomAlphanumeric(6)}` }] } };
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  });
  return calls;
}

export function metaError(code: number, status = 400, message = "error") {
  return { status, json: { error: { message, code, type: "OAuthException", fbtrace_id: "x" } } };
}

export function uninstallFakeMeta() {
  setMetaFetchForTests(undefined);
}
