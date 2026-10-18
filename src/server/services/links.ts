import { db } from "../db";
import { randomAlphanumeric, visitorHash } from "../crypto";
import { assertCan, type OrgContext } from "../context";
import { NotFoundError, UserError } from "../rbac";
import { trackingBaseUrl } from "../env";
import { emitEvent } from "./outgoing-webhooks";
import { getSettings } from "./settings";

export const LINK_TOKEN_LENGTH = 10;
export const CLICK_TOKEN_LENGTH = 14;

/** Validates a redirect destination. Only absolute http(s) URLs; optional domain allowlist. */
export function validateDestination(url: string, allowedDomains: string[]): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new UserError("כתובת יעד לא תקינה");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new UserError("כתובת היעד חייבת להתחיל ב-https://");
  if (u.username || u.password) throw new UserError("כתובת עם פרטי התחברות אינה מותרת");
  if (allowedDomains.length) {
    const host = u.hostname.toLowerCase();
    const ok = allowedDomains.some((d) => {
      const dom = d.toLowerCase().replace(/^\*\./, "");
      return host === dom || host.endsWith(`.${dom}`);
    });
    if (!ok) throw new UserError(`הדומיין ${u.hostname} אינו ברשימת הדומיינים המותרים`);
  }
  return u.toString();
}

export async function createTrackedLink(ctx: OrgContext, input: { name: string; destinationUrl: string; campaignId?: string | null }) {
  assertCan(ctx, "campaigns:write");
  const settings = await getSettings(ctx.orgId);
  const destinationUrl = validateDestination(input.destinationUrl, settings.allowedRedirectDomains);
  if (input.campaignId) {
    const c = await db.campaign.findFirst({ where: { id: input.campaignId, organizationId: ctx.orgId } });
    if (!c) throw new NotFoundError("הקמפיין לא נמצא");
  }
  return db.trackedLink.create({
    data: {
      organizationId: ctx.orgId,
      campaignId: input.campaignId ?? null,
      name: input.name.trim() || "קישור",
      destinationUrl,
      token: randomAlphanumeric(LINK_TOKEN_LENGTH),
    },
  });
}

export function trackedUrl(token: string) {
  return `${trackingBaseUrl()}/r/${token}`;
}

const BOT_UA = /(whatsapp|facebookexternalhit|facebot|twitterbot|slackbot|telegrambot|discordbot|linkedinbot|googlebot|bingbot|bot\b|crawler|spider|preview|curl|wget|python-requests|headlesschrome)/i;

export function isBotUserAgent(ua: string | null | undefined) {
  return !ua || BOT_UA.test(ua);
}

export type ClickResolution = { destination: string } | null;

/**
 * Resolves a /r/<token> click. Tokens are either a link token (aggregate
 * tracking) or a per-recipient click token. Destinations come only from the
 * database — never from the request — so there is no open redirect.
 * Link-preview bots are recorded as bots and excluded from counts.
 */
export async function recordClick(token: string, meta: { ip: string; userAgent: string | null }): Promise<ClickResolution> {
  if (!/^[A-Za-z0-9]{6,40}$/.test(token)) return null;

  let link = await db.trackedLink.findUnique({ where: { token } });
  let recipient: { id: string; campaignId: string; contactId: string | null } | null = null;
  if (!link) {
    const r = await db.campaignRecipient.findUnique({
      where: { clickToken: token },
      select: { id: true, campaignId: true, contactId: true, organizationId: true, campaign: { select: { trackedLinkId: true } } },
    });
    if (r?.campaign.trackedLinkId) {
      link = await db.trackedLink.findFirst({ where: { id: r.campaign.trackedLinkId, organizationId: r.organizationId } });
      recipient = { id: r.id, campaignId: r.campaignId, contactId: r.contactId };
    }
  }
  if (!link || !link.isActive) return null;

  const settings = await getSettings(link.organizationId);
  const isBot = isBotUserAgent(meta.userAgent);
  const day = new Date().toISOString().slice(0, 10);
  const vHash = visitorHash(meta.ip, meta.userAgent ?? "", day);
  const contactId = settings.perContactClickTracking ? (recipient?.contactId ?? null) : null;
  const recipientId = settings.perContactClickTracking ? (recipient?.id ?? null) : null;

  const linkId = link.id;
  const orgId = link.organizationId;
  const campaignId = recipient?.campaignId ?? link.campaignId;
  await db.$transaction(async (tx) => {
    let isUnique = false;
    if (!isBot) {
      const prior = await tx.linkClick.findFirst({
        where: recipientId ? { linkId, recipientId, isBot: false } : { linkId, visitorHash: vHash, isBot: false },
        select: { id: true },
      });
      isUnique = !prior;
    }
    await tx.linkClick.create({
      data: {
        organizationId: orgId,
        linkId,
        campaignId,
        recipientId,
        contactId,
        visitorHash: vHash,
        isBot,
        isUnique,
        userAgent: meta.userAgent?.slice(0, 200) ?? null,
      },
    });
    if (!isBot && isUnique && contactId) {
      await tx.contact.updateMany({ where: { id: contactId, organizationId: orgId }, data: { clickCount: { increment: 1 } } });
    }
  });
  if (!isBot) await emitEvent(orgId, "link.clicked", { linkId, campaignId, contactId });
  return { destination: link.destinationUrl };
}

export async function linkStats(ctx: OrgContext, campaignId?: string) {
  assertCan(ctx, "reports:read");
  const links = await db.trackedLink.findMany({
    where: { organizationId: ctx.orgId, ...(campaignId ? { campaignId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  const counts = await db.linkClick.groupBy({
    by: ["linkId", "isUnique"],
    where: { organizationId: ctx.orgId, isBot: false, linkId: { in: links.map((l) => l.id) } },
    _count: { _all: true },
  });
  return links.map((l) => {
    const total = counts.filter((c) => c.linkId === l.id).reduce((s, c) => s + c._count._all, 0);
    const unique = counts.find((c) => c.linkId === l.id && c.isUnique)?._count._all ?? 0;
    return { ...l, url: trackedUrl(l.token), total, unique };
  });
}
