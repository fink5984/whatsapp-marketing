import type { ConsentSource } from "@/generated/prisma/enums";
import { db, type Tx } from "../db";
import { actorUserId, assertCan, type OrgContext } from "../context";
import { audit } from "../audit";
import { NotFoundError, UserError } from "../rbac";
import { CONSENT_SOURCE_INFO } from "@/lib/consent";

export const CONSENT_SOURCE_LABELS = Object.fromEntries(Object.entries(CONSENT_SOURCE_INFO).map(([k, v]) => [k, v.label])) as Record<ConsentSource, string>;

export const CONSENT_STATUS_LABELS = {
  UNKNOWN: "אין הסכמה רשומה",
  GRANTED: "יש הסכמה",
  REVOKED: "הסכמה בוטלה",
} as const;

export type GrantConsentInput = {
  contactId: string;
  source: ConsentSource;
  proofText: string;
  proofReference?: string | null;
  capturedAt: Date;
  businessName?: string;
};

export const MIN_PROOF_LENGTH = 10;

/**
 * Records documented marketing consent. Refuses when the contact is
 * suppressed — lifting a suppression is a separate, stricter flow
 * (resubscribeWithNewConsent).
 */
export async function grantConsent(ctx: OrgContext, input: GrantConsentInput, tx?: Tx) {
  assertCan(ctx, "consents:write");
  const proofText = input.proofText.trim() || CONSENT_SOURCE_INFO[input.source as keyof typeof CONSENT_SOURCE_INFO]?.defaultNote || "הסכמה מתועדת";
  if (input.capturedAt.getTime() > Date.now() + 5 * 60_000) throw new UserError("תאריך ההסכמה אינו יכול להיות עתידי");

  const run = async (t: Tx) => {
    const contact = await t.contact.findFirst({ where: { id: input.contactId, organizationId: ctx.orgId } });
    if (!contact) throw new NotFoundError("איש הקשר לא נמצא");
    if (contact.isSuppressed) {
      throw new UserError("איש הקשר ביקש הסרה. ניתן לחדש הרשמה רק דרך 'חידוש הרשמה' עם הסכמה חדשה ומפורשת.");
    }
    const settings = await t.businessSettings.findUnique({ where: { organizationId: ctx.orgId } });
    const org = await t.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
    const consent = await t.contactConsent.create({
      data: {
        organizationId: ctx.orgId,
        contactId: contact.id,
        status: "GRANTED",
        source: input.source,
        businessName: input.businessName || settings?.displayName || org.name,
        proofText,
        proofReference: input.proofReference?.trim() || null,
        capturedAt: input.capturedAt,
        recordedById: actorUserId(ctx),
        recordedVia: ctx.actor.type,
      },
    });
    await t.contact.update({
      where: { id: contact.id },
      data: { consentStatus: "GRANTED", consentUpdatedAt: new Date() },
    });
    await audit(ctx, "consent.grant", { type: "contact", id: contact.id }, { consentId: consent.id, source: input.source }, t);
    return consent;
  };
  return tx ? run(tx) : db.$transaction(run);
}

/** Revoking consent without an unsubscribe request (e.g. consent found invalid). */
export async function revokeConsent(ctx: OrgContext, contactId: string, reason: string) {
  assertCan(ctx, "consents:write");
  return db.$transaction(async (tx) => {
    const contact = await tx.contact.findFirst({ where: { id: contactId, organizationId: ctx.orgId } });
    if (!contact) throw new NotFoundError("איש הקשר לא נמצא");
    const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
    await tx.contactConsent.create({
      data: {
        organizationId: ctx.orgId,
        contactId,
        status: "REVOKED",
        source: "MANUAL_WITH_PROOF",
        businessName: org.name,
        proofText: reason.trim() || "ביטול הסכמה ידני",
        capturedAt: new Date(),
        recordedById: actorUserId(ctx),
        recordedVia: ctx.actor.type,
      },
    });
    await tx.contact.update({ where: { id: contactId }, data: { consentStatus: "REVOKED", consentUpdatedAt: new Date() } });
    await audit(ctx, "consent.revoke", { type: "contact", id: contactId }, { reason }, tx);
  });
}
