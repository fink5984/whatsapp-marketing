import type { SuppressionReason, ConsentSource } from "@/generated/prisma/enums";
import { db, type Tx } from "../db";
import { hashPhone } from "../crypto";
import { actorUserId, assertCan, type OrgContext } from "../context";
import { audit } from "../audit";
import { NotFoundError, UserError } from "../rbac";
import { emitEvent } from "./outgoing-webhooks";

export const SUPPRESSION_REASON_LABELS: Record<SuppressionReason, string> = {
  KEYWORD_REPLY: "השיב/ה מילת הסרה",
  QUICK_REPLY_BUTTON: "לחץ/ה על כפתור הסרה",
  MANUAL_REQUEST: "בקשה ידנית",
  META_USER_STOPPED_MARKETING: "חסם/ה הודעות שיווק ב-WhatsApp",
  COMPLAINT: "תלונה",
  DATA_DELETION: "בקשת מחיקת מידע",
  API: "דרך API",
};

/** Consent sources that count as a NEW, explicit opt-in — the only way to lift a suppression. */
export const RESUBSCRIBE_SOURCES: ConsentSource[] = ["WEB_FORM", "PAPER_FORM", "VERBAL_RECORDED", "INBOUND_MESSAGE"];

export async function isPhoneSuppressed(orgId: string, e164: string, tx?: Tx): Promise<boolean> {
  const client = tx ?? db;
  const entry = await client.suppressionEntry.findFirst({
    where: { organizationId: orgId, phoneHash: hashPhone(e164), liftedAt: null },
    select: { id: true },
  });
  return !!entry;
}

export type SuppressInput = {
  phoneE164: string;
  reason: SuppressionReason;
  detail?: string;
  sourceMessageId?: string;
};

/**
 * Adds a phone number to the org-wide suppression list (covers every sending
 * number of the business), revokes marketing consent, and cancels any queued
 * campaign messages for it — all in one transaction.
 * Idempotent: a second call for an already-suppressed number is a no-op.
 */
export async function suppressPhone(ctx: OrgContext, input: SuppressInput) {
  const phoneHash = hashPhone(input.phoneE164);
  const result = await db.$transaction(async (tx) => {
    // Serialize concurrent unsubscribes for the same number.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.orgId + ":" + phoneHash}))`;

    const contact = await tx.contact.findUnique({
      where: { organizationId_phoneE164: { organizationId: ctx.orgId, phoneE164: input.phoneE164 } },
    });
    const existing = await tx.suppressionEntry.findFirst({
      where: { organizationId: ctx.orgId, phoneHash, liftedAt: null },
    });
    if (existing) {
      if (contact && !contact.isSuppressed) {
        await tx.contact.update({ where: { id: contact.id }, data: { isSuppressed: true } });
      }
      return { created: false, entryId: existing.id, contactId: contact?.id ?? null, cancelled: 0 };
    }

    const entry = await tx.suppressionEntry.create({
      data: {
        organizationId: ctx.orgId,
        phoneHash,
        phoneE164: input.phoneE164,
        contactId: contact?.id ?? null,
        reason: input.reason,
        detail: input.detail?.slice(0, 500) ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        createdById: actorUserId(ctx),
      },
    });

    if (contact) {
      const settings = await tx.businessSettings.findUnique({ where: { organizationId: ctx.orgId } });
      const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
      await tx.contactConsent.create({
        data: {
          organizationId: ctx.orgId,
          contactId: contact.id,
          status: "REVOKED",
          source: input.reason === "MANUAL_REQUEST" || input.reason === "COMPLAINT" ? "MANUAL_WITH_PROOF" : input.reason === "API" ? "API" : "INBOUND_MESSAGE",
          businessName: settings?.displayName || org.name,
          proofText: `הסרה: ${SUPPRESSION_REASON_LABELS[input.reason]}${input.detail ? ` — ${input.detail.slice(0, 200)}` : ""}`,
          proofReference: input.sourceMessageId ?? null,
          capturedAt: new Date(),
          recordedById: actorUserId(ctx),
          recordedVia: ctx.actor.type,
        },
      });
      await tx.contact.update({
        where: { id: contact.id },
        data: { isSuppressed: true, consentStatus: "REVOKED", consentUpdatedAt: new Date() },
      });
    }

    // Pull every not-yet-sent campaign/test message for this number out of the queue.
    const pending = await tx.outboundMessage.findMany({
      where: { organizationId: ctx.orgId, toPhoneHash: phoneHash, status: "QUEUED", kind: { in: ["CAMPAIGN", "TEST"] } },
      select: { id: true },
    });
    if (pending.length > 0) {
      await tx.outboundMessage.updateMany({
        where: { id: { in: pending.map((p) => p.id) }, status: "QUEUED" },
        data: { status: "CANCELLED", errorCode: "SUPPRESSED", errorDetail: "הנמען ביקש הסרה לפני השליחה" },
      });
      const now = new Date();
      await tx.messageEvent.createMany({
        data: pending.map((p) => ({
          organizationId: ctx.orgId,
          messageId: p.id,
          type: "cancelled",
          occurredAt: now,
          dedupeKey: `cancel-suppressed:${p.id}`,
          detail: { reason: "SUPPRESSED", suppressionId: entry.id },
        })),
        skipDuplicates: true,
      });
    }

    await audit(
      ctx,
      "suppression.add",
      { type: "suppression", id: entry.id },
      { reason: input.reason, contactId: contact?.id ?? null, cancelledMessages: pending.length },
      tx,
    );
    await emitEvent(
      ctx.orgId,
      "contact.unsubscribed",
      { contactId: contact?.id ?? null, phone: input.phoneE164, reason: input.reason, suppressionId: entry.id },
      tx,
    );
    return { created: true, entryId: entry.id, contactId: contact?.id ?? null, cancelled: pending.length };
  });
  return result;
}

