import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { hashPhone } from "@/server/crypto";
import { UserError } from "@/server/rbac";
import { importContactRows, parseSpreadsheet } from "@/server/services/imports";
import { createContact, deleteContact, updateContact } from "@/server/services/contacts";
import { grantConsent } from "@/server/services/consents";
import { resubscribeWithNewConsent, suppressPhone, isPhoneSuppressed } from "@/server/services/suppression";
import { createOrg, ctxFor, resetDb } from "./helpers";

beforeEach(resetDb);

const mapping = { phone: "טלפון", name: "שם", tags: "תגיות" };

describe("CSV / Excel parsing", () => {
  it("parses CSV with Hebrew headers and BOM", async () => {
    const csv = "﻿טלפון,שם\n050-1234567,דנה\n052-7654321,יוסי\n";
    const { headers, rows } = await parseSpreadsheet("list.csv", new TextEncoder().encode(csv).buffer as ArrayBuffer);
    expect(headers).toEqual(["טלפון", "שם"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]["שם"]).toBe("דנה");
  });

  it("parses XLSX", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("s");
    ws.addRow(["טלפון", "שם"]);
    ws.addRow([972501234567, "דנה"]);
    ws.addRow(["0527654321", "יוסי"]);
    const buf = await wb.xlsx.writeBuffer();
    const { rows } = await parseSpreadsheet("list.xlsx", buf as ArrayBuffer);
    expect(rows.map((r) => r["טלפון"])).toEqual(["972501234567", "0527654321"]);
  });
});

describe("contact import", () => {
  it("normalizes, dedupes within file, reports invalid rows", async () => {
    const { ctx } = await createOrg();
    const rows = [
      { טלפון: "050-1234567", שם: "דנה", תגיות: "vip, הלוואות" },
      { טלפון: "+972501234567", שם: "דנה כהן", תגיות: "חדש" },
      { טלפון: "abc", שם: "x", תגיות: "" },
      { טלפון: "0527654321", שם: "", תגיות: "" },
    ];
    const { stats } = await importContactRows(ctx, rows, mapping, { source: "csv" }, { kind: "csv" });
    expect(stats.created).toBe(2);
    expect(stats.duplicatesInFile).toBe(1);
    expect(stats.invalid).toBe(1);
    expect(stats.errors[0].row).toBe(4);
    const dana = await db.contact.findFirstOrThrow({ where: { organizationId: ctx.orgId, phoneE164: "+972501234567" }, include: { tags: { include: { tag: true } } } });
    expect(dana.name).toBe("דנה כהן");
    expect(dana.tags.map((t) => t.tag.name).sort()).toEqual(["vip", "הלוואות", "חדש"].sort());
    expect(dana.consentStatus).toBe("UNKNOWN"); // imported without proof → not eligible
  });

  it("re-import never resurrects a suppressed number, even after deletion", async () => {
    const { ctx } = await createOrg();
    await importContactRows(ctx, [{ טלפון: "0501234567", שם: "דנה" }], mapping, { source: "csv" }, { kind: "csv" });
    await suppressPhone(ctx, { phoneE164: "+972501234567", reason: "KEYWORD_REPLY" });

    const again = await importContactRows(
      ctx,
      [{ טלפון: "0501234567", שם: "דנה", consent: "מילאה טופס באתר ב-1.1.2026 וסימנה הסכמה" }],
      { ...mapping, consentProof: "consent" },
      { source: "csv", consent: { enabled: true, source: "WEB_FORM" } },
      { kind: "csv" },
    );
    expect(again.stats.suppressedKept).toBe(1);
    expect(again.stats.consentRecorded).toBe(0);
    let c = await db.contact.findFirstOrThrow({ where: { organizationId: ctx.orgId, phoneE164: "+972501234567" } });
    expect(c.isSuppressed).toBe(true);
    expect(c.consentStatus).toBe("REVOKED");

    // Delete (keeps a hash-only block) and import again
    await deleteContact(ctx, c.id, { keepDoNotContact: false });
    const entry = await db.suppressionEntry.findFirstOrThrow({ where: { organizationId: ctx.orgId } });
    expect(entry.phoneE164).toBeNull();
    expect(entry.phoneHash).toBe(hashPhone("+972501234567"));
    await importContactRows(ctx, [{ טלפון: "0501234567", שם: "דנה" }], mapping, { source: "csv" }, { kind: "csv" });
    c = await db.contact.findFirstOrThrow({ where: { organizationId: ctx.orgId, phoneE164: "+972501234567" } });
    expect(c.isSuppressed).toBe(true);
  });

  it("does not overwrite existing consent status", async () => {
    const { ctx } = await createOrg();
    const contact = await createContact(ctx, { phone: "0501234567" });
    await grantConsent(ctx, { contactId: contact.id, source: "WEB_FORM", proofText: "טופס אתר, תיבת הסכמה מסומנת", capturedAt: new Date() });
    await importContactRows(ctx, [{ טלפון: "0501234567", שם: "שם חדש" }], mapping, { source: "sheet" }, { kind: "google_sheets" });
    const after = await db.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.consentStatus).toBe("GRANTED");
    expect(after.name).toBe("שם חדש");
  });

  it("records a list-level consent source for every row without per-row proof", async () => {
    const { ctx } = await createOrg();
    await expect(
      importContactRows(ctx, [{ טלפון: "0501234567" }], mapping, { source: "csv", consent: { enabled: true, source: "API" } }, { kind: "csv" }),
    ).rejects.toBeInstanceOf(UserError); // not a bulk source
    const existing = await createContact(ctx, { phone: "0531111111" });
    await suppressPhone(ctx, { phoneE164: existing.phoneE164, reason: "KEYWORD_REPLY" });
    const { stats } = await importContactRows(
      ctx,
      [{ טלפון: "0501234567" }, { טלפון: "0527654321", proof: "קנה הלוואה ב-2025" }, { טלפון: "0531111111" }],
      { ...mapping, consentProof: "proof" },
      { source: "CRM", consent: { enabled: true, source: "EXISTING_CUSTOMER" } },
      { kind: "csv" },
    );
    expect(stats.consentRecorded).toBe(2); // suppressed number untouched
    const granted = await db.contact.findMany({ where: { organizationId: ctx.orgId, consentStatus: "GRANTED" }, orderBy: { phoneE164: "asc" } });
    expect(granted.map((c) => c.phoneE164)).toEqual(["+972501234567", "+972527654321"]);
    const consents = await db.contactConsent.findMany({ where: { contactId: { in: granted.map((g) => g.id) } } });
    expect(consents.every((c) => c.source === "EXISTING_CUSTOMER")).toBe(true);
    expect(consents.find((c) => c.contactId === granted[1].id)?.proofText).toBe("קנה הלוואה ב-2025");
    expect(consents.find((c) => c.contactId === granted[0].id)?.proofText).toContain("30א(ג)");
    expect((await db.contact.findFirstOrThrow({ where: { id: existing.id } })).isSuppressed).toBe(true);
  });

  it("manual consent needs only a source", async () => {
    const { ctx } = await createOrg();
    const c = await createContact(ctx, { phone: "0501234567" });
    await grantConsent(ctx, { contactId: c.id, source: "WEB_FORM", proofText: "", capturedAt: new Date() });
    expect((await db.contact.findUniqueOrThrow({ where: { id: c.id } })).consentStatus).toBe("GRANTED");
  });

  it("phone validation on manual create and duplicate detection", async () => {
    const { ctx } = await createOrg();
    await expect(createContact(ctx, { phone: "12" })).rejects.toBeInstanceOf(UserError);
    await createContact(ctx, { phone: "050-1234567" });
    await expect(createContact(ctx, { phone: "+972501234567" })).rejects.toThrow("כבר קיים");
  });
});

