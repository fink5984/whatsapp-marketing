import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { hashPhone } from "../crypto";
import { actorUserId, assertCan, type OrgContext } from "../context";
import { audit } from "../audit";
import { NotFoundError, UserError } from "../rbac";
import { normalizePhone } from "@/lib/phone";
import { buildContactWhere, type ContactFilter } from "./contact-filter";
import { isPhoneSuppressed } from "./suppression";
import { emitEvent } from "./outgoing-webhooks";
import { getSettings } from "./settings";

export type ContactSort = "createdAt" | "name" | "lastSentAt" | "sentCount" | "clickCount";

export async function listContacts(
  ctx: OrgContext,
  filter: ContactFilter,
  opts: { page: number; pageSize: number; sort?: ContactSort; dir?: "asc" | "desc" },
) {
  assertCan(ctx, "contacts:read");
  const where = await buildContactWhere(ctx.orgId, filter);
  const sort = opts.sort ?? "createdAt";
  const dir = opts.dir ?? "desc";
  // `nulls` ordering is only valid on nullable columns.
  const primary = sort === "name" || sort === "lastSentAt" ? { [sort]: { sort: dir, nulls: "last" } } : { [sort]: dir };
  const [total, rows] = await Promise.all([
    db.contact.count({ where }),
    db.contact.findMany({
      where,
      orderBy: [primary, { id: "asc" }] as Prisma.ContactOrderByWithRelationInput[],
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: { tags: { include: { tag: true } } },
    }),
  ]);
  return { total, rows };
}

export async function getContactDetail(ctx: OrgContext, id: string) {
  assertCan(ctx, "contacts:read");
  const contact = await db.contact.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      tags: { include: { tag: true } },
      audienceMembers: { include: { audience: true } },
      consents: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!contact) throw new NotFoundError("איש הקשר לא נמצא");
  const phoneHash = hashPhone(contact.phoneE164);
  const [outbound, inbound, clicks, suppressions, leads] = await Promise.all([
    db.outboundMessage.findMany({
      where: { organizationId: ctx.orgId, contactId: id },
      include: { campaign: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.inboundMessage.findMany({ where: { organizationId: ctx.orgId, contactId: id }, orderBy: { receivedAt: "desc" }, take: 100 }),
    db.linkClick.findMany({
      where: { organizationId: ctx.orgId, contactId: id, isBot: false },
      include: { link: { select: { name: true } } },
      orderBy: { clickedAt: "desc" },
      take: 100,
    }),
    db.suppressionEntry.findMany({ where: { organizationId: ctx.orgId, phoneHash }, orderBy: { createdAt: "desc" } }),
    db.lead.findMany({ where: { organizationId: ctx.orgId, contactId: id }, orderBy: { createdAt: "desc" } }),
  ]);
  return { contact, outbound, inbound, clicks, suppressions, leads };
}

export type ContactInput = {
  phone: string;
  name?: string | null;
  source?: string | null;
  notes?: string | null;
  tagIds?: string[];
  attributes?: Record<string, string>;
};

async function assertTagsBelongToOrg(orgId: string, tagIds: string[]) {
  if (tagIds.length === 0) return;
  const count = await db.tag.count({ where: { organizationId: orgId, id: { in: tagIds } } });
  if (count !== new Set(tagIds).size) throw new NotFoundError("תגית לא נמצאה");
}

export async function createContact(ctx: OrgContext, input: ContactInput) {
  assertCan(ctx, "contacts:write");
  const settings = await getSettings(ctx.orgId);
  const phone = normalizePhone(input.phone, settings.defaultCountry);
  if (!phone.ok) throw new UserError(phone.reason);
  await assertTagsBelongToOrg(ctx.orgId, input.tagIds ?? []);
  const existing = await db.contact.findUnique({
    where: { organizationId_phoneE164: { organizationId: ctx.orgId, phoneE164: phone.e164 } },
  });
  if (existing) throw new UserError("איש קשר עם מספר זה כבר קיים");
  const suppressed = await isPhoneSuppressed(ctx.orgId, phone.e164);
  const contact = await db.contact.create({
    data: {
      organizationId: ctx.orgId,
      phoneE164: phone.e164,
      name: input.name?.trim() || null,
      source: input.source?.trim() || "ידני",
      notes: input.notes?.trim() || null,
      attributes: input.attributes ?? {},
      isSuppressed: suppressed,
      consentStatus: suppressed ? "REVOKED" : "UNKNOWN",
      tags: input.tagIds?.length ? { create: input.tagIds.map((tagId) => ({ tagId })) } : undefined,
    },
  });
  await audit(ctx, "contact.create", { type: "contact", id: contact.id });
  await emitEvent(ctx.orgId, "contact.created", { contactId: contact.id, phone: contact.phoneE164, name: contact.name, source: contact.source });
  return contact;
}

/** Updates profile fields only. Consent and suppression have their own audited flows. */
export async function updateContact(ctx: OrgContext, id: string, input: Omit<ContactInput, "phone">) {
  assertCan(ctx, "contacts:write");
  const contact = await db.contact.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!contact) throw new NotFoundError("איש הקשר לא נמצא");
  if (input.tagIds) await assertTagsBelongToOrg(ctx.orgId, input.tagIds);
  const updated = await db.$transaction(async (tx) => {
    if (input.tagIds) {
      await tx.contactTag.deleteMany({ where: { contactId: id } });
      if (input.tagIds.length) {
        await tx.contactTag.createMany({ data: input.tagIds.map((tagId) => ({ contactId: id, tagId })), skipDuplicates: true });
      }
    }
    return tx.contact.update({
      where: { id },
      data: {
        name: input.name === undefined ? undefined : input.name?.trim() || null,
        source: input.source === undefined ? undefined : input.source?.trim() || null,
        notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
        attributes: input.attributes ? { ...(contact.attributes as object), ...input.attributes } : undefined,
      },
    });
  });
  await audit(ctx, "contact.update", { type: "contact", id });
  return updated;
}

/**
 * Deletes a contact's personal data. If the number was suppressed (or the
 * person asked never to be contacted again), a minimal block record — only a
 * keyed hash of the phone number — is kept so future imports cannot re-add it.
 */
export async function deleteContact(ctx: OrgContext, id: string, opts: { keepDoNotContact: boolean }) {
  assertCan(ctx, "contacts:delete");
  const contact = await db.contact.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!contact) throw new NotFoundError("איש הקשר לא נמצא");
  const phoneHash = hashPhone(contact.phoneE164);
  await db.$transaction(async (tx) => {
    const active = await tx.suppressionEntry.findFirst({ where: { organizationId: ctx.orgId, phoneHash, liftedAt: null } });
    if (!active && opts.keepDoNotContact) {
      await tx.suppressionEntry.create({
        data: {
          organizationId: ctx.orgId,
          phoneHash,
          reason: "DATA_DELETION",
          detail: "נמחק לבקשת הנמען — חסימה מינימלית לשמירה מפני פנייה חוזרת",
          createdById: actorUserId(ctx),
        },
      });
    }
    // Keep only the hash on suppression records.
    await tx.suppressionEntry.updateMany({
      where: { organizationId: ctx.orgId, phoneHash },
      data: { phoneE164: null, contactId: null },
    });
    await tx.outboundMessage.updateMany({
      where: { organizationId: ctx.orgId, contactId: id, status: "QUEUED" },
      data: { status: "CANCELLED", errorCode: "CONTACT_DELETED" },
    });
    await tx.outboundMessage.updateMany({
      where: { organizationId: ctx.orgId, contactId: id },
      data: { toPhone: null, payload: { redacted: true } },
    });
    await tx.campaignRecipient.updateMany({ where: { organizationId: ctx.orgId, contactId: id }, data: { phoneE164: null } });
    await tx.contact.delete({ where: { id } });
    await audit(ctx, "contact.delete", { type: "contact", id }, { keptBlock: !!active || opts.keepDoNotContact }, tx);
  });
}

