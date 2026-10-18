import Papa from "papaparse";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { hashPhone } from "../crypto";
import { actorUserId, assertCan, type OrgContext } from "../context";
import { audit } from "../audit";
import { UserError } from "../rbac";
import { normalizePhone } from "@/lib/phone";
import { getSettings } from "./settings";
import type { ConsentSource } from "@/generated/prisma/enums";
import { BULK_CONSENT_SOURCES, CONSENT_SOURCE_INFO, type ConsentSourceCode } from "@/lib/consent";

export type ColumnMapping = {
  phone: string;
  name?: string;
  notes?: string;
  source?: string;
  tags?: string;
  consentProof?: string;
  consentDate?: string;
  /** extra columns stored in contact.attributes: { columnName: attributeKey } */
  attributes?: Record<string, string>;
};

export type ImportOptions = {
  source: string;
  tagNames?: string[];
  audienceId?: string | null;
  /**
   * Records one consent source for the whole list (e.g. web form, existing
   * customers). An optional note describes it; per-row proof/date columns are
   * optional and override the defaults when present.
   */
  consent?: { enabled: boolean; source: ConsentSourceCode; note?: string } | null;
};

export type ImportStats = {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
  duplicatesInFile: number;
  suppressedKept: number;
  consentRecorded: number;
  errors: { row: number; reason: string }[];
};

export type RawRow = Record<string, string>;

const MAX_ROWS = 100_000;
const BATCH = 500;

/** Parses CSV / XLSX into header + rows (all values as strings). */
export async function parseSpreadsheet(fileName: string, data: ArrayBuffer): Promise<{ headers: string[]; rows: RawRow[] }> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data);
    const ws = wb.worksheets[0];
    if (!ws) throw new UserError("הקובץ אינו מכיל גיליונות");
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = cellText(cell.value).trim() || `עמודה ${col}`;
    });
    const rows: RawRow[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const rec: RawRow = {};
      headers.forEach((h, i) => (rec[h] = cellText(row.getCell(i + 1).value).trim()));
      if (Object.values(rec).some(Boolean)) rows.push(rec);
    });
    return { headers, rows };
  }
  if (lower.endsWith(".xls")) throw new UserError("פורמט XLS ישן אינו נתמך — יש לשמור כ-XLSX או CSV");
  const text = decodeText(data);
  const parsed = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  if (parsed.errors.length && parsed.data.length === 0) throw new UserError("לא ניתן לקרוא את קובץ ה-CSV");
  const headers = (parsed.meta.fields ?? []).filter(Boolean);
  const rows = parsed.data.map((r) => {
    const rec: RawRow = {};
    for (const h of headers) rec[h] = String(r[h] ?? "").trim();
    return rec;
  });
  return { headers, rows };
}

function decodeText(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // Hebrew CSVs exported from older Excel are often windows-1255.
  if (utf8.includes("�")) {
    try {
      return new TextDecoder("windows-1255").decode(bytes);
    } catch {
      return utf8;
    }
  }
  return utf8.replace(/^﻿/, "");
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("text" in o) return String(o.text);
    if ("result" in o) return String(o.result ?? "");
    if ("richText" in o && Array.isArray(o.richText)) return o.richText.map((t: { text: string }) => t.text).join("");
    if (v instanceof Date) return v.toISOString();
    if ("hyperlink" in o) return String(o.hyperlink);
  }
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v);
}

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const m = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Core import used by file uploads, Google Sheets sync and the REST API.
 * Guarantees:
 *  - phone numbers normalized to E.164, invalid rows reported, in-file duplicates merged;
 *  - existing contacts: profile fields filled/updated, consent & suppression NEVER changed;
 *  - suppressed numbers stay suppressed (new rows are created already suppressed);
 *  - consent recorded with the list's source only for contacts without a consent decision — never for suppressed/revoked contacts.
 */
