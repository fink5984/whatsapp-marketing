import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { previewQuickCampaign, quickNeeds, quickSendCampaign } from "@/server/services/quick-campaign";
import { confirmRequiredCompliance, evaluateCompliance } from "@/server/services/compliance";
import { sendTickForPhone, advanceCampaigns } from "@/server/sending/scheduler";
import { saveAudience, addContactsToAudience } from "@/server/services/audiences";
import { suppressPhone } from "@/server/services/suppression";
import { addContacts, createOrg, installFakeMeta, MARKETING_COMPONENTS, resetDb, setupSendingOrg, uninstallFakeMeta } from "./helpers";

beforeEach(resetDb);
afterEach(uninstallFakeMeta);

describe("quick send", () => {
  it("derives what the template needs", () => {
    const n = quickNeeds(MARKETING_COMPONENTS);
    expect(n.autoSlots.map((a) => a.key)).toEqual(["body.1"]);
    expect(n.textSlots).toEqual([]);
    expect(n.needsLink).toBe(true);
    expect(n.needsMedia).toBeNull();
  });

  it("previews without writing, then sends in one step to eligible contacts only", async () => {
    const calls = installFakeMeta();
    const s = await setupSendingOrg();
    await addContacts(s.org.id, ["+972521000001", "+972521000002"]);
    await addContacts(s.org.id, ["+972521000003"], "UNKNOWN");
    await suppressPhone(s.ctx, { phoneE164: "+972521000002", reason: "KEYWORD_REPLY" });

    const base = { phoneNumberId: s.phone.id, templateId: s.template.id };
    const missingLink = await previewQuickCampaign(s.ctx, base);
    expect(missingLink.ok).toBe(false);
    expect(missingLink.items.find((i) => i.key === "link" && !i.ok)?.label).toContain("כתובת");
    expect(await db.campaign.count({ where: { organizationId: s.org.id } })).toBe(0);

    const input = { ...base, linkUrl: "https://example.com/apply" };
    const pv = await previewQuickCampaign(s.ctx, input);
    expect(pv.ok).toBe(true);
    expect(pv.audience).toMatchObject({ matched: 3, eligible: 1 });
    expect(pv.audience.reasons).toEqual({ SUPPRESSED: 1, NO_CONSENT: 1 });

    const res = await quickSendCampaign(s.ctx, input);
    expect(res.eligible).toBe(1);
    const c = await db.campaign.findUniqueOrThrow({ where: { id: res.campaignId } });
    expect(c.trackedLinkId).not.toBeNull();
    await advanceCampaigns();
    await sendTickForPhone("w1", s.phone.id, new Map());
    expect(calls).toHaveLength(1);
    expect((calls[0].body as { to: string }).to).toBe("972521000001");
  });

  it("respects audience and quantity", async () => {
    installFakeMeta();
    const s = await setupSendingOrg();
    const contacts = await addContacts(s.org.id, ["+972521000001", "+972521000002", "+972521000003", "+972521000004"]);
    const audienceId = await saveAudience(s.ctx, { name: "VIP", kind: "STATIC" });
    await addContactsToAudience(s.ctx, audienceId, contacts.slice(0, 3).map((c) => c.id));
    const pv = await previewQuickCampaign(s.ctx, { phoneNumberId: s.phone.id, templateId: s.template.id, audienceMode: "group", audienceId, maxRecipients: 2, linkUrl: "https://example.com" });
    expect(pv.audience).toMatchObject({ matched: 3, eligible: 2 });
    expect(pv.audience.reasons).toEqual({ OVER_LIMIT: 1 });
  });

  it("a failed send leaves no draft behind and explains why", async () => {
    const s = await setupSendingOrg();
    await addContacts(s.org.id, ["+972521000001"], "UNKNOWN");
    await expect(quickSendCampaign(s.ctx, { phoneNumberId: s.phone.id, templateId: s.template.id, linkUrl: "https://example.com" })).rejects.toThrow("נמענים כשירים");
    expect(await db.campaign.count({ where: { organizationId: s.org.id } })).toBe(0);
  });

  it("missing advertising label warns but does not block", async () => {
    const s = await setupSendingOrg();
    await addContacts(s.org.id, ["+972521000001"]);
    await db.messageTemplate.update({
      where: { id: s.template.id },
      data: { components: [{ type: "BODY", text: "שלום {{1}}, הצעה חדשה עבורך" }, { type: "FOOTER", text: "להסרה מרשימת התפוצה, השיבו הסר" }] },
    });
    const pv = await previewQuickCampaign(s.ctx, { phoneNumberId: s.phone.id, templateId: s.template.id });
    expect(pv.items.find((i) => i.key === "adlabel")).toMatchObject({ ok: false, level: "warning" });
    expect(pv.ok).toBe(true);
  });

  it("a template without opt-out warns, and sending requires an explicit, audited acknowledgment", async () => {
    const s = await setupSendingOrg();
    await addContacts(s.org.id, ["+972521000001"]);
    await db.messageTemplate.update({ where: { id: s.template.id }, data: { components: [{ type: "BODY", text: "פרסומת: שלום {{1}}, הצעה חדשה" }] } });
    const input = { phoneNumberId: s.phone.id, templateId: s.template.id };
    const pv = await previewQuickCampaign(s.ctx, input);
    expect(pv.items.find((i) => i.key === "optout")).toMatchObject({ ok: false, level: "warning" });
    expect(pv.ok).toBe(true);
    await expect(quickSendCampaign(s.ctx, input)).rejects.toThrow("לאשר את האזהרה");
    expect(await db.campaign.count({ where: { organizationId: s.org.id } })).toBe(0);
    const res = await quickSendCampaign(s.ctx, { ...input, acknowledgeNoOptOut: true });
    expect(res.eligible).toBe(1);
    const log = await db.auditLog.findFirstOrThrow({ where: { organizationId: s.org.id, action: "campaign.launch" } });
    expect((log.metadata as { warningAcknowledged?: string }).warningAcknowledged).toBe("template_without_opt_out");
  });

  it("unsubscribe replies are still enforced for templates without an opt-out line", async () => {
    const { ingestWebhook } = await import("@/server/webhooks/processor");
    const s = await setupSendingOrg();
    await addContacts(s.org.id, ["+972521000001"]);
    await ingestWebhook(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ id: s.account.wabaId, changes: [{ field: "messages", value: { metadata: { phone_number_id: s.phone.phoneNumberId }, messages: [{ from: "972521000001", id: "wamid.x1", timestamp: `${Math.floor(Date.now() / 1000)}`, type: "text", text: { body: "הסר" } }] } }] }],
      }),
    );
    expect((await db.contact.findFirstOrThrow({ where: { organizationId: s.org.id } })).isSuppressed).toBe(true);
  });
});