describe("consent & suppression", () => {
  it("manual edits cannot change consent or suppression", async () => {
    const { ctx } = await createOrg();
    const c = await createContact(ctx, { phone: "0501234567" });
    await suppressPhone(ctx, { phoneE164: c.phoneE164, reason: "MANUAL_REQUEST" });
    // updateContact only touches profile fields
    await updateContact(ctx, c.id, { name: "x", notes: "y" } as never);
    const after = await db.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.isSuppressed).toBe(true);
  });

  it("grantConsent is refused for suppressed contacts", async () => {
    const { ctx } = await createOrg();
    const c = await createContact(ctx, { phone: "0501234567" });
    await suppressPhone(ctx, { phoneE164: c.phoneE164, reason: "KEYWORD_REPLY" });
    await expect(grantConsent(ctx, { contactId: c.id, source: "WEB_FORM", proofText: "טופס חדש באתר עם הסכמה", capturedAt: new Date() })).rejects.toThrow("ביקש הסרה");
  });

  it("resubscribe requires explicit new consent dated after the unsubscribe", async () => {
    const { ctx, org, user } = await createOrg();
    const c = await createContact(ctx, { phone: "0501234567" });
    await suppressPhone(ctx, { phoneE164: c.phoneE164, reason: "KEYWORD_REPLY" });
    const old = new Date(Date.now() - 86400_000);
    await expect(
      resubscribeWithNewConsent(ctx, { contactId: c.id, source: "IMPORT_WITH_PROOF", proofText: "ייבוא מחדש של רשימה ישנה", capturedAt: new Date() }),
    ).rejects.toThrow();
    await expect(
      resubscribeWithNewConsent(ctx, { contactId: c.id, source: "WEB_FORM", proofText: "טופס הרשמה חדש באתר", capturedAt: old }),
    ).rejects.toThrow("מאוחרת");
    await expect(
      resubscribeWithNewConsent(ctxFor(org.id, user.id, "CAMPAIGN_MANAGER"), { contactId: c.id, source: "WEB_FORM", proofText: "טופס הרשמה חדש באתר", capturedAt: new Date() }),
    ).rejects.toThrow();
    await resubscribeWithNewConsent(ctx, { contactId: c.id, source: "WEB_FORM", proofText: "נרשם מחדש בטופס באתר וסימן הסכמה", capturedAt: new Date() });
    const after = await db.contact.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.isSuppressed).toBe(false);
    expect(after.consentStatus).toBe("GRANTED");
    expect(await isPhoneSuppressed(org.id, c.phoneE164)).toBe(false);
    const log = await db.auditLog.findFirst({ where: { organizationId: org.id, action: "suppression.lift" } });
    expect(log).toBeTruthy();
  });

  it("suppression is idempotent and org-scoped", async () => {
    const A = await createOrg("A");
    const B = await createOrg("B");
    const r1 = await suppressPhone(A.ctx, { phoneE164: "+972501234567", reason: "KEYWORD_REPLY" });
    const r2 = await suppressPhone(A.ctx, { phoneE164: "+972501234567", reason: "KEYWORD_REPLY" });
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    expect(await db.suppressionEntry.count({ where: { organizationId: A.org.id } })).toBe(1);
    expect(await isPhoneSuppressed(B.org.id, "+972501234567")).toBe(false);
  });
});