export async function bulkTagContacts(ctx: OrgContext, contactIds: string[], tagId: string, mode: "add" | "remove") {
  assertCan(ctx, "contacts:write");
  await assertTagsBelongToOrg(ctx.orgId, [tagId]);
  const owned = await db.contact.findMany({ where: { organizationId: ctx.orgId, id: { in: contactIds } }, select: { id: true } });
  const ids = owned.map((c) => c.id);
  if (mode === "add") {
    await db.contactTag.createMany({ data: ids.map((contactId) => ({ contactId, tagId })), skipDuplicates: true });
  } else {
    await db.contactTag.deleteMany({ where: { tagId, contactId: { in: ids } } });
  }
  return ids.length;
}

export async function exportContactsCsv(ctx: OrgContext, filter: ContactFilter): Promise<string> {
  assertCan(ctx, "contacts:export");
  const where = await buildContactWhere(ctx.orgId, filter);
  const rows = await db.contact.findMany({ where, include: { tags: { include: { tag: true } } }, orderBy: { createdAt: "asc" }, take: 100_000 });
  const header = ["phone", "name", "source", "consent_status", "suppressed", "tags", "sent_count", "delivered_count", "read_count", "click_count", "last_sent_at", "created_at", "notes"];
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    // Neutralize spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(",")];
  for (const c of rows) {
    lines.push(
      [
        c.phoneE164,
        c.name,
        c.source,
        c.consentStatus,
        c.isSuppressed ? "yes" : "no",
        c.tags.map((t) => t.tag.name).join("|"),
        c.sentCount,
        c.deliveredCount,
        c.readCount,
        c.clickCount,
        c.lastSentAt?.toISOString(),
        c.createdAt.toISOString(),
        c.notes,
      ]
        .map(esc)
        .join(","),
    );
  }
  await audit(ctx, "contact.export", { type: "contact" }, { count: rows.length, filter });
  return "﻿" + lines.join("\r\n");
}

// ─── Tags ───

export async function listTags(ctx: OrgContext) {
  assertCan(ctx, "contacts:read");
  return db.tag.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { name: "asc" },
    include: { _count: { select: { contacts: true } } },
  });
}

export async function createTag(ctx: OrgContext, name: string, color?: string) {
  assertCan(ctx, "audiences:write");
  const clean = name.trim();
  if (!clean) throw new UserError("שם תגית חסר");
  return db.tag.upsert({
    where: { organizationId_name: { organizationId: ctx.orgId, name: clean } },
    update: {},
    create: { organizationId: ctx.orgId, name: clean, color },
  });
}

export async function deleteTag(ctx: OrgContext, id: string) {
  assertCan(ctx, "audiences:write");
  const res = await db.tag.deleteMany({ where: { id, organizationId: ctx.orgId } });
  if (res.count === 0) throw new NotFoundError();
}

export async function distinctSources(ctx: OrgContext): Promise<string[]> {
  const rows = await db.contact.findMany({
    where: { organizationId: ctx.orgId, source: { not: null } },
    distinct: ["source"],
    select: { source: true },
    take: 200,
  });
  return rows.map((r) => r.source!).sort();
}