describe("one-time compliance", () => {
  it("one confirmation completes the setup", async () => {
    const { org, ctx } = await createOrg();
    expect((await evaluateCompliance(org.id)).ok).toBe(false);
    expect(await confirmRequiredCompliance(ctx)).toBeGreaterThan(0);
    expect((await evaluateCompliance(org.id)).ok).toBe(true);
  });

  it("expired reviews become reminders, never blocks; identity/privacy are recommendations", async () => {
    const { org, ctx } = await createOrg();
    await confirmRequiredCompliance(ctx);
    await db.complianceCheck.updateMany({ where: { organizationId: org.id }, data: { expiresAt: new Date(Date.now() - 86400_000) } });
    const res = await evaluateCompliance(org.id);
    expect(res.ok).toBe(true);
    expect(res.rules.some((r) => r.reminder)).toBe(true);
    expect(res.rules.find((r) => r.rule.code === "PRIVACY_POLICY")?.status).toBe("FAILED"); // not configured, yet ok=true
  });
});

describe("account connection help", () => {
  it("recognizes a Phone Number ID entered as the WABA ID", async () => {
    const { runHealthCheck } = await import("@/server/services/accounts");
    const s = await setupSendingOrg();
    installFakeMeta((call) => {
      if (call.url.includes("fields=id%2Cname")) return { status: 400, json: { error: { message: "(#100) Tried accessing nonexisting field (name)", code: 100 } } };
      if (call.url.includes("display_phone_number")) return { status: 200, json: { id: s.account.wabaId, display_phone_number: "+972 50-000-0000" } };
      return { status: 200, json: {} };
    });
    const res = await runHealthCheck(s.ctx, s.account.id);
    expect(res.ok).toBe(false);
    expect(res.checks.find((c) => c.key === "waba")?.detail).toContain("Phone Number ID");
  });
});

