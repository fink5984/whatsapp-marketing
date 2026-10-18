import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "../db";

export const contactFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  tagIds: z.array(z.string()).max(50).optional(),
  tagMode: z.enum(["any", "all"]).optional(),
  excludeTagIds: z.array(z.string()).max(50).optional(),
  audienceIds: z.array(z.string()).max(50).optional(),
  sources: z.array(z.string()).max(50).optional(),
  consent: z.enum(["UNKNOWN", "GRANTED", "REVOKED"]).optional(),
  suppressed: z.boolean().optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  activity: z.enum(["never_sent", "sent", "delivered", "read", "clicked", "replied", "not_replied"]).optional(),
  notSentForDays: z.number().int().min(1).max(3650).optional(),
  excludeCampaignIds: z.array(z.string()).max(50).optional(),
  /** Explicitly chosen contacts (manual selection). Always intersected with the org. */
  contactIds: z.array(z.string()).max(5000).optional(),
});

export type ContactFilter = z.infer<typeof contactFilterSchema>;

/**
 * Builds an org-scoped Prisma `where` for contacts. The organizationId is
 * always applied at the top level, so no filter value can reach another tenant.
 */
export async function buildContactWhere(orgId: string, filter: ContactFilter, tx?: Tx, depth = 0): Promise<Prisma.ContactWhereInput> {
  const client = tx ?? db;
  const and: Prisma.ContactWhereInput[] = [];

  if (filter.q) {
    const q = filter.q;
    const digits = q.replace(/\D/g, "");
    const or: Prisma.ContactWhereInput[] = [
      { name: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
    ];
    if (digits.length >= 3) {
      or.push({ phoneE164: { contains: digits.startsWith("0") ? digits.slice(1) : digits } });
    }
    and.push({ OR: or });
  }
  if (filter.tagIds?.length) {
    if (filter.tagMode === "all") {
      for (const tagId of filter.tagIds) and.push({ tags: { some: { tagId } } });
    } else {
      and.push({ tags: { some: { tagId: { in: filter.tagIds } } } });
    }
  }
  if (filter.excludeTagIds?.length) and.push({ tags: { none: { tagId: { in: filter.excludeTagIds } } } });
  if (filter.contactIds) and.push({ id: { in: filter.contactIds } });
  if (filter.sources?.length) and.push({ source: { in: filter.sources } });
  if (filter.consent) and.push({ consentStatus: filter.consent });
  if (filter.suppressed !== undefined) and.push({ isSuppressed: filter.suppressed });
  if (filter.createdFrom) and.push({ createdAt: { gte: filter.createdFrom } });
  if (filter.createdTo) and.push({ createdAt: { lte: filter.createdTo } });
  if (filter.notSentForDays) {
    const cutoff = new Date(Date.now() - filter.notSentForDays * 86400_000);
    and.push({ OR: [{ lastSentAt: null }, { lastSentAt: { lt: cutoff } }] });
  }
  switch (filter.activity) {
    case "never_sent":
      and.push({ sentCount: 0 });
      break;
    case "sent":
      and.push({ sentCount: { gt: 0 } });
      break;
    case "delivered":
      and.push({ deliveredCount: { gt: 0 } });
      break;
    case "read":
      and.push({ readCount: { gt: 0 } });
      break;
    case "clicked":
      and.push({ clickCount: { gt: 0 } });
      break;
    case "replied":
      and.push({ lastInboundAt: { not: null } });
      break;
    case "not_replied":
      and.push({ lastInboundAt: null });
      break;
  }
  if (filter.excludeCampaignIds?.length) {
    and.push({
      recipients: {
        none: { campaignId: { in: filter.excludeCampaignIds }, eligibility: "ELIGIBLE", campaign: { organizationId: orgId } },
      },
    });
  }
  if (filter.audienceIds?.length) {
    const audiences = await client.audience.findMany({ where: { organizationId: orgId, id: { in: filter.audienceIds } } });
    const or: Prisma.ContactWhereInput[] = [];
    for (const a of audiences) {
      if (a.kind === "DYNAMIC" && a.filter && depth === 0) {
        const parsed = contactFilterSchema.safeParse(a.filter);
        if (parsed.success) {
          // Nested audiences are not expanded (prevents cycles).
          const { audienceIds: _ignored, ...rest } = parsed.data;
          or.push(await buildContactWhere(orgId, rest, tx, depth + 1));
        }
      } else {
        or.push({ audienceMembers: { some: { audienceId: a.id } } });
      }
    }
    and.push(or.length ? { OR: or } : { id: "__none__" });
  }

  return { organizationId: orgId, AND: and };
}

/** Parses the filter fields of a contacts-table URL. */
export function filterFromSearchParams(sp: Record<string, string | string[] | undefined>): ContactFilter {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const many = (k: string) => {
    const v = one(k);
    return v ? v.split(",").filter(Boolean) : undefined;
  };
  const raw = {
    q: one("q") || undefined,
    tagIds: many("tags"),
    audienceIds: many("audiences"),
    sources: many("sources"),
    consent: one("consent") || undefined,
    suppressed: one("suppressed") === "1" ? true : one("suppressed") === "0" ? false : undefined,
    activity: one("activity") || undefined,
  };
  const parsed = contactFilterSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}
