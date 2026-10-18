import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { db } from "@/server/db";
import { claimMessages, processClaimed, recoverStuckMessages } from "@/server/sending/sender";
import { advanceCampaigns, sendTickForPhone } from "@/server/sending/scheduler";
import { createCampaign, launchCampaign, pauseCampaign, preflight, resumeCampaign, cancelCampaign, sendTestMessage } from "@/server/services/campaigns";
import { ingestWebhook } from "@/server/webhooks/processor";
import { recordClick } from "@/server/services/links";
import { verifyMetaSignature } from "@/server/webhooks/signature";
import { addContacts, installFakeMeta, metaError, resetDb, setupSendingOrg, uninstallFakeMeta } from "./helpers";

beforeEach(resetDb);
afterEach(uninstallFakeMeta);

const mapping = { "body.1": { type: "contact_field", field: "first_name", fallback: "לקוח" }, "button.0": { type: "tracked_link" } };

async function launchedCampaign(phones: string[], opts: { consent?: "GRANTED" | "UNKNOWN" } = {}) {
  const s = await setupSendingOrg();
  const contacts = await addContacts(s.org.id, phones, opts.consent ?? "GRANTED");
  const campaign = await createCampaign(s.ctx, {
    name: "Test",
    accountId: s.account.id,
    phoneNumberId: s.phone.id,
    templateId: s.template.id,
    variableMapping: mapping,
    trackedLinkId: s.link.id,
    audienceFilter: {},
  });
  return { ...s, contacts, campaign };
}

async function launch(s: Awaited<ReturnType<typeof launchedCampaign>>) {
  const pf = await preflight(s.ctx, s.campaign.id);
  if (!pf.ok) throw new Error(JSON.stringify(pf.items.filter((i) => !i.ok)));
  await launchCampaign(s.ctx, s.campaign.id, { confirmedEligibleCount: pf.audience.eligible });
  await advanceCampaigns();
}

function statusWebhook(phoneNumberId: string, wabaId: string, statuses: object[]) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: wabaId, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId }, statuses } }] }],
  });
}

function inboundWebhook(phoneNumberId: string, wabaId: string, message: object, name = "לקוח") {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ profile: { name }, wa_id: (message as { from: string }).from }],
              messages: [message],
            },
          },
        ],
      },
    ],
  });
}

describe("campaign launch & eligibility", () => {
  it("excludes contacts without consent or with suppression, and explains why", async () => {
    const s = await launchedCampaign(["+972521000001", "+972521000002"]);
    await addContacts(s.org.id, ["+972521000003"], "UNKNOWN");
    await db.contact.update({ where: { id: s.contacts[1].id }, data: { isSuppressed: true } });
    const pf = await preflight(s.ctx, s.campaign.id);
    expect(pf.audience).toMatchObject({ matched: 3, eligible: 1, excluded: 2 });
    expect(pf.audience.reasons).toEqual({ SUPPRESSED: 1, NO_CONSENT: 1 });
    expect(pf.estimate.cost).toBe(0.05);
    await launchCampaign(s.ctx, s.campaign.id, { confirmedEligibleCount: 1 });
    expect(await db.outboundMessage.count({ where: { campaignId: s.campaign.id } })).toBe(1);
    expect(await db.campaignRecipient.count({ where: { campaignId: s.campaign.id, eligibility: "EXCLUDED" } })).toBe(2);
  });

  it("blocks launch when compliance is not satisfied", async () => {
    const s = await launchedCampaign(["+972521000001"]);
    await db.complianceCheck.deleteMany({ where: { organizationId: s.org.id } });
    const pf = await preflight(s.ctx, s.campaign.id);
    expect(pf.ok).toBe(false);
    await expect(launchCampaign(s.ctx, s.campaign.id, { confirmedEligibleCount: 1 })).rejects.toThrow("תאימות");
  });

  it("blocks launch with an unapproved template or a non-opt-out marketing template", async () => {
    const s = await launchedCampaign(["+972521000001"]);
    await db.messageTemplate.update({ where: { id: s.template.id }, data: { status: "PENDING" } });
    expect((await preflight(s.ctx, s.campaign.id)).ok).toBe(false);
    await db.messageTemplate.update({ where: { id: s.template.id }, data: { status: "APPROVED", components: [{ type: "BODY", text: "פרסומת: שלום {{1}} מבצע" }] } });
    const pf = await preflight(s.ctx, s.campaign.id);
    expect(pf.items.find((i) => i.key === "optout")?.ok).toBe(false);
  });

  it("refuses launch when the audience changed since confirmation", async () => {
    const s = await launchedCampaign(["+972521000001"]);
    await expect(launchCampaign(s.ctx, s.campaign.id, { confirmedEligibleCount: 5 })).rejects.toThrow("השתנה");
  });

  it("cannot launch twice", async () => {
    const s = await launchedCampaign(["+972521000001"]);
    await launch(s);
    await expect(launchCampaign(s.ctx, s.campaign.id, { confirmedEligibleCount: 1 })).rejects.toThrow();
  });
});