describe("audience modes", () => {
  it("manual selection sends only to picked, eligible contacts; other orgs' IDs match nothing", async () => {
    const s = await setupSendingOrg("A");
    const other = await setupSendingOrg("B");
    const [a1, a2] = await addContacts(s.org.id, ["+972521000001", "+972521000002"]);
    const [noConsent] = await addContacts(s.org.id, ["+972521000003"], "UNKNOWN");
    const [foreign] = await addContacts(other.org.id, ["+972521000009"]);
    const pv = await previewQuickCampaign(s.ctx, {
      phoneNumberId: s.phone.id,
      templateId: s.template.id,
      linkUrl: "https://example.com",
      audienceMode: "contacts",
      contactIds: [a1.id, noConsent.id, foreign.id],
    });
    expect(pv.audience).toMatchObject({ matched: 2, eligible: 1 });
    expect(pv.audience.reasons).toEqual({ NO_CONSENT: 1 });
    expect(a2).toBeTruthy();
    await expect(previewQuickCampaign(s.ctx, { phoneNumberId: s.phone.id, templateId: s.template.id, audienceMode: "contacts", contactIds: [] })).rejects.toThrow("לפחות איש קשר");
  });

  it("conditions mode filters by tags and excludes previous campaign recipients", async () => {
    const { createTag, bulkTagContacts } = await import("@/server/services/contacts");
    const s = await setupSendingOrg();
    const cs = await addContacts(s.org.id, ["+972521000001", "+972521000002", "+972521000003"]);
    const vip = await createTag(s.ctx, "VIP");
    await bulkTagContacts(s.ctx, [cs[0].id, cs[1].id], vip.id, "add");
    const pv = await previewQuickCampaign(s.ctx, {
      phoneNumberId: s.phone.id,
      templateId: s.template.id,
      linkUrl: "https://example.com",
      audienceMode: "conditions",
      conditions: { tagIds: [vip.id] },
    });
    expect(pv.audience.matched).toBe(2);
    const sent = await quickSendCampaign(s.ctx, { phoneNumberId: s.phone.id, templateId: s.template.id, linkUrl: "https://example.com", audienceMode: "contacts", contactIds: [cs[0].id] });
    const pv2 = await previewQuickCampaign(s.ctx, {
      phoneNumberId: s.phone.id,
      templateId: s.template.id,
      linkUrl: "https://example.com",
      audienceMode: "conditions",
      conditions: { tagIds: [vip.id], excludeCampaignIds: [sent.campaignId] },
    });
    expect(pv2.audience.matched).toBe(1);
  });
});

describe("campaign-level inputs never exclude contacts", () => {
  it("a missing header file is one input to fill, not a per-contact exclusion; uploaded media is sent by id", async () => {
    const { buildTemplatePayload } = await import("@/server/sending/payload");
    const s = await setupSendingOrg();
    await addContacts(s.org.id, ["+972521000001", "+972521000002"]);
    const comps = [{ type: "HEADER", format: "IMAGE" }, ...MARKETING_COMPONENTS];
    await db.messageTemplate.update({ where: { id: s.template.id }, data: { components: comps } });
    const pv = await previewQuickCampaign(s.ctx, { phoneNumberId: s.phone.id, templateId: s.template.id, linkUrl: "https://example.com" });
    expect(pv.audience).toMatchObject({ matched: 2, eligible: 2, excluded: 0 });
    expect(pv.items.find((i) => i.key === "media")?.ok).toBe(false);
    const ok = await previewQuickCampaign(s.ctx, { phoneNumberId: s.phone.id, templateId: s.template.id, linkUrl: "https://example.com", headerMediaUrl: "media:123456" });
    expect(ok.ok).toBe(true);
    const payload = buildTemplatePayload(
      { name: "t", language: "he", components: comps as never },
      { "body.1": { type: "static", value: "x" }, "button.0": { type: "static", value: "y" } },
      { phoneE164: "+972521000001", name: null, attributes: {}, clickToken: null },
      { trackingBase: "x", headerMediaUrl: "media:123456" },
    );
    expect(JSON.stringify(payload)).toContain('"image":{"id":"123456"}');
  });
});
