import { z } from "zod";
import { db } from "../db";
import { hashPhone } from "../crypto";
import type { ApiKeyContext } from "../services/api-keys";
import { importContactRows, type RawRow } from "../services/imports";
import { getSettings } from "../services/settings";
import { UserError } from "../rbac";
import { normalizePhone } from "@/lib/phone";
import { BULK_CONSENT_SOURCES, type ConsentSourceCode } from "@/lib/consent";

const bulkSource = z.enum(BULK_CONSENT_SOURCES as unknown as [string, ...string[]]);

export const apiContactSchema = z.object({
  phone: z.string().min(3).max(40),
  name: z.string().max(200).optional(),
  source: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  /** Marks this contact as consented. proofText is optional; the list-level consentSource applies. */
  consent: z
    .object({
      proofText: z.string().max(2000).optional(),
      capturedAt: z.coerce.date().optional(),
      source: bulkSource.optional(),
    })
    .optional(),
});

export const apiImportSchema = z.object({
  source: z.string().min(1).max(100),
  tags: z.array(z.string().max(50)).max(20).optional(),
  audienceId: z.string().optional(),
  /** Consent source for contacts sent with a consent object (e.g. WEB_FORM, EXISTING_CUSTOMER). */
  consentSource: bulkSource.optional(),
  consentNote: z.string().max(500).optional(),
  contacts: z.array(apiContactSchema).min(1).max(5000),
});

/**
 * Imports through the same guarded path as file uploads: consent is only
 * recorded with per-row proof, never for suppressed/revoked contacts, and
 * existing consent/suppression is never overwritten.
 */
export async function apiImport(ctx: ApiKeyContext, body: z.infer<typeof apiImportSchema>) {
  const attrKeys = new Set<string>();
  const rows: RawRow[] = body.contacts.map((c) => {
    const row: RawRow = {
      phone: c.phone,
      name: c.name ?? "",
      source: c.source ?? "",
      notes: c.notes ?? "",
      tags: (c.tags ?? []).join(","),
      consentProof: c.consent?.proofText ?? "",
      consentDate: c.consent?.capturedAt?.toISOString() ?? "",
    };
    for (const [k, v] of Object.entries(c.attributes ?? {})) {
      row[`attr:${k}`] = String(v);
      attrKeys.add(k);
    }
    return row;
  });
  const hasConsent = body.contacts.some((c) => c.consent);
  return importContactRows(
    ctx,
    rows,
    {
      phone: "phone",
      name: "name",
      source: "source",
      notes: "notes",
      tags: "tags",
      consentProof: "consentProof",
      consentDate: "consentDate",
      attributes: Object.fromEntries([...attrKeys].map((k) => [`attr:${k}`, k])),
    },
    {
      source: body.source,
      tagNames: body.tags,
      audienceId: body.audienceId ?? null,
      consent: hasConsent
        ? {
            enabled: true,
            source: (body.consentSource ?? body.contacts.find((c) => c.consent?.source)?.consent?.source ?? "OTHER_DOCUMENTED") as ConsentSourceCode,
            note: body.consentNote,
          }
        : null,
    },
    { kind: "api" },
  );
}

export function serializeContact(c: {
  id: string;
  phoneE164: string;
  name: string | null;
  source: string | null;
  consentStatus: string;
  isSuppressed: boolean;
  createdAt: Date;
  sentCount: number;
  clickCount: number;
  lastSentAt: Date | null;
}) {
  return {
    id: c.id,
    phone: c.phoneE164,
    name: c.name,
    source: c.source,
    consentStatus: c.consentStatus,
    suppressed: c.isSuppressed,
    eligibleForMarketing: c.consentStatus === "GRANTED" && !c.isSuppressed,
    sentCount: c.sentCount,
    clickCount: c.clickCount,
    lastSentAt: c.lastSentAt,
    createdAt: c.createdAt,
  };
}

export async function consentStatusForPhone(ctx: ApiKeyContext, phone: string) {
  const settings = await getSettings(ctx.orgId);
  const p = normalizePhone(phone, settings.defaultCountry);
  if (!p.ok) throw new UserError(p.reason);
  const [contact, suppression] = await Promise.all([
    db.contact.findUnique({
      where: { organizationId_phoneE164: { organizationId: ctx.orgId, phoneE164: p.e164 } },
      include: { consents: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    db.suppressionEntry.findFirst({ where: { organizationId: ctx.orgId, phoneHash: hashPhone(p.e164), liftedAt: null } }),
  ]);
  const last = contact?.consents[0];
  return {
    phone: p.e164,
    exists: !!contact,
    contactId: contact?.id ?? null,
    consentStatus: contact?.consentStatus ?? "UNKNOWN",
    suppressed: !!suppression,
    eligibleForMarketing: !!contact && contact.consentStatus === "GRANTED" && !suppression,
    lastConsent: last ? { status: last.status, source: last.source, capturedAt: last.capturedAt, businessName: last.businessName } : null,
  };
}
