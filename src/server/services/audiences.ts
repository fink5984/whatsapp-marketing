import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { assertCan, type OrgContext } from "../context";
import { NotFoundError, UserError } from "../rbac";
import { buildContactWhere, contactFilterSchema, type ContactFilter } from "./contact-filter";

export async function listAudiences(ctx: OrgContext) {
  assertCan(ctx, "contacts:read");
  const audiences = await db.audience.findMany({
    where: { organizationId: ctx.orgId },
    include: { _count: { select: { members: true } } },
    orderBy: { name: "asc" },
  });
  // Dynamic audiences are counted live.
  return Promise.all(
    audiences.map(async (a) => {
      if (a.kind !== "DYNAMIC") return { ...a, size: a._count.members };
      const parsed = contactFilterSchema.safeParse(a.filter ?? {});
      const size = parsed.success ? await db.contact.count({ where: await buildContactWhere(ctx.orgId, { ...parsed.data, audienceIds: undefined }) }) : 0;
      return { ...a, size };
    }),
  );
}

export async function getAudience(ctx: OrgContext, id: string) {
  assertCan(ctx, "contacts:read");
  const a = await db.audience.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!a) throw new NotFoundError("הקבוצה לא נמצאה");
  return a;
}

export async function saveAudience(
  ctx: OrgContext,
  input: { name: string; description?: string | null; kind: "STATIC" | "DYNAMIC"; filter?: ContactFilter | null },
  id?: string,
) {
  assertCan(ctx, "audiences:write");
  const name = input.name.trim();
  if (!name) throw new UserError("שם הקבוצה חסר");
  const filter = input.kind === "DYNAMIC" ? (contactFilterSchema.parse({ ...(input.filter ?? {}), audienceIds: undefined }) as Prisma.InputJsonValue) : undefined;
  const dup = await db.audience.findFirst({ where: { organizationId: ctx.orgId, name, id: id ? { not: id } : undefined } });
  if (dup) throw new UserError("קיימת כבר קבוצה בשם זה");
  if (id) {
    const res = await db.audience.updateMany({
      where: { id, organizationId: ctx.orgId },
      data: { name, description: input.description ?? null, ...(filter ? { filter } : {}) },
    });
    if (!res.count) throw new NotFoundError("הקבוצה לא נמצאה");
    return id;
  }
  const a = await db.audience.create({
    data: { organizationId: ctx.orgId, name, description: input.description ?? null, kind: input.kind, filter },
  });
  return a.id;
}

export async function deleteAudience(ctx: OrgContext, id: string) {
  assertCan(ctx, "audiences:write");
  const res = await db.audience.deleteMany({ where: { id, organizationId: ctx.orgId } });
  if (!res.count) throw new NotFoundError("הקבוצה לא נמצאה");
}

export async function addContactsToAudience(ctx: OrgContext, audienceId: string, contactIds: string[]) {
  assertCan(ctx, "audiences:write");
  const a = await db.audience.findFirst({ where: { id: audienceId, organizationId: ctx.orgId, kind: "STATIC" } });
  if (!a) throw new NotFoundError("הקבוצה לא נמצאה");
  const owned = await db.contact.findMany({ where: { organizationId: ctx.orgId, id: { in: contactIds } }, select: { id: true } });
  await db.audienceMember.createMany({ data: owned.map((c) => ({ audienceId, contactId: c.id })), skipDuplicates: true });
  return owned.length;
}

export async function removeContactsFromAudience(ctx: OrgContext, audienceId: string, contactIds: string[]) {
  assertCan(ctx, "audiences:write");
  const a = await db.audience.findFirst({ where: { id: audienceId, organizationId: ctx.orgId } });
  if (!a) throw new NotFoundError("הקבוצה לא נמצאה");
  await db.audienceMember.deleteMany({ where: { audienceId, contactId: { in: contactIds } } });
}
