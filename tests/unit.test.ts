import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { normalizePhone, waIdToE164 } from "@/lib/phone";
import { isUnsubscribeButton, isUnsubscribeText, normalizeForMatch, UNSUBSCRIBE_BUTTON_PAYLOAD } from "@/lib/unsubscribe";
import { decryptSecret, encryptSecret, hashPhone } from "@/server/crypto";
import { verifyMetaSignature } from "@/server/webhooks/signature";
import { nextOutboundStatus } from "@/server/webhooks/status";
import { backoffMs, classifyMetaError, classifyNetworkError } from "@/server/meta/errors";
import { analyzeTemplate, templateSlots, validateTemplate, type TemplateComponent } from "@/lib/templates";
import { buildTemplatePayload, MissingVariableError } from "@/server/sending/payload";
import { isWithinSendingWindow, type SendingWindow } from "@/server/services/settings";
import { validateDestination, isBotUserAgent } from "@/server/services/links";
import { signOutgoing } from "@/server/services/outgoing-webhooks";
import { parseMessagingLimit } from "@/server/meta/client";
import { MARKETING_COMPONENTS } from "./helpers";

describe("phone normalization", () => {
  it.each([
    ["050-1234567", "+972501234567"],
    ["0501234567", "+972501234567"],
    ["972501234567", "+972501234567"],
    ["9720501234567", "+972501234567"],
    ["+972-50-123-4567", "+972501234567"],
    ["00972501234567", "+972501234567"],
    ["(050) 123 4567", "+972501234567"],
    ["‏050-1234567‎", "+972501234567"],
    ["501234567", "+972501234567"],
    ["972501234567.0", "+972501234567"],
    ["+1 (415) 555-2671", "+14155552671"],
    ["03-6123456", "+97236123456"],
  ])("%s → %s", (input, expected) => {
    const r = normalizePhone(input);
    expect(r.ok && r.e164).toBe(expected);
  });

  it.each(["", "abc", "123", "050-12", "9.72501E+11", null, undefined])("rejects %s", (input) => {
    expect(normalizePhone(input).ok).toBe(false);
  });

  it("flags mobile numbers", () => {
    const m = normalizePhone("0501234567");
    const l = normalizePhone("03-6123456");
    expect(m.ok && m.isMobile).toBe(true);
    expect(l.ok && l.isMobile).toBe(false);
  });

  it("converts wa_id", () => expect(waIdToE164("972501234567")).toBe("+972501234567"));
});

describe("unsubscribe keyword detection", () => {
  it.each(["הסר", "הסרה", "להסיר", "אסר", "STOP", "stop", "Unsubscribe", "REMOVE", " הסר ", "הסר!", "הסר.", "הֲסֵר", "הסררר", "הסר אותי", "הסר אותי בבקשה", "בבקשה להסיר אותי מהרשימה", "Stop please", "‏הסר‎", "🛑 הסר"])(
    "detects %s",
    (t) => expect(isUnsubscribeText(t)).toBe(true),
  );

  it.each(["", "שלום", "הסרתי את התמונה מהאתר אתמול", "מעוניין בפרטים", "stopwatch", "אני רוצה לשמוע עוד על ההצעה שלכם, אבל לא עכשיו כי אני עסוק מאוד השבוע ואשמח שתחזרו אליי"])(
    "ignores %s",
    (t) => expect(isUnsubscribeText(t)).toBe(false),
  );

  it("long messages need an exact keyword match", () => {
    expect(isUnsubscribeText("אני מאוד אוהב את השירות שלכם אבל יש לי שאלה על הסר כתמים")).toBe(false);
  });

  it("supports custom keywords", () => {
    expect(isUnsubscribeText("די", ["די"])).toBe(true);
    expect(isUnsubscribeText("הסר", ["די"])).toBe(false);
  });

  it("folds final letters and strips niqqud", () => {
    expect(normalizeForMatch("שָׁלוֹם")).toBe("שלומ");
  });

  it("detects unsubscribe buttons by payload or text", () => {
    expect(isUnsubscribeButton(UNSUBSCRIBE_BUTTON_PAYLOAD, "x")).toBe(true);
    expect(isUnsubscribeButton(null, "הסרה")).toBe(true);
    expect(isUnsubscribeButton("INTERESTED", "מעוניין")).toBe(false);
  });
});

