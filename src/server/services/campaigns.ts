import type { Prisma } from "@/generated/prisma/client";
import type { CampaignStatus, OutboundStatus } from "@/generated/prisma/enums";
import { db, type Tx } from "../db";
import { hashPhone, randomAlphanumeric } from "../crypto";
import { actorUserId, assertCan, type OrgContext } from "../context";
import { audit } from "../audit";
import { NotFoundError, UserError } from "../rbac";
import { trackingBaseUrl } from "../env";
import { contactFilterSchema, buildContactWhere } from "./contact-filter";
import { evaluateCompliance } from "./compliance";
import { getSettings, isWithinSendingWindow, windowMinutesPerWeek, type SendingWindow } from "./settings";
import { CLICK_TOKEN_LENGTH } from "./links";
import { buildTemplatePayload, MissingVariableError, variableMappingSchema, mappingUsesTrackedLink, type VariableMapping } from "../sending/payload";
import { claimMessageById, processClaimed, uniqueRecipientsLast24h } from "../sending/sender";
import { parseMessagingLimit } from "../meta/client";
import { analyzeTemplate, mediaHeaderFormat, templateSlots, type TemplateComponent } from "@/lib/templates";
import { normalizePhone } from "@/lib/phone";

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: "טיוטה",
  SCHEDULED: "מתוזמן",
  QUEUED: "בתור",
  RUNNING: "פעיל",
  PAUSED: "מושהה",
  COMPLETED: "הסתיים",
  CANCELLED: "בוטל",
  FAILED: "נכשל",
};

export const EXCLUSION_LABELS: Record<string, string> = {
  SUPPRESSED: "ביקש/ה הסרה",
  CONSENT_REVOKED: "הסכמה בוטלה",
  NO_CONSENT: "אין הסכמה מתועדת",
  MISSING_VARIABLE: "חסר ערך למשתנה בתבנית",
  OVER_LIMIT: "מעבר לכמות המרבית שהוגדרה",
};

export type CampaignDraftInput = {
  name: string;
  description?: string | null;
  tags?: string[];
  accountId?: string | null;
  phoneNumberId?: string | null;
  templateId?: string | null;
  audienceFilter?: unknown;
  variableMapping?: unknown;
  headerMediaUrl?: string | null;
  trackedLinkId?: string | null;
  scheduledAt?: Date | null;
  maxRecipients?: number | null;
  messagesPerSecond?: number | null;
  respectSendingWindow?: boolean;
};

async function assertOwned(ctx: OrgContext, input: CampaignDraftInput, tx: Tx = db as unknown as Tx) {
  if (input.accountId && !(await tx.whatsappAccount.findFirst({ where: { id: input.accountId, organizationId: ctx.orgId } }))) throw new NotFoundError("החשבון לא נמצא");
  if (input.phoneNumberId) {
    const p = await tx.whatsappPhoneNumber.findFirst({ where: { id: input.phoneNumberId, organizationId: ctx.orgId } });
    if (!p) throw new NotFoundError("מספר השולח לא נמצא");
    if (input.accountId && p.accountId !== input.accountId) throw new UserError("מספר השולח אינו שייך לחשבון שנבחר");
  }
  if (input.templateId) {
    const t = await tx.messageTemplate.findFirst({ where: { id: input.templateId, organizationId: ctx.orgId } });
    if (!t) throw new NotFoundError("התבנית לא נמצאה");
    if (input.accountId && t.accountId !== input.accountId) throw new UserError("התבנית אינה שייכת לחשבון שנבחר");
  }
  if (input.trackedLinkId && !(await tx.trackedLink.findFirst({ where: { id: input.trackedLinkId, organizationId: ctx.orgId } }))) throw new NotFoundError("הקישור לא נמצא");
}