describe("sending engine", () => {
  it("sends each message exactly once with the right payload", async () => {
    const calls = installFakeMeta();
    const s = await launchedCampaign(["+972521000001", "+972521000002", "+972521000003"]);
    await launch(s);
    await sendTickForPhone("w1", s.phone.id, new Map());
    expect(calls).toHaveLength(3);
    const body = calls[0].body as Record<string, unknown>;
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.type).toBe("template");
    expect(typeof body.biz_opaque_callback_data).toBe("string");
    expect(calls[0].url).toContain(`/${s.phone.phoneNumberId}/messages`);
    const msgs = await db.outboundMessage.findMany({ where: { campaignId: s.campaign.id } });
    expect(msgs.every((m) => m.status === "SUBMITTED" && m.wamid)).toBe(true);
    // Nothing left: another tick sends nothing.
    await sendTickForPhone("w1", s.phone.id, new Map());
    expect(calls).toHaveLength(3);
    await advanceCampaigns();
    expect((await db.campaign.findUniqueOrThrow({ where: { id: s.campaign.id } })).status).toBe("COMPLETED");
  });

  it("concurrent workers never claim the same message", async () => {
    const s = await launchedCampaign(Array.from({ length: 30 }, (_, i) => `+9725210000${String(i).padStart(2, "0")}`));
    await launch(s);
    const opts = { limit: 30, campaignLimit: 30, windowOpen: true };
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => claimMessages(`w${n}`, s.phone.id, opts)));
    const ids = results.flat().map((m) => m.id);
    expect(ids).toHaveLength(30);
    expect(new Set(ids).size).toBe(30);
  });

  it("an unsubscribe during a campaign stops that recipient's pending message", async () => {
    const calls = installFakeMeta();
    const s = await launchedCampaign(["+972521000001", "+972521000002"]);
    await launch(s);
    const before = await db.outboundMessage.count({ where: { campaignId: s.campaign.id, status: "QUEUED" } });
    expect(before).toBe(2);
    // Recipient replies "הסר" (e.g. to an earlier campaign) before their message goes out.
    await ingestWebhook(inboundWebhook(s.phone.phoneNumberId, s.account.wabaId, { from: "972521000002", id: "wamid.in1", timestamp: `${Math.floor(Date.now() / 1000)}`, type: "text", text: { body: "הסר" } }));
    const cancelled = await db.outboundMessage.findFirstOrThrow({ where: { campaignId: s.campaign.id, toPhone: "+972521000002" } });
    expect(cancelled.status).toBe("CANCELLED");
    await sendTickForPhone("w1", s.phone.id, new Map());
    const campaignCalls = calls.filter((c) => (c.body as { type?: string })?.type === "template");
    expect(campaignCalls).toHaveLength(1);
    expect((campaignCalls[0].body as { to: string }).to).toBe("972521000001");
    // The confirmation reply is a free-form text inside the service window.
    const textCalls = calls.filter((c) => (c.body as { type?: string })?.type === "text");
    expect(textCalls).toHaveLength(1);
  });

  it("pre-send check skips a message whose contact lost consent after launch", async () => {
    installFakeMeta();
    const s = await launchedCampaign(["+972521000001"]);
    await launch(s);
    await db.contact.update({ where: { id: s.contacts[0].id }, data: { consentStatus: "REVOKED" } });
    await sendTickForPhone("w1", s.phone.id, new Map());
    const m = await db.outboundMessage.findFirstOrThrow({ where: { campaignId: s.campaign.id } });
    expect(m.status).toBe("SKIPPED");
    expect(m.errorCode).toBe("NO_CONSENT");
  });

  it("pause stops sending; resume continues; cancel cancels the rest", async () => {
    const calls = installFakeMeta();
    const s = await launchedCampaign(["+972521000001", "+972521000002"]);
    await launch(s);
    await pauseCampaign(s.ctx, s.campaign.id);
    await sendTickForPhone("w1", s.phone.id, new Map());
    expect(calls).toHaveLength(0);
    await resumeCampaign(s.ctx, s.campaign.id);
    await cancelCampaign(s.ctx, s.campaign.id);
    await sendTickForPhone("w1", s.phone.id, new Map());
    expect(calls).toHaveLength(0);
    expect(await db.outboundMessage.count({ where: { campaignId: s.campaign.id, status: "CANCELLED" } })).toBe(2);
  });

  it("retries transient errors with backoff, then fails after max attempts", async () => {
    installFakeMeta(() => metaError(131000, 500));
    const s = await launchedCampaign(["+972521000001"]);
    await launch(s);
    await sendTickForPhone("w1", s.phone.id, new Map());
    let m = await db.outboundMessage.findFirstOrThrow({ where: { campaignId: s.campaign.id } });
    expect(m.status).toBe("QUEUED");
    expect(m.attempts).toBe(1);
    expect(m.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 5_000);
    await db.outboundMessage.update({ where: { id: m.id }, data: { attempts: m.maxAttempts - 1, nextAttemptAt: new Date() } });
    await sendTickForPhone("w1", s.phone.id, new Map());
    m = await db.outboundMessage.findFirstOrThrow({ where: { id: m.id } });
    expect(m.status).toBe("FAILED");
    expect(m.errorTitle).toBe("MAX_ATTEMPTS");
  });

  it("permanent errors are not retried", async () => {
    installFakeMeta(() => metaError(131026));
    const s = await launchedCampaign(["+972521000001"]);
    await launch(s);
    await sendTickForPhone("w1", s.phone.id, new Map());
    const m = await db.outboundMessage.findFirstOrThrow({ where: { campaignId: s.campaign.id } });
    expect(m.status).toBe("FAILED");
    expect(m.errorCode).toBe("131026");
  });

  it("131050 (user stopped marketing) suppresses the number", async () => {
    installFakeMeta(() => metaError(131050));
    const s = await launchedCampaign(["+972521000001"]);
    await launch(s);
    await sendTickForPhone("w1", s.phone.id, new Map());
    const entry = await db.suppressionEntry.findFirst({ where: { organizationId: s.org.id } });
    expect(entry?.reason).toBe("META_USER_STOPPED_MARKETING");
  });

  it("account errors requeue the message and pause the campaign", async () => {
    installFakeMeta(() => metaError(190, 401, "token expired"));
    const s = await launchedCampaign(["+972521000001", "+972521000002"]);
    await launch(s);
    await sendTickForPhone("w1", s.phone.id, new Map());
    const c = await db.campaign.findUniqueOrThrow({ where: { id: s.campaign.id } });
    expect(c.status).toBe("PAUSED");
    expect(c.pausedReason).toContain("190");
    expect(await db.outboundMessage.count({ where: { campaignId: s.campaign.id, status: "QUEUED" } })).toBe(2);
    expect((await db.whatsappAccount.findUniqueOrThrow({ where: { id: s.account.id } })).status).toBe("ERROR");
  });

  it("timeouts become UNCERTAIN and are never resent automatically", async () => {
    let n = 0;
    installFakeMeta(() => {
      n++;
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    });
    const s = await launchedCampaign(["+972521000001"]);
    await launch(s);
    await sendTickForPhone("w1", s.phone.id, new Map());
    await sendTickForPhone("w1", s.phone.id, new Map());
    expect(n).toBe(1);
    const m = await db.outboundMessage.findFirstOrThrow({ where: { campaignId: s.campaign.id } });
    expect(m.status).toBe("UNCERTAIN");
  });

  it("crash recovery: stuck SENDING → UNCERTAIN, then a status webhook reconciles via biz_opaque_callback_data", async () => {
    const s = await launchedCampaign(["+972521000001"]);
    await launch(s);
    // Simulate: worker claimed, Meta accepted, process died before saving the wamid.
    const [claimed] = await claimMessages("dead-worker", s.phone.id, { limit: 1, campaignLimit: 1, windowOpen: true });
    await db.outboundMessage.update({ where: { id: claimed.id }, data: { lockedAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await recoverStuckMessages()).toBe(1);
    expect((await db.outboundMessage.findUniqueOrThrow({ where: { id: claimed.id } })).status).toBe("UNCERTAIN");

    const ts = `${Math.floor(Date.now() / 1000)}`;
    await ingestWebhook(statusWebhook(s.phone.phoneNumberId, s.account.wabaId, [{ id: "wamid.recovered", status: "delivered", timestamp: ts, recipient_id: "972521000001", biz_opaque_callback_data: claimed.bizOpaqueId }]));
    const m = await db.outboundMessage.findUniqueOrThrow({ where: { id: claimed.id } });
    expect(m.status).toBe("DELIVERED");
    expect(m.wamid).toBe("wamid.recovered");
  });

  it("respects the rolling 24h unique-recipient cap", async () => {
    const calls = installFakeMeta();
    const s = await launchedCampaign(["+972521000001", "+972521000002", "+972521000003"]);
    await db.businessSettings.update({ where: { organizationId: s.org.id }, data: { safetyRollingCap: 2 } });
    await launch(s);
    await sendTickForPhone("w1", s.phone.id, new Map());
    await sendTickForPhone("w1", s.phone.id, new Map());
    expect(calls).toHaveLength(2);
    expect(await db.outboundMessage.count({ where: { campaignId: s.campaign.id, status: "QUEUED" } })).toBe(1);
  });

  it("does not send campaign messages outside the sending window", async () => {
    const calls = installFakeMeta();
    const s = await launchedCampaign(["+972521000001"]);
    await launch(s);
    await db.businessSettings.update({ where: { organizationId: s.org.id }, data: { sendingWindow: {} } });
    await sendTickForPhone("w1", s.phone.id, new Map());
    expect(calls).toHaveLength(0);
  });

  it("only one worker holds a sender number's lease", async () => {
    installFakeMeta();
    const s = await launchedCampaign(["+972521000001", "+972521000002"]);
    await launch(s);
    const [a, b] = await Promise.all([sendTickForPhone("wA", s.phone.id, new Map()), sendTickForPhone("wB", s.phone.id, new Map())]);
    expect([a, b].sort()).toEqual([0, 2]);
  });

  it("test sends go only to configured test numbers", async () => {
    const calls = installFakeMeta();
    const s = await launchedCampaign(["+972521000001"]);
    await expect(sendTestMessage(s.ctx, { campaignId: s.campaign.id, phone: "0529999999" })).rejects.toThrow("מספרי בדיקה");
    const r = await sendTestMessage(s.ctx, { campaignId: s.campaign.id, phone: "0501111111" });
    expect(r.status).toBe("SUBMITTED");
    expect(calls).toHaveLength(1);
  });
});