export async function addManualSuppression(ctx: OrgContext, phoneE164: string, detail: string) {
  assertCan(ctx, "suppression:write");
  return suppressPhone(ctx, { phoneE164, reason: "MANUAL_REQUEST", detail });
}

export type ResubscribeInput = {
  contactId: string;
  source: ConsentSource;
  proofText: string;
  proofReference?: string;
  capturedAt: Date;
};

/**
 * Lifts a suppression ONLY with a new, explicit, documented consent captured
 * after the unsubscribe. Imports, syncs and plain edits can never call this.
 */
export async function resubscribeWithNewConsent(ctx: OrgContext, input: ResubscribeInput) {
  assertCan(ctx, "suppression:lift");
  if (!RESUBSCRIBE_SOURCES.includes(input.source)) {
    throw new UserError("חידוש הרשמה מחייב הסכמה מפורשת חדשה (טופס, הקלטה או הודעה יזומה מהנמען)");
  }
  if (input.proofText.trim().length < 15) throw new UserError("יש לתעד את נוסח ההסכמה או האסמכתה (לפחות 15 תווים)");
  if (input.capturedAt.getTime() > Date.now() + 5 * 60_000) throw new UserError("תאריך ההסכמה אינו יכול להיות עתידי");

  return db.$transaction(async (tx) => {
    const contact = await tx.contact.findFirst({ where: { id: input.contactId, organizationId: ctx.orgId } });
    if (!contact) throw new NotFoundError("איש הקשר לא נמצא");
    const phoneHash = hashPhone(contact.phoneE164);
    const entries = await tx.suppressionEntry.findMany({
      where: { organizationId: ctx.orgId, phoneHash, liftedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (entries.length === 0) throw new UserError("איש הקשר אינו ברשימת ההסרה");
    if (input.capturedAt <= entries[0].createdAt) {
      throw new UserError("ההסכמה החדשה חייבת להיות מאוחרת לבקשת ההסרה האחרונה");
    }
    const settings = await tx.businessSettings.findUnique({ where: { organizationId: ctx.orgId } });
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
    const consent = await tx.contactConsent.create({
      data: {
        organizationId: ctx.orgId,
        contactId: contact.id,
        status: "GRANTED",
        source: input.source,
        businessName: settings?.displayName || org.name,
        proofText: input.proofText.trim(),
        proofReference: input.proofReference?.trim() || null,
        capturedAt: input.capturedAt,
        recordedById: actorUserId(ctx),
        recordedVia: "resubscribe",
      },
    });
    await tx.suppressionEntry.updateMany({
      where: { id: { in: entries.map((e) => e.id) } },
      data: { liftedAt: new Date(), liftedConsentId: consent.id, liftedById: actorUserId(ctx) },
    });
    await tx.contact.update({
      where: { id: contact.id },
      data: { isSuppressed: false, consentStatus: "GRANTED", consentUpdatedAt: new Date() },
    });
    await audit(ctx, "suppression.lift", { type: "contact", id: contact.id }, { consentId: consent.id, source: input.source }, tx);
    return consent;
  });
}