function draftData(input: CampaignDraftInput) {
  const filter = input.audienceFilter === undefined ? undefined : contactFilterSchema.parse(input.audienceFilter ?? {});
  const mapping = input.variableMapping === undefined ? undefined : variableMappingSchema.parse(input.variableMapping ?? {});
  return {
    name: input.name?.trim(),
    description: input.description === undefined ? undefined : input.description?.trim() || null,
    tags: input.tags,
    accountId: input.accountId === undefined ? undefined : input.accountId || null,
    phoneNumberId: input.phoneNumberId === undefined ? undefined : input.phoneNumberId || null,
    templateId: input.templateId === undefined ? undefined : input.templateId || null,
    audienceFilter: filter as Prisma.InputJsonValue | undefined,
    variableMapping: mapping as Prisma.InputJsonValue | undefined,
    headerMediaUrl: input.headerMediaUrl === undefined ? undefined : input.headerMediaUrl?.trim() || null,
    trackedLinkId: input.trackedLinkId === undefined ? undefined : input.trackedLinkId || null,
    scheduledAt: input.scheduledAt === undefined ? undefined : input.scheduledAt,
    maxRecipients: input.maxRecipients === undefined ? undefined : input.maxRecipients,
    messagesPerSecond: input.messagesPerSecond === undefined ? undefined : input.messagesPerSecond,
    respectSendingWindow: input.respectSendingWindow,
  };
}

export async function createCampaign(ctx: OrgContext, input: CampaignDraftInput) {
  assertCan(ctx, "campaigns:write");
  if (!input.name?.trim()) throw new UserError("שם קמפיין חסר");
  await assertOwned(ctx, input);
  const campaign = await db.campaign.create({
    data: { ...draftData(input), name: input.name.trim(), organizationId: ctx.orgId, createdById: actorUserId(ctx) },
  });
  await audit(ctx, "campaign.create", { type: "campaign", id: campaign.id }, { name: campaign.name });
  return campaign;
}

export async function updateCampaignDraft(ctx: OrgContext, id: string, input: Partial<CampaignDraftInput>) {
  assertCan(ctx, "campaigns:write");
  const c = await db.campaign.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!c) throw new NotFoundError("הקמפיין לא נמצא");
  if (c.status !== "DRAFT") throw new UserError("ניתן לערוך רק קמפיין בסטטוס טיוטה");
  const merged = { accountId: input.accountId ?? c.accountId, ...input } as CampaignDraftInput;
  await assertOwned(ctx, merged);
  const updated = await db.campaign.update({ where: { id }, data: draftData(input as CampaignDraftInput) });
  await audit(ctx, "campaign.update", { type: "campaign", id });
  return updated;
}

export async function getCampaign(ctx: OrgContext, id: string) {
  assertCan(ctx, "campaigns:read");
  const c = await db.campaign.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { template: true, phoneNumber: true, account: { select: { id: true, name: true, status: true } } },
  });
  if (!c) throw new NotFoundError("הקמפיין לא נמצא");
  return c;
}