describe("webhooks", () => {
  it("verifies the platform signature over the raw body", () => {
    const body = statusWebhook("1", "2", []);
    const sig = "sha256=" + createHmac("sha256", "test-platform-app-secret").update(body).digest("hex");
    expect(verifyMetaSignature(body, sig, process.env.META_APP_SECRET!)).toBe(true);
  });

  it("applies statuses in order, dedupes, and treats read as delivered", async () => {
    installFakeMeta();
    const s = await launchedCampaign(["+972521000001"]);
    await launch(s);
    await sendTickForPhone("w1", s.phone.id, new Map());
    const m = await db.outboundMessage.findFirstOrThrow({ where: { campaignId: s.campaign.id } });
    const t = Math.floor(Date.now() / 1000);
    const read = statusWebhook(s.phone.phoneNumberId, s.account.wabaId, [{ id: m.wamid, status: "read", timestamp: `${t + 5}` }]);
    const sent = statusWebhook(s.phone.phoneNumberId, s.account.wabaId, [{ id: m.wamid, status: "sent", timestamp: `${t}`, pricing: { billable: true, category: "marketing" } }]);
    await ingestWebhook(read);
    await ingestWebhook(sent); // out of order
    const dup = await ingestWebhook(read); // exact duplicate delivery
    expect(dup.stored).toBe(false);
    const after = await db.outboundMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.status).toBe("READ");
    expect(after.deliveredAt).not.toBeNull();
    expect(after.sentAt).not.toBeNull();
    expect(after.billable).toBe(true);
    const contact = await db.contact.findUniqueOrThrow({ where: { id: s.contacts[0].id } });
    expect(contact.readCount).toBe(1);
    expect(contact.deliveredCount).toBe(1);
    expect(await db.messageEvent.count({ where: { messageId: m.id, type: { in: ["read", "sent"] } } })).toBe(2);
  });

  it("records failures with error details", async () => {
    installFakeMeta();
    const s = await launchedCampaign(["+972521000001"]);
    await launch(s);
    await sendTickForPhone("w1", s.phone.id, new Map());
    const m = await db.outboundMessage.findFirstOrThrow({ where: { campaignId: s.campaign.id } });
    await ingestWebhook(statusWebhook(s.phone.phoneNumberId, s.account.wabaId, [{ id: m.wamid, status: "failed", timestamp: `${Math.floor(Date.now() / 1000)}`, errors: [{ code: 131049, title: "ecosystem" }] }]));
    const after = await db.outboundMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.status).toBe("FAILED");
    expect(after.errorCode).toBe("131049");
  });

  it("inbound 'הסר' creates a real suppression, revokes consent, logs audit, and queues a confirmation", async () => {
    const s = await launchedCampaign(["+972521000001"]);
    const ts = `${Math.floor(Date.now() / 1000)}`;
    await ingestWebhook(inboundWebhook(s.phone.phoneNumberId, s.account.wabaId, { from: "972521000001", id: "wamid.unsub", timestamp: ts, type: "text", text: { body: "הֲסֵר!" } }));
    const c = await db.contact.findUniqueOrThrow({ where: { id: s.contacts[0].id } });
    expect(c.isSuppressed).toBe(true);
    expect(c.consentStatus).toBe("REVOKED");
    expect(await db.suppressionEntry.count({ where: { organizationId: s.org.id, reason: "KEYWORD_REPLY" } })).toBe(1);
    expect(await db.auditLog.count({ where: { organizationId: s.org.id, action: "suppression.add" } })).toBe(1);
    const confirmation = await db.outboundMessage.findFirst({ where: { organizationId: s.org.id, kind: "UNSUBSCRIBE_CONFIRMATION" } });
    expect(confirmation).toBeTruthy();
    const inbound = await db.inboundMessage.findUniqueOrThrow({ where: { wamid: "wamid.unsub" } });
    expect(inbound.isUnsubscribe).toBe(true);
  });

  it("quick-reply unsubscribe button works via payload", async () => {
    const s = await launchedCampaign(["+972521000001"]);
    await ingestWebhook(
      inboundWebhook(s.phone.phoneNumberId, s.account.wabaId, { from: "972521000001", id: "wamid.btn", timestamp: `${Math.floor(Date.now() / 1000)}`, type: "button", button: { payload: "WCM_UNSUBSCRIBE", text: "הסרה" } }),
    );
    expect(await db.suppressionEntry.count({ where: { organizationId: s.org.id, reason: "QUICK_REPLY_BUTTON" } })).toBe(1);
  });

  it("inbound from an unknown number creates a contact with UNKNOWN consent and a conversation", async () => {
    const s = await launchedCampaign([]);
    await ingestWebhook(inboundWebhook(s.phone.phoneNumberId, s.account.wabaId, { from: "972529990000", id: "wamid.new", timestamp: `${Math.floor(Date.now() / 1000)}`, type: "text", text: { body: "שלום, אשמח לפרטים" } }, "יעל"));
    const c = await db.contact.findFirstOrThrow({ where: { organizationId: s.org.id, phoneE164: "+972529990000" } });
    expect(c.consentStatus).toBe("UNKNOWN");
    expect(c.name).toBe("יעל");
    expect(await db.conversation.count({ where: { contactId: c.id } })).toBe(1);
  });

  it("interest button reply creates a lead (default automation)", async () => {
    const s = await launchedCampaign(["+972521000001"]);
    await ingestWebhook(
      inboundWebhook(s.phone.phoneNumberId, s.account.wabaId, { from: "972521000001", id: "wamid.lead", timestamp: `${Math.floor(Date.now() / 1000)}`, type: "button", button: { payload: "מעוניין", text: "מעוניין" } }),
    );
    expect(await db.lead.count({ where: { organizationId: s.org.id } })).toBe(1);
    const convo = await db.conversation.findFirstOrThrow({ where: { organizationId: s.org.id } });
    expect(convo.status).toBe("INTERESTED");
  });

  it("ignores webhooks whose phone number doesn't belong to the envelope's WABA", async () => {
    const A = await launchedCampaign(["+972521000001"]);
    await ingestWebhook(inboundWebhook(A.phone.phoneNumberId, "999999", { from: "972521000001", id: "wamid.spoof", timestamp: "1", type: "text", text: { body: "הסר" } }));
    expect(await db.suppressionEntry.count()).toBe(0);
  });

  it("template status webhooks update templates", async () => {
    const s = await setupSendingOrg();
    await ingestWebhook(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ id: s.account.wabaId, changes: [{ field: "message_template_status_update", value: { event: "REJECTED", message_template_id: s.template.metaTemplateId, reason: "INVALID_FORMAT" } }] }],
      }),
    );
    const t = await db.messageTemplate.findUniqueOrThrow({ where: { id: s.template.id } });
    expect(t.status).toBe("REJECTED");
    expect(t.rejectedReason).toBe("INVALID_FORMAT");
  });
});