describe("crypto", () => {
  it("encrypts and decrypts secrets", () => {
    const enc = encryptSecret("EAAJtoken");
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain("EAAJtoken");
    expect(decryptSecret(enc)).toBe("EAAJtoken");
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("detects tampering", () => {
    const enc = encryptSecret("secret");
    const buf = Buffer.from(enc.slice(3), "base64");
    buf[buf.length - 1] ^= 1;
    expect(() => decryptSecret(`v1:${buf.toString("base64")}`)).toThrow();
  });

  it("phone hash is stable and keyed", () => {
    expect(hashPhone("+972501234567")).toBe(hashPhone("+972501234567"));
    expect(hashPhone("+972501234567")).not.toBe(hashPhone("+972501234568"));
    expect(hashPhone("+972501234567")).toHaveLength(64);
  });
});

describe("Meta webhook signature", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
  it("accepts a valid signature", () => expect(verifyMetaSignature(body, sig, "s3cret")).toBe(true));
  it("rejects wrong secret", () => expect(verifyMetaSignature(body, sig, "other")).toBe(false));
  it("rejects modified body", () => expect(verifyMetaSignature(body + " ", sig, "s3cret")).toBe(false));
  it("rejects missing/malformed header", () => {
    expect(verifyMetaSignature(body, null, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abc", "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zz", "s3cret")).toBe(false);
  });
  it("rejects when no secret configured", () => expect(verifyMetaSignature(body, sig, "")).toBe(false));
});

describe("outbound status transitions", () => {
  it("moves forward only", () => {
    expect(nextOutboundStatus("SUBMITTED", "sent")).toBe("SENT");
    expect(nextOutboundStatus("SENT", "delivered")).toBe("DELIVERED");
    expect(nextOutboundStatus("DELIVERED", "read")).toBe("READ");
    expect(nextOutboundStatus("READ", "delivered")).toBeNull();
    expect(nextOutboundStatus("DELIVERED", "sent")).toBeNull();
  });
  it("handles out-of-order read before delivered", () => {
    expect(nextOutboundStatus("SUBMITTED", "read")).toBe("READ");
  });
  it("failed never overrides delivery", () => {
    expect(nextOutboundStatus("DELIVERED", "failed")).toBeNull();
    expect(nextOutboundStatus("SENT", "failed")).toBe("FAILED");
    expect(nextOutboundStatus("FAILED", "delivered")).toBe("DELIVERED");
  });
  it("reconciles uncertain messages", () => {
    expect(nextOutboundStatus("UNCERTAIN", "sent")).toBe("SENT");
    expect(nextOutboundStatus("SENDING", "delivered")).toBe("DELIVERED");
  });
  it("ignores cancelled/skipped", () => {
    expect(nextOutboundStatus("CANCELLED", "sent")).toBeNull();
  });
});

describe("Meta error classification", () => {
  it.each([
    [500, 131000, "RETRYABLE"],
    [503, null, "RETRYABLE"],
    [429, 130429, "RATE_LIMITED"],
    [400, 131056, "RATE_LIMITED"],
    [400, 131026, "PERMANENT"],
    [400, 132001, "PERMANENT"],
    [400, 131049, "PERMANENT"],
    [400, 131050, "RECIPIENT_OPTED_OUT"],
    [401, 190, "ACCOUNT"],
    [400, 131031, "ACCOUNT"],
    [400, 132015, "ACCOUNT"],
    [400, 100, "PERMANENT"],
  ] as const)("HTTP %s code %s → %s", (status, code, cls) => expect(classifyMetaError(status, code)).toBe(cls));

  it("network errors: pre-connect retryable, others uncertain", () => {
    expect(classifyNetworkError({ cause: { code: "ECONNREFUSED" } })).toBe("RETRYABLE");
    expect(classifyNetworkError({ cause: { code: "ENOTFOUND" } })).toBe("RETRYABLE");
    expect(classifyNetworkError({ name: "TimeoutError" })).toBe("UNCERTAIN");
    expect(classifyNetworkError({ cause: { code: "ECONNRESET" } })).toBe("UNCERTAIN");
  });

  it("exponential backoff grows and is capped", () => {
    const r = () => 1;
    expect(backoffMs(1, "RETRYABLE", r)).toBe(15_000);
    expect(backoffMs(2, "RETRYABLE", r)).toBe(30_000);
    expect(backoffMs(10, "RETRYABLE", r)).toBe(20 * 60_000);
    expect(backoffMs(1, "RATE_LIMITED", r)).toBe(60_000);
  });

  it("parses messaging limit tiers", () => {
    expect(parseMessagingLimit("TIER_250")).toBe(250);
    expect(parseMessagingLimit("TIER_2K")).toBe(2000);
    expect(parseMessagingLimit("10000")).toBe(10000);
    expect(parseMessagingLimit("TIER_UNLIMITED")).toBe(Infinity);
    expect(parseMessagingLimit(null)).toBeNull();
  });
});

describe("templates", () => {
  it("analyzes opt-out and advertising label", () => {
    const a = analyzeTemplate(MARKETING_COMPONENTS);
    expect(a.hasUnsubscribeFooter).toBe(true);
    expect(a.hasUnsubscribeButton).toBe(true);
    expect(a.unsubscribeButtonIndex).toBe(1);
    expect(a.hasAdvertisingLabel).toBe(true);
  });

  it("warns (does not block) when a marketing template has no opt-out", () => {
    const issues = validateTemplate({ name: "x", category: "MARKETING", components: [{ type: "BODY", text: "פרסומת: מבצע חדש לכולם היום" }] });
    expect(issues.some((i) => i.level === "warning" && i.message.includes("הסרה"))).toBe(true);
    expect(issues.some((i) => i.level === "error")).toBe(false);
  });

  it("validates names, variables, lengths and buttons", () => {
    const comps: TemplateComponent[] = [
      { type: "HEADER", format: "TEXT", text: "{{1}} {{2}}" },
      { type: "BODY", text: "{{1}} hello {{3}}" },
      { type: "FOOTER", text: "x{{1}}" },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "a", url: "http://x.com/{{1}}/y" }] },
    ];
    const errors = validateTemplate({ name: "Bad Name", category: "UTILITY", components: comps }).filter((i) => i.level === "error").map((i) => i.message);
    expect(errors.length).toBeGreaterThanOrEqual(6);
  });

  it("extracts variable slots", () => {
    expect(templateSlots(MARKETING_COMPONENTS).map((s) => s.key)).toEqual(["body.1", "button.0"]);
  });

  it("builds a template payload with per-recipient tracked link and unsubscribe payload", () => {
    const payload = buildTemplatePayload(
      { name: "promo", language: "he", components: MARKETING_COMPONENTS },
      { "body.1": { type: "contact_field", field: "first_name", fallback: "לקוח" }, "button.0": { type: "tracked_link" } },
      { phoneE164: "+972501234567", name: "דנה כהן", attributes: {}, clickToken: "abc123XYZ" },
      { trackingBase: "https://t.test" },
    ) as { to: string; template: { components: Array<Record<string, unknown>> } };
    expect(payload.to).toBe("972501234567");
    expect(JSON.stringify(payload)).toContain('"text":"דנה"');
    expect(JSON.stringify(payload)).toContain('"text":"abc123XYZ"');
    expect(JSON.stringify(payload)).toContain("WCM_UNSUBSCRIBE");
    expect(JSON.stringify(payload)).not.toContain("+972");
  });

  it("uses fallbacks and rejects empty variables", () => {
    const tpl = { name: "p", language: "he", components: MARKETING_COMPONENTS };
    const r = { phoneE164: "+972501234567", name: null, attributes: {}, clickToken: "tok" };
    expect(() => buildTemplatePayload(tpl, { "body.1": { type: "contact_field", field: "name" }, "button.0": { type: "tracked_link" } }, r, { trackingBase: "x" })).toThrow(MissingVariableError);
    expect(() => buildTemplatePayload(tpl, { "body.1": { type: "contact_field", field: "name", fallback: "לקוח" }, "button.0": { type: "tracked_link" } }, r, { trackingBase: "x" })).not.toThrow();
  });
});