export async function listCampaigns(ctx: OrgContext, opts: { status?: CampaignStatus; q?: string; page: number; pageSize: number }) {
  assertCan(ctx, "campaigns:read");
  const where: Prisma.CampaignWhereInput = {
    organizationId: ctx.orgId,
    status: opts.status,
    name: opts.q ? { contains: opts.q, mode: "insensitive" } : undefined,
  };
  const [total, rows] = await Promise.all([
    db.campaign.count({ where }),
    db.campaign.findMany({
      where,
      include: { template: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
  ]);
  const stats = await messageStatusCounts(ctx.orgId, rows.map((r) => r.id));
  return { total, rows: rows.map((r) => ({ ...r, stats: stats.get(r.id) ?? emptyStats() })) };
}

export type StatusCounts = Record<OutboundStatus, number> & { total: number };
function emptyStats(): StatusCounts {
  return { QUEUED: 0, SENDING: 0, SUBMITTED: 0, SENT: 0, DELIVERED: 0, READ: 0, FAILED: 0, SKIPPED: 0, CANCELLED: 0, UNCERTAIN: 0, total: 0 };
}

export async function messageStatusCounts(orgId: string, campaignIds: string[]): Promise<Map<string, StatusCounts>> {
  const map = new Map<string, StatusCounts>();
  if (campaignIds.length === 0) return map;
  const rows = await db.outboundMessage.groupBy({
    by: ["campaignId", "status"],
    where: { organizationId: orgId, campaignId: { in: campaignIds }, kind: "CAMPAIGN" },
    _count: { _all: true },
  });
  for (const r of rows) {
    if (!r.campaignId) continue;
    const s = map.get(r.campaignId) ?? emptyStats();
    s[r.status] = r._count._all;
    s.total += r._count._all;
    map.set(r.campaignId, s);
  }
  return map;
}

// ─────────────────────────── Audience & eligibility ───────────────────────────

export type AudienceRow = {
  contactId: string;
  phoneE164: string;
  name: string | null;
  attributes: Record<string, unknown>;
  eligible: boolean;
  reason: string | null;
};

type CampaignForAudience = {
  audienceFilter: unknown;
  maxRecipients: number | null;
  variableMapping: unknown;
  headerMediaUrl: string | null;
  template: { name: string; language: string; components: unknown } | null;
};

/**
 * Evaluates every contact matched by the campaign's filter and decides
 * eligibility. Order of exclusion reasons: suppression → consent → template
 * variables → max-recipient cap.
 */
export async function computeAudience(orgId: string, campaign: CampaignForAudience, tx?: Tx): Promise<AudienceRow[]> {
  const client = tx ?? db;
  const filter = contactFilterSchema.parse(campaign.audienceFilter ?? {});
  const where = await buildContactWhere(orgId, filter, tx);
  const mapping = variableMappingSchema.parse(campaign.variableMapping ?? {});
  // For eligibility, fill campaign-level gaps (unmapped fixed text, media file) with placeholders:
  // those are reported once by the preflight and must not exclude individual contacts.
  const evalMapping: VariableMapping = { ...mapping };
  if (campaign.template) {
    for (const s of templateSlots(campaign.template.components as TemplateComponent[])) {
      const m = evalMapping[s.key];
      if (!m || (m.type === "static" && !m.value)) evalMapping[s.key] = { type: "static", value: "x" };
    }
  }
  const evalMedia = campaign.headerMediaUrl || "https://placeholder.invalid/media";
  const trackingBase = trackingBaseUrl();
  const rows: AudienceRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const batch = await client.contact.findMany({
      where,
      select: { id: true, phoneE164: true, name: true, attributes: true, consentStatus: true, isSuppressed: true },
      orderBy: { id: "asc" },
      take: 2000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    const hashes = batch.map((c) => hashPhone(c.phoneE164));
    const sup = await client.suppressionEntry.findMany({
      where: { organizationId: orgId, liftedAt: null, phoneHash: { in: hashes } },
      select: { phoneHash: true },
    });
    const supSet = new Set(sup.map((s) => s.phoneHash));
    batch.forEach((c, i) => {
      let reason: string | null = null;
      if (c.isSuppressed || supSet.has(hashes[i])) reason = "SUPPRESSED";
      else if (c.consentStatus === "REVOKED") reason = "CONSENT_REVOKED";
      else if (c.consentStatus !== "GRANTED") reason = "NO_CONSENT";
      else if (campaign.template) {
        try {
          buildTemplatePayload(
            { name: campaign.template.name, language: campaign.template.language, components: campaign.template.components as TemplateComponent[] },
            evalMapping,
            { phoneE164: c.phoneE164, name: c.name, attributes: c.attributes as Record<string, unknown>, clickToken: "x".repeat(CLICK_TOKEN_LENGTH) },
            { trackingBase, headerMediaUrl: evalMedia },
          );
        } catch (e) {
          // Only contact-dependent values (e.g. a name with no fallback) can still be missing here.
          if (e instanceof MissingVariableError) reason = "MISSING_VARIABLE";
          else throw e;
        }
      }
      rows.push({ contactId: c.id, phoneE164: c.phoneE164, name: c.name, attributes: c.attributes as Record<string, unknown>, eligible: !reason, reason });
    });
    if (batch.length < 2000) break;
  }
  if (campaign.maxRecipients && campaign.maxRecipients > 0) {
    let n = 0;
    for (const r of rows) {
      if (!r.eligible) continue;
      n++;
      if (n > campaign.maxRecipients) {
        r.eligible = false;
        r.reason = "OVER_LIMIT";
      }
    }
  }
  return rows;
}

export function summarizeAudience(rows: AudienceRow[]) {
  const reasons: Record<string, number> = {};
  for (const r of rows) if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  return { matched: rows.length, eligible: rows.filter((r) => r.eligible).length, excluded: rows.filter((r) => !r.eligible).length, reasons };
}

export async function previewAudience(ctx: OrgContext, id: string) {
  const c = await getCampaign(ctx, id);
  const rows = await computeAudience(ctx.orgId, c);
  return summarizeAudience(rows);
}

// ─────────────────────────── Preflight ───────────────────────────

export type PreflightItem = { key: string; label: string; ok: boolean; level: "error" | "warning"; detail?: string };

export type Preflight = {
  ok: boolean;
  items: PreflightItem[];
  audience: ReturnType<typeof summarizeAudience>;
  estimate: { cost: number | null; currency: string; rate: number | null; etaText: string; rollingCapRemaining: number; rollingCap: number };
};

/** Every condition that must hold before a campaign may launch. */
export async function preflight(ctx: OrgContext, id: string): Promise<Preflight> {
  assertCan(ctx, "campaigns:read");
  return evaluateCampaign(ctx, await getCampaign(ctx, id));
}

/** A saved campaign, or an unsaved one assembled for a live preview. */
export type CampaignLike = Awaited<ReturnType<typeof getCampaign>>;

export async function evaluateCampaign(ctx: OrgContext, c: CampaignLike): Promise<Preflight> {
  const settings = await getSettings(ctx.orgId);
  const items: PreflightItem[] = [];
  const add = (key: string, label: string, ok: boolean, detail?: string, level: "error" | "warning" = "error") => items.push({ key, label, ok, detail, level });

  add("status", "הקמפיין בטיוטה", c.status === "DRAFT", CAMPAIGN_STATUS_LABELS[c.status]);
  add("account", "חשבון WhatsApp מחובר", c.account?.status === "CONNECTED", c.account ? undefined : "לא נבחר חשבון");
  add(
    "phone",
    "מספר שולח תקין",
    !!c.phoneNumber && c.phoneNumber.status === "CONNECTED" && c.phoneNumber.qualityRating !== "RED",
    !c.phoneNumber ? "לא נבחר מספר" : c.phoneNumber.qualityRating === "RED" ? "איכות המספר אדומה — יש לשפר לפני שליחה" : c.phoneNumber.status !== "CONNECTED" ? "המספר אינו מחובר" : undefined,
  );

  const t = c.template;
  add("template", "תבנית מאושרת ע״י Meta", t?.status === "APPROVED", t ? `סטטוס: ${t.status}` : "לא נבחרה תבנית");
  if (t) {
    add("category", "קטגוריה מותרת לקמפיין", t.category !== "AUTHENTICATION", t.category === "AUTHENTICATION" ? "תבניות אימות אינן מיועדות לקמפיינים" : t.category);
    const comps = t.components as unknown as TemplateComponent[];
    const analysis = analyzeTemplate(comps, settings.unsubscribeKeywords);
    if (t.category === "MARKETING") {
      add(
        "optout",
        "בתבנית אין אפשרות הסרה",
        analysis.hasUnsubscribeFooter || analysis.hasUnsubscribeButton,
        'ההודעה לא מציינת לנמען איך להסיר את עצמו. חוק התקשורת (סעיף 30א) מחייב אפשרות סירוב בכל הודעה פרסומית — חשיפה לפיצוי של עד ₪1,000 להודעה. תגובת "הסר" עדיין תיאכף אוטומטית. מומלץ להוסיף לתבנית שורת "להסרה מרשימת התפוצה, השיבו הסר".',
        "warning",
      );
      if (settings.requireAdvertisingLabel) {
        add("adlabel", 'המילה "פרסומת" בתחילת ההודעה', analysis.hasAdvertisingLabel, 'חוק התקשורת מחייב לפתוח הודעה פרסומית במילה "פרסומת". מומלץ לעדכן את התבנית.', "warning");
      }
    }
    const mapping = variableMappingSchema.parse(c.variableMapping ?? {});
    const missing = templateSlots(comps).filter((s) => !mapping[s.key]);
    add("variables", "כל משתני התבנית מוגדרים", missing.length === 0, missing.map((m) => m.label).join(", ") || undefined);
    if (mediaHeaderFormat(comps)) add("media", "קובץ מדיה לכותרת", !!c.headerMediaUrl, "יש להזין כתובת קובץ ציבורית (https)");
    if (mappingUsesTrackedLink(mapping)) add("link", "קישור מעקב מוגדר", !!c.trackedLinkId, "נבחר משתנה 'קישור מעקב' אך לא נבחר קישור");
  }

  const compliance = await evaluateCompliance(ctx.orgId);
  const missingRequired = compliance.rules.filter((r) => r.rule.required && r.status !== "PASSED");
  add("compliance", compliance.ok ? "הגדרת התאימות החד-פעמית הושלמה" : "נדרשת הגדרת תאימות חד-פעמית (פעם אחת בלבד)", compliance.ok, missingRequired.length ? `חסר: ${missingRequired.map((r) => r.rule.title).join(", ")} — הגדרות ← תאימות (פעם אחת בלבד)` : undefined);

  const rows = await computeAudience(ctx.orgId, c);
  const audience = summarizeAudience(rows);
  add("audience", "יש נמענים כשירים", audience.eligible > 0, audience.eligible > 0 ? `${audience.eligible} כשירים מתוך ${audience.matched}` : "אף איש קשר בקהל שנבחר אינו כשיר — חסרה הסכמה רשומה או שביקשו הסרה");

  const window = settings.sendingWindow as SendingWindow;
  if (c.respectSendingWindow) {
    add("window", "הוגדרו שעות שליחה", windowMinutesPerWeek(window) > 0, "אין שעות שליחה מותרות בהגדרות");
    if (windowMinutesPerWeek(window) > 0 && !isWithinSendingWindow(window, settings.timezone)) add("window_now", "בתוך שעות השליחה", false, "כרגע מחוץ לשעות השליחה — ההודעות יישלחו אוטומטית כשהחלון ייפתח", "warning");
  }
  if (c.phoneNumber?.qualityRating === "YELLOW") add("quality", "איכות המספר", false, "איכות המספר בינונית — מומלץ לשלוח לקהל קטן ואיכותי", "warning");
  if (c.scheduledAt) add("schedule", "מועד עתידי", c.scheduledAt.getTime() > Date.now() - 60_000, "מועד השליחה עבר", "warning");

  // Estimates
  const rates = (settings.costRates ?? {}) as Record<string, number>;
  const rate = t ? (typeof rates[t.category] === "number" ? rates[t.category] : null) : null;
  const tierLimit = parseMessagingLimit(c.phoneNumber?.messagingLimitTier);
  const rollingCap = Math.min(settings.safetyRollingCap, tierLimit ?? settings.safetyRollingCap);
  const used = await uniqueRecipientsLast24h(ctx.orgId);
  const rollingCapRemaining = Math.max(0, rollingCap - used);
  const mps = c.messagesPerSecond ?? c.phoneNumber?.messagesPerSecond ?? settings.defaultMessagesPerSecond;
  add(
    "cap",
    "בתוך מגבלת השליחה המתגלגלת (24 שעות)",
    audience.eligible <= rollingCapRemaining,
    `נותרו ${rollingCapRemaining} נמענים ייחודיים בחלון הנוכחי (מגבלה: ${rollingCap}). הקמפיין יתפרס על פני מספר חלונות.`,
    "warning",
  );

  return {
    ok: items.every((i) => i.ok || i.level === "warning"),
    items,
    audience,
    estimate: {
      cost: rate !== null ? Math.round(audience.eligible * rate * 100) / 100 : null,
      currency: settings.costCurrency,
      rate,
      etaText: estimateEta(audience.eligible, mps, rollingCap, rollingCapRemaining, c.respectSendingWindow ? window : null, settings.timezone),
      rollingCapRemaining,
      rollingCap,
    },
  };
}

function estimateEta(count: number, mps: number, cap: number, capRemaining: number, window: SendingWindow | null, tz: string): string {
  if (count === 0) return "—";
  if (count > capRemaining) {
    const windows = 1 + Math.ceil(Math.max(0, count - capRemaining) / Math.max(1, cap));
    return `כ-${windows} חלונות של 24 שעות (מוגבל ע״י מגבלת הנמענים הייחודיים)`;
  }
  const seconds = Math.ceil(count / Math.max(1, mps));
  const pace = seconds < 90 ? `${seconds} שניות` : seconds < 5400 ? `${Math.ceil(seconds / 60)} דקות` : `${(seconds / 3600).toFixed(1)} שעות`;
  if (window && !isWithinSendingWindow(window, tz)) return `${pace} של שליחה, החל מפתיחת חלון השליחה הבא`;
  return `כ-${pace} (הערכה)`;
}

// ─────────────────────────── Lifecycle ───────────────────────────

/**
 * Launch: re-validates preflight, snapshots the audience into campaign
 * recipients, and enqueues one outbound message per eligible recipient — all
 * in a single transaction, so a launch is all-or-nothing.
 */
export async function launchCampaign(ctx: OrgContext, id: string, confirmation: { confirmedEligibleCount?: number; acknowledgeNoOptOut?: boolean } = {}) {
  assertCan(ctx, "campaigns:launch");
  const pf = await preflight(ctx, id);
  if (!pf.ok) {
    throw new UserError(`לא ניתן להפעיל: ${pf.items.filter((i) => !i.ok && i.level === "error").map((i) => i.label).join(" · ")}`);
  }
  if (confirmation.confirmedEligibleCount !== undefined && confirmation.confirmedEligibleCount !== pf.audience.eligible) {
    throw new UserError("מספר הנמענים השתנה מאז האישור. יש לרענן ולאשר שוב.");
  }
  // A marketing template without an opt-out line may be sent only after an explicit, recorded acknowledgment.
  const noOptOut = pf.items.some((i) => i.key === "optout" && !i.ok);
  if (noOptOut && !confirmation.acknowledgeNoOptOut) {
    throw new UserError("בתבנית אין אפשרות הסרה — יש לאשר את האזהרה לפני השליחה");
  }
  const settings = await getSettings(ctx.orgId);

  const result = await db.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT id, status FROM campaigns WHERE id = ${id} AND "organizationId" = ${ctx.orgId} FOR UPDATE`;
      if (!locked[0]) throw new NotFoundError("הקמפיין לא נמצא");
      if (locked[0].status !== "DRAFT") throw new UserError("הקמפיין כבר הופעל");
      const c = await tx.campaign.findUniqueOrThrow({ where: { id }, include: { template: true, phoneNumber: true } });
      if (!c.template || !c.phoneNumber) throw new UserError("חסרים תבנית או מספר שולח");

      const rows = await computeAudience(ctx.orgId, c, tx);
      const mapping = variableMappingSchema.parse(c.variableMapping ?? {}) as VariableMapping;
      const useClickTokens = mappingUsesTrackedLink(mapping);
      const trackingBase = trackingBaseUrl();
      const templateRef = { name: c.template.name, language: c.template.language, components: c.template.components as unknown as TemplateComponent[] };
      const startAt = c.scheduledAt && c.scheduledAt > new Date() ? c.scheduledAt : new Date();
      let eligible = 0;
      let excluded = 0;

      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000);
        const recipients = await tx.campaignRecipient.createManyAndReturn({
          data: chunk.map((r) => ({
            organizationId: ctx.orgId,
            campaignId: id,
            contactId: r.contactId,
            phoneE164: r.phoneE164,
            eligibility: r.eligible ? ("ELIGIBLE" as const) : ("EXCLUDED" as const),
            exclusionReason: r.reason,
            clickToken: r.eligible && useClickTokens ? randomAlphanumeric(CLICK_TOKEN_LENGTH) : null,
          })),
          select: { id: true, contactId: true, clickToken: true, eligibility: true },
        });
        const byContact = new Map(recipients.map((r) => [r.contactId, r]));
        const messages: Prisma.OutboundMessageCreateManyInput[] = [];
        for (const r of chunk) {
          if (!r.eligible) {
            excluded++;
            continue;
          }
          const rec = byContact.get(r.contactId)!;
          let payload;
          try {
            payload = buildTemplatePayload(templateRef, mapping, { phoneE164: r.phoneE164, name: r.name, attributes: r.attributes, clickToken: rec.clickToken }, { trackingBase, headerMediaUrl: c.headerMediaUrl });
          } catch {
            excluded++;
            await tx.campaignRecipient.update({ where: { id: rec.id }, data: { eligibility: "EXCLUDED", exclusionReason: "MISSING_VARIABLE" } });
            continue;
          }
          eligible++;
          messages.push({
            organizationId: ctx.orgId,
            kind: "CAMPAIGN",
            campaignId: id,
            recipientId: rec.id,
            contactId: r.contactId,
            phoneNumberId: c.phoneNumber.id,
            toPhone: r.phoneE164,
            toPhoneHash: hashPhone(r.phoneE164),
            payload: payload as unknown as Prisma.InputJsonValue,
            templateName: c.template.name,
            category: c.template.category,
            nextAttemptAt: startAt,
            createdById: actorUserId(ctx),
          });
        }
        if (messages.length) await tx.outboundMessage.createMany({ data: messages });
      }

      const rates = (settings.costRates ?? {}) as Record<string, number>;
      const rate = typeof rates[c.template.category] === "number" ? rates[c.template.category] : null;
      const scheduled = !!c.scheduledAt && c.scheduledAt > new Date();
      await tx.campaign.update({
        where: { id },
        data: {
          status: scheduled ? "SCHEDULED" : "QUEUED",
          eligibleCount: eligible,
          excludedCount: excluded,
          estimatedCost: rate !== null ? eligible * rate : null,
          costCurrency: settings.costCurrency,
          launchedAt: new Date(),
          launchedById: actorUserId(ctx),
          pausedReason: null,
        },
      });
      await audit(ctx, "campaign.launch", { type: "campaign", id }, { eligible, excluded, scheduledAt: c.scheduledAt, ...(noOptOut ? { warningAcknowledged: "template_without_opt_out" } : {}) }, tx);
      return { eligible, excluded, scheduled };
    },
    { timeout: 180_000, maxWait: 10_000 },
  );
  return result;
}

export async function pauseCampaign(ctx: OrgContext, id: string) {
  assertCan(ctx, "campaigns:launch");
  const res = await db.campaign.updateMany({
    where: { id, organizationId: ctx.orgId, status: { in: ["RUNNING", "QUEUED", "SCHEDULED"] } },
    data: { status: "PAUSED", pausedReason: "הושהה ידנית" },
  });
  if (res.count === 0) throw new UserError("לא ניתן להשהות קמפיין בסטטוס הנוכחי");
  await audit(ctx, "campaign.pause", { type: "campaign", id });
}

export async function resumeCampaign(ctx: OrgContext, id: string) {
  assertCan(ctx, "campaigns:launch");
  const c = await db.campaign.findFirst({ where: { id, organizationId: ctx.orgId }, include: { account: true } });
  if (!c) throw new NotFoundError("הקמפיין לא נמצא");
  if (c.status !== "PAUSED") throw new UserError("הקמפיין אינו מושהה");
  if (c.account?.status !== "CONNECTED") throw new UserError("חשבון ה-WhatsApp אינו מחובר. יש להריץ בדיקת תקינות לפני חידוש.");
  const compliance = await evaluateCompliance(ctx.orgId);
  if (!compliance.ok) throw new UserError("סטטוס התאימות של העסק אינו תקין");
  const next = c.scheduledAt && c.scheduledAt > new Date() ? "SCHEDULED" : "RUNNING";
  await db.campaign.update({ where: { id }, data: { status: next, pausedReason: null } });
  await audit(ctx, "campaign.resume", { type: "campaign", id });
}

export async function cancelCampaign(ctx: OrgContext, id: string) {
  assertCan(ctx, "campaigns:launch");
  await db.$transaction(async (tx) => {
    const res = await tx.campaign.updateMany({
      where: { id, organizationId: ctx.orgId, status: { in: ["RUNNING", "QUEUED", "SCHEDULED", "PAUSED", "DRAFT"] } },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    if (res.count === 0) throw new UserError("לא ניתן לבטל קמפיין בסטטוס הנוכחי");
    await tx.outboundMessage.updateMany({
      where: { organizationId: ctx.orgId, campaignId: id, status: "QUEUED" },
      data: { status: "CANCELLED", errorCode: "CAMPAIGN_CANCELLED" },
    });
    await audit(ctx, "campaign.cancel", { type: "campaign", id }, {}, tx);
  });
}

/**
 * Manually re-queues UNCERTAIN messages (no Meta confirmation). Only after a
 * waiting period, and only on explicit request, since it may cause duplicates.
 */
export async function requeueUncertain(ctx: OrgContext, id: string) {
  assertCan(ctx, "campaigns:launch");
  const c = await db.campaign.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!c) throw new NotFoundError("הקמפיין לא נמצא");
  const res = await db.outboundMessage.updateMany({
    where: { organizationId: ctx.orgId, campaignId: id, status: "UNCERTAIN", wamid: null, updatedAt: { lt: new Date(Date.now() - 30 * 60_000) } },
    data: { status: "QUEUED", nextAttemptAt: new Date(), errorCode: null, errorDetail: null },
  });
  if (res.count && c.status === "COMPLETED") await db.campaign.update({ where: { id }, data: { status: "RUNNING", completedAt: null } });
  await audit(ctx, "campaign.requeue_uncertain", { type: "campaign", id }, { count: res.count });
  return res.count;
}

/**
 * Sends the campaign's template to an authorized test number immediately
 * (synchronously through the same sender used by the worker).
 */
export async function sendTestMessage(ctx: OrgContext, input: { campaignId?: string; templateId?: string; phone: string; sampleValues?: Record<string, string>; headerMediaUrl?: string }) {
  assertCan(ctx, "campaigns:write");
  const settings = await getSettings(ctx.orgId);
  const phone = normalizePhone(input.phone, settings.defaultCountry);
  if (!phone.ok) throw new UserError(phone.reason);
  if (!settings.testRecipients.includes(phone.e164)) {
    throw new UserError("ניתן לשלוח בדיקות רק למספרים שהוגדרו כ'מספרי בדיקה' בהגדרות");
  }
  let template, phoneNumberId: string | null = null, mapping: VariableMapping = {}, headerMediaUrl: string | null = null;
  if (input.campaignId) {
    const c = await getCampaign(ctx, input.campaignId);
    template = c.template;
    phoneNumberId = c.phoneNumberId;
    mapping = variableMappingSchema.parse(c.variableMapping ?? {});
    headerMediaUrl = c.headerMediaUrl;
  } else if (input.templateId) {
    template = await db.messageTemplate.findFirst({ where: { id: input.templateId, organizationId: ctx.orgId } });
    const def = await db.whatsappPhoneNumber.findFirst({ where: { organizationId: ctx.orgId, accountId: template?.accountId, status: "CONNECTED" }, orderBy: { isDefault: "desc" } });
    phoneNumberId = def?.id ?? null;
  }
  if (!template) throw new UserError("לא נבחרה תבנית");
  if (template.status !== "APPROVED") throw new UserError("ניתן לשלוח בדיקה רק בתבנית מאושרת");
  if (!phoneNumberId) throw new UserError("לא נמצא מספר שולח מחובר");
  const comps = template.components as unknown as TemplateComponent[];
  // Test sends use sample values for any variable without a mapping.
  for (const s of templateSlots(comps)) {
    if (!mapping[s.key] || input.sampleValues?.[s.key]) {
      mapping[s.key] = { type: "static", value: input.sampleValues?.[s.key] || (s.component === "button" ? "test" : "בדיקה") };
    }
  }
  headerMediaUrl = input.headerMediaUrl || headerMediaUrl;
  if (mediaHeaderFormat(comps) && !headerMediaUrl) throw new UserError("לתבנית עם כותרת מדיה יש להזין כתובת קובץ (https)");
  const contact = await db.contact.findUnique({ where: { organizationId_phoneE164: { organizationId: ctx.orgId, phoneE164: phone.e164 } } });
  const payload = buildTemplatePayload(
    { name: template.name, language: template.language, components: comps },
    mapping,
    { phoneE164: phone.e164, name: contact?.name ?? "בדיקה", attributes: (contact?.attributes as Record<string, unknown>) ?? {}, clickToken: "test" },
    { trackingBase: trackingBaseUrl(), headerMediaUrl },
  );
  const msg = await db.outboundMessage.create({
    data: {
      organizationId: ctx.orgId,
      kind: "TEST",
      campaignId: input.campaignId ?? null,
      contactId: contact?.id ?? null,
      phoneNumberId,
      toPhone: phone.e164,
      toPhoneHash: hashPhone(phone.e164),
      payload: payload as unknown as Prisma.InputJsonValue,
      templateName: template.name,
      category: template.category,
      maxAttempts: 1,
      createdById: actorUserId(ctx),
    },
  });
  await audit(ctx, "template.test_send", { type: "outbound_message", id: msg.id }, { template: template.name });
  const claimed = await claimMessageById(`web:${process.pid}`, msg.id);
  if (!claimed) return { messageId: msg.id, status: "QUEUED" as const };
  const outcome = await processClaimed(claimed, `web:${process.pid}`);
  const final = await db.outboundMessage.findUniqueOrThrow({ where: { id: msg.id } });
  return { messageId: msg.id, status: final.status, outcome: outcome.status, error: final.errorDetail };
}