describe("click tracking", () => {
  it("attributes per-recipient clicks, excludes bots, counts unique", async () => {
    installFakeMeta();
    const s = await launchedCampaign(["+972521000001"]);
    await launch(s);
    const r = await db.campaignRecipient.findFirstOrThrow({ where: { campaignId: s.campaign.id, eligibility: "ELIGIBLE" } });
    expect(r.clickToken).toMatch(/^[A-Za-z0-9]{14}$/);
    const human = "Mozilla/5.0 (iPhone) Safari/604.1";
    expect(await recordClick(r.clickToken!, { ip: "1.2.3.4", userAgent: "WhatsApp/2.24" })).toEqual({ destination: "https://example.com/offer" });
    await recordClick(r.clickToken!, { ip: "1.2.3.4", userAgent: human });
    await recordClick(r.clickToken!, { ip: "1.2.3.4", userAgent: human });
    const clicks = await db.linkClick.findMany({ where: { campaignId: s.campaign.id } });
    expect(clicks).toHaveLength(3);
    expect(clicks.filter((c) => c.isBot)).toHaveLength(1);
    expect(clicks.filter((c) => c.isUnique)).toHaveLength(1);
    expect(clicks.every((c) => !JSON.stringify(c).includes("972521000001"))).toBe(true);
    expect((await db.contact.findUniqueOrThrow({ where: { id: s.contacts[0].id } })).clickCount).toBe(1);
  });

  it("unknown or malformed tokens resolve to nothing (no open redirect)", async () => {
    expect(await recordClick("doesnotexist1", { ip: "1", userAgent: "x" })).toBeNull();
    expect(await recordClick("https://evil.com", { ip: "1", userAgent: "x" })).toBeNull();
  });

  it("aggregate-only mode does not link clicks to contacts", async () => {
    installFakeMeta();
    const s = await launchedCampaign(["+972521000001"]);
    await db.businessSettings.update({ where: { organizationId: s.org.id }, data: { perContactClickTracking: false } });
    await launch(s);
    const r = await db.campaignRecipient.findFirstOrThrow({ where: { campaignId: s.campaign.id, eligibility: "ELIGIBLE" } });
    await recordClick(r.clickToken!, { ip: "1.2.3.4", userAgent: "Mozilla/5.0 Safari" });
    const click = await db.linkClick.findFirstOrThrow({ where: { campaignId: s.campaign.id } });
    expect(click.contactId).toBeNull();
    expect(click.recipientId).toBeNull();
  });
});
