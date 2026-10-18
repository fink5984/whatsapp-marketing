import { db } from "../db";
import { assertCan, type OrgContext } from "../context";
import { NotFoundError } from "../rbac";
import { getSettings } from "./settings";
import { messageStatusCounts } from "./campaigns";

/** How trustworthy a number is — rendered as a badge next to each metric. */
export type DataQuality = "exact" | "partial" | "estimate";

export type Metric = { value: number | null; quality: DataQuality; hint?: string };

function since(days: number) {
  return new Date(Date.now() - days * 86400_000);
}

export async function overview(ctx: OrgContext, days = 30) {
  assertCan(ctx, "reports:read");
  const org = ctx.orgId;
  const from = since(days);
  const settings = await getSettings(org);
  const rates = (settings.costRates ?? {}) as Record<string, number>;

  const [
    totalContacts,
    eligibleContacts,
    activeCampaigns,
    pending,
    sent,
    delivered,
    read,
    failed,
    clicks,
    uniqueClicks,
    unsubscribes,
    replies,
    leads,
    costRows,
  ] = await Promise.all([
    db.contact.count({ where: { organizationId: org } }),
    db.contact.count({ where: { organizationId: org, consentStatus: "GRANTED", isSuppressed: false } }),
    db.campaign.count({ where: { organizationId: org, status: { in: ["RUNNING", "QUEUED", "SCHEDULED"] } } }),
    db.outboundMessage.count({ where: { organizationId: org, status: { in: ["QUEUED", "SENDING"] } } }),
    db.outboundMessage.count({ where: { organizationId: org, submittedAt: { gte: from } } }),
    db.outboundMessage.count({ where: { organizationId: org, deliveredAt: { gte: from } } }),
    db.outboundMessage.count({ where: { organizationId: org, readAt: { gte: from } } }),
    db.outboundMessage.count({ where: { organizationId: org, failedAt: { gte: from } } }),
    db.linkClick.count({ where: { organizationId: org, isBot: false, clickedAt: { gte: from } } }),
    db.linkClick.count({ where: { organizationId: org, isBot: false, isUnique: true, clickedAt: { gte: from } } }),
    db.suppressionEntry.count({ where: { organizationId: org, createdAt: { gte: from } } }),
    db.inboundMessage.count({ where: { organizationId: org, receivedAt: { gte: from }, isUnsubscribe: false } }),
    db.lead.count({ where: { organizationId: org, createdAt: { gte: from } } }),
    db.outboundMessage.groupBy({
      by: ["category", "billable"],
      where: { organizationId: org, submittedAt: { gte: from }, kind: { in: ["CAMPAIGN", "TEST"] } },
      _count: { _all: true },
    }),
  ]);

  let estimatedCost = 0;
  let billableCost = 0;
  let hasRates = false;
  let billableKnown = 0;
  for (const r of costRows) {
    const rate = r.category ? rates[r.category] : undefined;
    if (typeof rate !== "number") continue;
    hasRates = true;
    estimatedCost += r._count._all * rate;
    if (r.billable === true) billableCost += r._count._all * rate;
    if (r.billable !== null) billableKnown += r._count._all;
  }

  const metrics: Record<string, Metric> = {
    totalContacts: { value: totalContacts, quality: "exact" },
    eligibleContacts: { value: eligibleContacts, quality: "exact", hint: "הסכמה מתועדת ולא ברשימת הסרה" },
    activeCampaigns: { value: activeCampaigns, quality: "exact" },
    pending: { value: pending, quality: "exact" },
    sent: { value: sent, quality: "exact", hint: "התקבלו ע״י Meta (אישור API — עדיין לא מסירה)" },
    delivered: { value: delivered, quality: "partial", hint: "לפי Webhooks שהתקבלו מ-Meta" },
    read: { value: read, quality: "partial", hint: "חלק מהנמענים מכבים אישורי קריאה — הנתון חסר בהכרח" },
    failed: { value: failed, quality: "exact" },
    clicks: { value: clicks, quality: "exact", hint: "ללא בוטים ותצוגות מקדימות" },
    uniqueClicks: { value: uniqueClicks, quality: "estimate", hint: "ייחודיות לפי נמען או טביעת מבקר יומית" },
    unsubscribes: { value: unsubscribes, quality: "exact" },
    replies: { value: replies, quality: "exact" },
    leads: { value: leads, quality: "exact" },
    estimatedCost: { value: hasRates ? round(estimatedCost) : null, quality: "estimate", hint: hasRates ? "הודעות × תעריף שהוגדר" : "לא הוגדרו תעריפים בהגדרות" },
    billableCost: {
      value: hasRates && billableKnown > 0 ? round(billableCost) : null,
      quality: "estimate",
      hint: "הודעות שסומנו כמחויבות ע״י Meta × התעריף שהוגדר. החשבונית מ-Meta היא המקור הקובע.",
    },
  };
  return { days, metrics, currency: settings.costCurrency };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

export type DailyPoint = { day: string; sent: number; delivered: number; read: number; failed: number; clicks: number; unsubscribes: number; cost: number | null };

export async function dailySeries(ctx: OrgContext, days = 30): Promise<DailyPoint[]> {
  assertCan(ctx, "reports:read");
  const settings = await getSettings(ctx.orgId);
  const tz = settings.timezone;
  const from = since(days);
  const rates = (settings.costRates ?? {}) as Record<string, number>;
  const [msgRows, clickRows, unsubRows, costRows] = await Promise.all([
    db.$queryRaw<{ day: string; kind: string; n: bigint }[]>`
      SELECT to_char(date_trunc('day', ts AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day, kind, count(*) AS n FROM (
        SELECT "submittedAt" AS ts, 'sent' AS kind FROM outbound_messages WHERE "organizationId" = ${ctx.orgId} AND "submittedAt" >= ${from}
        UNION ALL SELECT "deliveredAt", 'delivered' FROM outbound_messages WHERE "organizationId" = ${ctx.orgId} AND "deliveredAt" >= ${from}
        UNION ALL SELECT "readAt", 'read' FROM outbound_messages WHERE "organizationId" = ${ctx.orgId} AND "readAt" >= ${from}
        UNION ALL SELECT "failedAt", 'failed' FROM outbound_messages WHERE "organizationId" = ${ctx.orgId} AND "failedAt" >= ${from}
      ) t GROUP BY 1, 2`,
    db.$queryRaw<{ day: string; n: bigint }[]>`
      SELECT to_char(date_trunc('day', "clickedAt" AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day, count(*) AS n
      FROM link_clicks WHERE "organizationId" = ${ctx.orgId} AND "isBot" = false AND "clickedAt" >= ${from} GROUP BY 1`,
    db.$queryRaw<{ day: string; n: bigint }[]>`
      SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day, count(*) AS n
      FROM suppression_entries WHERE "organizationId" = ${ctx.orgId} AND "createdAt" >= ${from} GROUP BY 1`,
    db.$queryRaw<{ day: string; category: string | null; n: bigint }[]>`
      SELECT to_char(date_trunc('day', "submittedAt" AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day, category::text AS category, count(*) AS n
      FROM outbound_messages WHERE "organizationId" = ${ctx.orgId} AND "submittedAt" >= ${from} AND kind IN ('CAMPAIGN','TEST') GROUP BY 1, 2`,
  ]);

  const map = new Map<string, DailyPoint>();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  for (let i = days - 1; i >= 0; i--) {
    const day = fmt.format(new Date(Date.now() - i * 86400_000));
    map.set(day, { day, sent: 0, delivered: 0, read: 0, failed: 0, clicks: 0, unsubscribes: 0, cost: Object.keys(rates).length ? 0 : null });
  }
  for (const r of msgRows) {
    const p = map.get(r.day);
    if (p) p[r.kind as "sent" | "delivered" | "read" | "failed"] = Number(r.n);
  }
  for (const r of clickRows) {
    const p = map.get(r.day);
    if (p) p.clicks = Number(r.n);
  }
  for (const r of unsubRows) {
    const p = map.get(r.day);
    if (p) p.unsubscribes = Number(r.n);
  }
  for (const r of costRows) {
    const p = map.get(r.day);
    const rate = r.category ? rates[r.category] : undefined;
    if (p && p.cost !== null && typeof rate === "number") p.cost = round(p.cost + Number(r.n) * rate);
  }
  return [...map.values()];
}

export async function campaignComparison(ctx: OrgContext, limit = 10) {
  assertCan(ctx, "reports:read");
  const campaigns = await db.campaign.findMany({
    where: { organizationId: ctx.orgId, status: { not: "DRAFT" } },
    orderBy: { launchedAt: { sort: "desc", nulls: "last" } },
    take: limit,
    select: { id: true, name: true, status: true, eligibleCount: true, launchedAt: true, estimatedCost: true, costCurrency: true },
  });
  const ids = campaigns.map((c) => c.id);
  const [stats, clicks, unsubs, leads, replies] = await Promise.all([
    messageStatusCounts(ctx.orgId, ids),
    db.linkClick.groupBy({ by: ["campaignId"], where: { organizationId: ctx.orgId, campaignId: { in: ids }, isBot: false }, _count: { _all: true } }),
    db.inboundMessage.groupBy({ by: ["campaignId"], where: { organizationId: ctx.orgId, campaignId: { in: ids }, isUnsubscribe: true }, _count: { _all: true } }),
    db.lead.groupBy({ by: ["campaignId"], where: { organizationId: ctx.orgId, campaignId: { in: ids } }, _count: { _all: true } }),
    db.inboundMessage.groupBy({ by: ["campaignId"], where: { organizationId: ctx.orgId, campaignId: { in: ids }, isUnsubscribe: false }, _count: { _all: true } }),
  ]);
  const count = (rows: { campaignId: string | null; _count: { _all: number } }[], id: string) => rows.find((r) => r.campaignId === id)?._count._all ?? 0;
  return campaigns.map((c) => {
    const s = stats.get(c.id);
    const accepted = s ? s.SUBMITTED + s.SENT + s.DELIVERED + s.READ + s.FAILED : 0;
    const delivered = s ? s.DELIVERED + s.READ : 0;
    return {
      ...c,
      estimatedCost: c.estimatedCost ? Number(c.estimatedCost) : null,
      accepted,
      delivered,
      read: s?.READ ?? 0,
      failed: s?.FAILED ?? 0,
      clicks: count(clicks, c.id),
      unsubscribes: count(unsubs, c.id),
      leads: count(leads, c.id),
      replies: count(replies, c.id),
      deliveryRate: accepted ? delivered / accepted : null,
      readRate: delivered ? (s?.READ ?? 0) / delivered : null,
    };
  });
}

export async function campaignReport(ctx: OrgContext, campaignId: string) {
  assertCan(ctx, "campaigns:read");
  const c = await db.campaign.findFirst({ where: { id: campaignId, organizationId: ctx.orgId } });
  if (!c) throw new NotFoundError("הקמפיין לא נמצא");
  const settings = await getSettings(ctx.orgId);
  const tz = settings.timezone;
  const rates = (settings.costRates ?? {}) as Record<string, number>;
  const [statsMap, failures, exclusions, hourly, billable, unsubs, replies, leads, uncertainAged] = await Promise.all([
    messageStatusCounts(ctx.orgId, [campaignId]),
    db.outboundMessage.groupBy({
      by: ["errorCode"],
      where: { organizationId: ctx.orgId, campaignId, status: { in: ["FAILED", "SKIPPED", "CANCELLED", "UNCERTAIN"] } },
      _count: { _all: true },
    }),
    db.campaignRecipient.groupBy({ by: ["exclusionReason"], where: { organizationId: ctx.orgId, campaignId, eligibility: "EXCLUDED" }, _count: { _all: true } }),
    db.$queryRaw<{ hour: string; kind: string; n: bigint }[]>`
      SELECT to_char(date_trunc('hour', ts AT TIME ZONE ${tz}), 'YYYY-MM-DD HH24:00') AS hour, kind, count(*) AS n FROM (
        SELECT "submittedAt" AS ts, 'sent' AS kind FROM outbound_messages WHERE "campaignId" = ${campaignId} AND "organizationId" = ${ctx.orgId} AND "submittedAt" IS NOT NULL
        UNION ALL SELECT "deliveredAt", 'delivered' FROM outbound_messages WHERE "campaignId" = ${campaignId} AND "organizationId" = ${ctx.orgId} AND "deliveredAt" IS NOT NULL
        UNION ALL SELECT "readAt", 'read' FROM outbound_messages WHERE "campaignId" = ${campaignId} AND "organizationId" = ${ctx.orgId} AND "readAt" IS NOT NULL
      ) t GROUP BY 1, 2 ORDER BY 1`,
    db.outboundMessage.count({ where: { organizationId: ctx.orgId, campaignId, billable: true } }),
    db.inboundMessage.count({ where: { organizationId: ctx.orgId, campaignId, isUnsubscribe: true } }),
    db.inboundMessage.count({ where: { organizationId: ctx.orgId, campaignId, isUnsubscribe: false } }),
    db.lead.count({ where: { organizationId: ctx.orgId, campaignId } }),
    db.outboundMessage.count({
      where: { organizationId: ctx.orgId, campaignId, status: "UNCERTAIN", wamid: null, updatedAt: { lt: new Date(Date.now() - 30 * 60_000) } },
    }),
  ]);
  const hours = new Map<string, { hour: string; sent: number; delivered: number; read: number }>();
  for (const r of hourly) {
    const h = hours.get(r.hour) ?? { hour: r.hour, sent: 0, delivered: 0, read: 0 };
    h[r.kind as "sent" | "delivered" | "read"] = Number(r.n);
    hours.set(r.hour, h);
  }
  const template = c.templateId ? await db.messageTemplate.findUnique({ where: { id: c.templateId }, select: { category: true, name: true } }) : null;
  const rate = template ? rates[template.category] : undefined;
  return {
    campaign: c,
    stats: statsMap.get(campaignId),
    failures: failures.map((f) => ({ code: f.errorCode ?? "UNKNOWN", count: f._count._all })).sort((a, b) => b.count - a.count),
    exclusions: exclusions.map((e) => ({ reason: e.exclusionReason ?? "UNKNOWN", count: e._count._all })),
    hourly: [...hours.values()],
    cost: {
      estimated: c.estimatedCost ? Number(c.estimatedCost) : null,
      billableMessages: billable,
      billableCost: typeof rate === "number" ? round(billable * rate) : null,
      currency: c.costCurrency ?? settings.costCurrency,
    },
    unsubscribes: unsubs,
    replies,
    leads,
    uncertainRequeueable: uncertainAged,
  };
}

export async function campaignRecipients(ctx: OrgContext, campaignId: string, opts: { status?: string; q?: string; page: number; pageSize: number }) {
  assertCan(ctx, "campaigns:read");
  const where = {
    organizationId: ctx.orgId,
    campaignId,
    ...(opts.status === "EXCLUDED" ? { eligibility: "EXCLUDED" as const } : opts.status ? { message: { status: opts.status as never } } : {}),
    ...(opts.q ? { OR: [{ phoneE164: { contains: opts.q.replace(/\D/g, "").replace(/^0/, "") || opts.q } }, { contact: { name: { contains: opts.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    db.campaignRecipient.count({ where }),
    db.campaignRecipient.findMany({
      where,
      include: { contact: { select: { id: true, name: true } }, message: true },
      orderBy: { createdAt: "asc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
  ]);
  return { total, rows };
}