export async function importContactRows(
  ctx: OrgContext,
  rows: RawRow[],
  mapping: ColumnMapping,
  options: ImportOptions,
  meta: { kind: string; fileName?: string },
): Promise<{ importId: string; stats: ImportStats }> {
  assertCan(ctx, "contacts:write");
  if (!mapping.phone) throw new UserError("יש לבחור את עמודת מספר הטלפון");
  if (rows.length > MAX_ROWS) throw new UserError(`ניתן לייבא עד ${MAX_ROWS.toLocaleString("he-IL")} שורות בפעם אחת`);
  const consentOn = !!options.consent?.enabled;
  if (consentOn) {
    assertCan(ctx, "consents:write");
    if (!BULK_CONSENT_SOURCES.includes(options.consent!.source)) throw new UserError("יש לבחור מקור הסכמה");
  }

  const settings = await getSettings(ctx.orgId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  const businessName = settings.displayName || org.name;

  const job = await db.contactImport.create({
    data: { organizationId: ctx.orgId, source: meta.kind, fileName: meta.fileName, status: "RUNNING", totalRows: rows.length, createdById: actorUserId(ctx) },
  });

  const stats: ImportStats = {
    totalRows: rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    invalid: 0,
    duplicatesInFile: 0,
    suppressedKept: 0,
    consentRecorded: 0,
    errors: [],
  };

  // Resolve tags (global for the import + per-row tag column)
  const tagCache = new Map<string, string>();
  async function tagId(name: string): Promise<string> {
    const clean = name.trim();
    if (tagCache.has(clean)) return tagCache.get(clean)!;
    const tag = await db.tag.upsert({
      where: { organizationId_name: { organizationId: ctx.orgId, name: clean } },
      update: {},
      create: { organizationId: ctx.orgId, name: clean },
    });
    tagCache.set(clean, tag.id);
    return tag.id;
  }
  const globalTagIds = await Promise.all((options.tagNames ?? []).filter((t) => t.trim()).map(tagId));
  let audienceId: string | null = null;
  if (options.audienceId) {
    const a = await db.audience.findFirst({ where: { id: options.audienceId, organizationId: ctx.orgId, kind: "STATIC" } });
    if (!a) throw new UserError("הקבוצה שנבחרה לא נמצאה");
    audienceId = a.id;
  }

  // 1) Normalize + dedupe within file
  type Prepared = { row: number; e164: string; name?: string; notes?: string; source?: string; tags: string[]; proof?: string; proofDate?: Date | null; attributes: Record<string, string> };
  const byPhone = new Map<string, Prepared>();
  rows.forEach((r, i) => {
    const rowNum = i + 2; // header is row 1
    const phone = normalizePhone(r[mapping.phone], settings.defaultCountry);
    if (!phone.ok) {
      stats.invalid++;
      if (stats.errors.length < 200) stats.errors.push({ row: rowNum, reason: `${phone.reason}: "${String(r[mapping.phone] ?? "").slice(0, 30)}"` });
      return;
    }
    const attributes: Record<string, string> = {};
    for (const [col, key] of Object.entries(mapping.attributes ?? {})) if (r[col]) attributes[key] = r[col].slice(0, 500);
    const prepared: Prepared = {
      row: rowNum,
      e164: phone.e164,
      name: mapping.name ? r[mapping.name]?.slice(0, 200) || undefined : undefined,
      notes: mapping.notes ? r[mapping.notes]?.slice(0, 2000) || undefined : undefined,
      source: mapping.source ? r[mapping.source]?.slice(0, 100) || undefined : undefined,
      tags: mapping.tags ? (r[mapping.tags] ?? "").split(/[,;|]/).map((t) => t.trim()).filter(Boolean) : [],
      proof: mapping.consentProof ? r[mapping.consentProof]?.trim() || undefined : undefined,
      proofDate: mapping.consentDate ? parseDate(r[mapping.consentDate]) : null,
      attributes,
    };
    const prev = byPhone.get(phone.e164);
    if (prev) {
      stats.duplicatesInFile++;
      // Merge: later non-empty values win, tags union.
      byPhone.set(phone.e164, {
        ...prev,
        ...Object.fromEntries(Object.entries(prepared).filter(([, v]) => v !== undefined && v !== null && v !== "")),
        tags: [...new Set([...prev.tags, ...prepared.tags])],
        attributes: { ...prev.attributes, ...prepared.attributes },
      } as Prepared);
    } else byPhone.set(phone.e164, prepared);
  });

  // 2) Upsert in batches
  const prepared = [...byPhone.values()];
  for (let i = 0; i < prepared.length; i += BATCH) {
    const chunk = prepared.slice(i, i + BATCH);
    const phones = chunk.map((p) => p.e164);
    const [existing, suppressed] = await Promise.all([
      db.contact.findMany({ where: { organizationId: ctx.orgId, phoneE164: { in: phones } } }),
      db.suppressionEntry.findMany({
        where: { organizationId: ctx.orgId, liftedAt: null, phoneHash: { in: phones.map(hashPhone) } },
        select: { phoneHash: true },
      }),
    ]);
    const existingMap = new Map(existing.map((c) => [c.phoneE164, c]));
    const suppressedSet = new Set(suppressed.map((s) => s.phoneHash));

    const toCreate = chunk.filter((p) => !existingMap.has(p.e164));
    if (toCreate.length) {
      await db.contact.createMany({
        data: toCreate.map((p) => {
          const isSup = suppressedSet.has(hashPhone(p.e164));
          if (isSup) stats.suppressedKept++;
          return {
            organizationId: ctx.orgId,
            phoneE164: p.e164,
            name: p.name ?? null,
            notes: p.notes ?? null,
            source: p.source ?? options.source,
            attributes: p.attributes,
            isSuppressed: isSup,
            consentStatus: isSup ? ("REVOKED" as const) : ("UNKNOWN" as const),
          };
        }),
        skipDuplicates: true,
      });
      stats.created += toCreate.length;
    }

    for (const p of chunk) {
      const ex = existingMap.get(p.e164);
      if (!ex) continue;
      if (ex.isSuppressed) stats.suppressedKept++;
      const data: Prisma.ContactUpdateInput = {};
      if (p.name && p.name !== ex.name) data.name = p.name;
      if (p.notes && p.notes !== ex.notes) data.notes = p.notes;
      if (!ex.source && (p.source || options.source)) data.source = p.source ?? options.source;
      if (Object.keys(p.attributes).length) data.attributes = { ...(ex.attributes as object), ...p.attributes };
      if (Object.keys(data).length) {
        await db.contact.update({ where: { id: ex.id }, data });
        stats.updated++;
      } else stats.skipped++;
    }

    // Re-read to get ids for tagging / audience / consent
    const all = await db.contact.findMany({
      where: { organizationId: ctx.orgId, phoneE164: { in: phones } },
      select: { id: true, phoneE164: true, consentStatus: true, isSuppressed: true },
    });
    const idByPhone = new Map(all.map((c) => [c.phoneE164, c]));
    const tagRows: { contactId: string; tagId: string }[] = [];
    for (const p of chunk) {
      const c = idByPhone.get(p.e164);
      if (!c) continue;
      for (const t of globalTagIds) tagRows.push({ contactId: c.id, tagId: t });
      for (const t of p.tags) tagRows.push({ contactId: c.id, tagId: await tagId(t) });
    }
    if (tagRows.length) await db.contactTag.createMany({ data: tagRows, skipDuplicates: true });
    if (audienceId) {
      await db.audienceMember.createMany({ data: all.map((c) => ({ audienceId: audienceId!, contactId: c.id })), skipDuplicates: true });
    }

    if (consentOn) {
      const consentRows: Prisma.ContactConsentCreateManyInput[] = [];
      const grantIds: string[] = [];
      for (const p of chunk) {
        const c = idByPhone.get(p.e164);
        const source = options.consent!.source;
        const proof = p.proof || options.consent!.note?.trim() || CONSENT_SOURCE_INFO[source].defaultNote;
        // Suppressed / revoked contacts can only re-consent via the resubscribe flow.
        if (!c || c.isSuppressed || c.consentStatus !== "UNKNOWN") continue;
        consentRows.push({
          organizationId: ctx.orgId,
          contactId: c.id,
          status: "GRANTED",
          source: source as ConsentSource,
          businessName,
          proofText: proof.slice(0, 2000),
          proofReference: `import:${job.id}${meta.fileName ? ` (${meta.fileName})` : ""}`,
          capturedAt: p.proofDate && p.proofDate.getTime() <= Date.now() ? p.proofDate : new Date(),
          recordedById: actorUserId(ctx),
          recordedVia: `import:${meta.kind}`,
        });
        grantIds.push(c.id);
      }
      if (consentRows.length) {
        await db.$transaction([
          db.contactConsent.createMany({ data: consentRows }),
          db.contact.updateMany({
            where: { id: { in: grantIds }, organizationId: ctx.orgId, consentStatus: "UNKNOWN", isSuppressed: false },
            data: { consentStatus: "GRANTED", consentUpdatedAt: new Date() },
          }),
        ]);
        stats.consentRecorded += consentRows.length;
      }
    }
  }

  await db.contactImport.update({
    where: { id: job.id },
    data: {
      status: "COMPLETED",
      created: stats.created,
      updated: stats.updated,
      skipped: stats.skipped + stats.duplicatesInFile,
      invalid: stats.invalid,
      suppressedKept: stats.suppressedKept,
      errors: stats.errors as Prisma.InputJsonValue,
      finishedAt: new Date(),
    },
  });
  await audit(ctx, "contact.import", { type: "contact_import", id: job.id }, { kind: meta.kind, ...stats, errors: undefined });
  return { importId: job.id, stats };
}

/** Best-effort column auto-detection for the mapping step. */
export function guessMapping(headers: string[]): Partial<ColumnMapping> {
  const find = (re: RegExp) => headers.find((h) => re.test(h.toLowerCase()));
  return {
    phone: find(/phone|mobile|tel|טלפון|נייד|פלאפון|מספר/),
    name: find(/^name$|full.?name|שם/),
    notes: find(/note|הערה|הערות/),
    source: find(/source|מקור/),
    tags: find(/tag|תגית|תגיות/),
    consentProof: find(/consent|הסכמה|אסמכתה/),
    consentDate: find(/consent.?date|תאריך.?הסכמה/),
  };
}
