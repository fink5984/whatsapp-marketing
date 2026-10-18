import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { hashPassword, verifyPassword, validatePasswordStrength } from "@/server/auth/password";
import { login, validateSessionToken, revokeSessionToken } from "@/server/auth/sessions";
import { ForbiddenError, NotFoundError, can } from "@/server/rbac";
import { createContact, deleteContact, getContactDetail, listContacts, updateContact } from "@/server/services/contacts";
import { getCampaign, createCampaign, launchCampaign, updateCampaignDraft } from "@/server/services/campaigns";
import { getTemplate } from "@/server/services/templates";
import { getAccount, updateAccount } from "@/server/services/accounts";
import { addContactsToAudience, saveAudience } from "@/server/services/audiences";
import { buildContactWhere } from "@/server/services/contact-filter";
import { getConversation } from "@/server/services/inbox";
import { authenticateApiKey, createApiKey, revokeApiKey } from "@/server/services/api-keys";
import { rateLimit } from "@/server/rate-limit";
import { addContacts, createOrg, ctxFor, resetDb, setupSendingOrg } from "./helpers";

beforeEach(resetDb);

describe("authentication", () => {
  it("hashes and verifies passwords (scrypt)", async () => {
    const h = await hashPassword("Correct horse 9");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Correct horse 9", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(validatePasswordStrength("short1")).not.toBeNull();
    expect(validatePasswordStrength("longenoughbutnodigits")).not.toBeNull();
    expect(validatePasswordStrength("LongEnough123")).toBeNull();
  });

  it("logs in, validates and revokes sessions", async () => {
    const { user } = await createOrg();
    const bad = await login(user.email, "nope", { ip: "1.1.1.1" });
    expect(bad.ok).toBe(false);
    const res = await login(user.email.toUpperCase(), "Password123!", { ip: "1.1.1.1" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const stored = await db.session.findFirst({ where: { userId: user.id } });
    expect(stored?.tokenHash).not.toBe(res.token); // only the hash is stored
    const s = await validateSessionToken(res.token);
    expect(s?.userId).toBe(user.id);
    await revokeSessionToken(res.token);
    expect(await validateSessionToken(res.token)).toBeNull();
  });

  it("rejects expired sessions", async () => {
    const { user } = await createOrg();
    const res = await login(user.email, "Password123!", { ip: "2.2.2.2" });
    if (!res.ok) throw new Error("login failed");
    await db.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSessionToken(res.token)).toBeNull();
  });

  it("locks the account after repeated failures", async () => {
    const { user } = await createOrg();
    for (let i = 0; i < 8; i++) await login(user.email, "wrong-password", { ip: `9.9.9.${i}` });
    const res = await login(user.email, "Password123!", { ip: "9.9.9.200" });
    expect(res.ok).toBe(false);
  });

  it("does not reveal whether an email exists", async () => {
    await createOrg();
    const a = await login("nobody@test.dev", "Password123!", { ip: "3.3.3.3" });
    expect(a.ok === false && a.error).toBe("דוא״ל או סיסמה שגויים");
  });

  it("rate limits by key with a fixed window", async () => {
    for (let i = 0; i < 3; i++) expect((await rateLimit("t:key", 3, 60)).allowed).toBe(true);
    expect((await rateLimit("t:key", 3, 60)).allowed).toBe(false);
  });
});

describe("RBAC", () => {
  it("maps roles to permissions", () => {
    expect(can("VIEWER", "contacts:read")).toBe(true);
    expect(can("VIEWER", "contacts:write")).toBe(false);
    expect(can("CAMPAIGN_MANAGER", "campaigns:launch")).toBe(true);
    expect(can("CAMPAIGN_MANAGER", "accounts:write")).toBe(false);
    expect(can("CAMPAIGN_MANAGER", "suppression:lift")).toBe(false);
    expect(can("ADMIN", "users:manage")).toBe(true);
    expect(can("ADMIN", "org:owner")).toBe(false);
  });

  it("enforces permissions in services", async () => {
    const { org, user } = await createOrg();
    const viewer = ctxFor(org.id, user.id, "VIEWER");
    await expect(createContact(viewer, { phone: "0521234567" })).rejects.toBeInstanceOf(ForbiddenError);
    const manager = ctxFor(org.id, user.id, "CAMPAIGN_MANAGER");
    const c = await createContact(manager, { phone: "0521234567" });
    await expect(deleteContact(manager, c.id, { keepDoNotContact: false })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("tenant isolation", () => {
  it("one org cannot read or modify another org's data by ID", async () => {
    const A = await setupSendingOrg("A");
    const B = await setupSendingOrg("B");
    const [bContact] = await addContacts(B.org.id, ["+972521000001"]);
    const bCampaign = await createCampaign(B.ctx, { name: "B campaign", accountId: B.account.id, phoneNumberId: B.phone.id, templateId: B.template.id });
    const bConvo = await db.conversation.create({ data: { organizationId: B.org.id, phoneNumberId: B.phone.id, contactId: bContact.id } });

    await expect(getContactDetail(A.ctx, bContact.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateContact(A.ctx, bContact.id, { name: "hacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteContact(A.ctx, bContact.id, { keepDoNotContact: false })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCampaign(A.ctx, bCampaign.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateCampaignDraft(A.ctx, bCampaign.id, { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(launchCampaign(A.ctx, bCampaign.id, { confirmedEligibleCount: 0 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getTemplate(A.ctx, B.template.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getAccount(A.ctx, B.account.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateAccount(A.ctx, B.account.id, { accessToken: "stolen" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getConversation(A.ctx, bConvo.id)).rejects.toBeInstanceOf(NotFoundError);

    expect((await db.contact.findUnique({ where: { id: bContact.id } }))?.name).not.toBe("hacked");
  });

  it("cannot attach another org's account/template/phone to a campaign", async () => {
    const A = await setupSendingOrg("A");
    const B = await setupSendingOrg("B");
    await expect(createCampaign(A.ctx, { name: "x", accountId: B.account.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createCampaign(A.ctx, { name: "x", accountId: A.account.id, templateId: B.template.id })).rejects.toThrow();
    await expect(createCampaign(A.ctx, { name: "x", accountId: A.account.id, phoneNumberId: B.phone.id })).rejects.toThrow();
  });

  it("filters referencing another org's audiences/tags match nothing", async () => {
    const A = await createOrg("A");
    const B = await createOrg("B");
    const bContacts = await addContacts(B.org.id, ["+972521000002", "+972521000003"]);
    const bAudienceId = await saveAudience(B.ctx, { name: "B list", kind: "STATIC" });
    await addContactsToAudience(B.ctx, bAudienceId, bContacts.map((c) => c.id));
    const where = await buildContactWhere(A.org.id, { audienceIds: [bAudienceId] });
    expect(await db.contact.count({ where })).toBe(0);
    // And adding B's contacts to an A audience is silently ignored.
    const aAudienceId = await saveAudience(A.ctx, { name: "A list", kind: "STATIC" });
    expect(await addContactsToAudience(A.ctx, aAudienceId, bContacts.map((c) => c.id))).toBe(0);
  });

  it("lists are scoped to the active org", async () => {
    const A = await createOrg("A");
    const B = await createOrg("B");
    await addContacts(A.org.id, ["+972521000004"]);
    await addContacts(B.org.id, ["+972521000005", "+972521000006"]);
    expect((await listContacts(A.ctx, {}, { page: 1, pageSize: 50 })).total).toBe(1);
    expect((await listContacts(B.ctx, {}, { page: 1, pageSize: 50 })).total).toBe(2);
  });
});

describe("API keys", () => {
  it("authenticates valid keys and rejects revoked/garbage keys", async () => {
    const { ctx } = await createOrg();
    const { key, plaintext } = await createApiKey(ctx, { name: "n8n", scopes: ["contacts:write", "bogus"] });
    expect(key.scopes).toEqual(["contacts:write"]);
    const stored = await db.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(stored.keyHash).not.toContain(plaintext);
    const auth = await authenticateApiKey(`Bearer ${plaintext}`, null);
    expect(auth?.orgId).toBe(ctx.orgId);
    expect(auth?.scopes).toEqual(["contacts:write"]);
    expect(await authenticateApiKey(`Bearer ${plaintext.slice(0, -1)}x`, null)).toBeNull();
    expect(await authenticateApiKey("Bearer nonsense", null)).toBeNull();
    await revokeApiKey(ctx, key.id);
    expect(await authenticateApiKey(`Bearer ${plaintext}`, null)).toBeNull();
  });
});