describe("sending window", () => {
  const window: SendingWindow = { "0": ["09:00", "20:00"], "5": ["09:00", "13:00"] };
  it("respects day and hours in business timezone", () => {
    // 2026-10-18 is a Sunday. 10:00 Israel (UTC+3) = 07:00Z
    expect(isWithinSendingWindow(window, "Asia/Jerusalem", new Date("2026-10-18T07:00:00Z"))).toBe(true);
    expect(isWithinSendingWindow(window, "Asia/Jerusalem", new Date("2026-10-18T18:30:00Z"))).toBe(false);
    // Saturday
    expect(isWithinSendingWindow(window, "Asia/Jerusalem", new Date("2026-10-17T09:00:00Z"))).toBe(false);
    // Friday 14:00 local
    expect(isWithinSendingWindow(window, "Asia/Jerusalem", new Date("2026-10-23T11:00:00Z"))).toBe(false);
  });
});

describe("links & outgoing webhooks", () => {
  it("validates redirect destinations", () => {
    expect(validateDestination("https://example.com/x", [])).toBe("https://example.com/x");
    expect(() => validateDestination("javascript:alert(1)", [])).toThrow();
    expect(() => validateDestination("//evil.com", [])).toThrow();
    expect(() => validateDestination("https://user:pw@example.com", [])).toThrow();
    expect(() => validateDestination("https://evil.com", ["example.com"])).toThrow();
    expect(validateDestination("https://shop.example.com/a", ["example.com"])).toContain("shop.example.com");
    expect(() => validateDestination("https://notexample.com", ["example.com"])).toThrow();
  });

  it("detects link-preview bots", () => {
    expect(isBotUserAgent("WhatsApp/2.23.20.0 A")).toBe(true);
    expect(isBotUserAgent("facebookexternalhit/1.1")).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1")).toBe(false);
  });

  it("signs outgoing webhooks verifiably", () => {
    const sig = signOutgoing("whsec_x", '{"a":1}', 1700000000);
    const expected = createHmac("sha256", "whsec_x").update('1700000000.{"a":1}').digest("hex");
    expect(sig).toBe(`t=1700000000,v1=${expected}`);
  });
});
