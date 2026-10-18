import type { Role } from "@/generated/prisma/enums";
import { db } from "../db";
import { assertCan, type OrgContext } from "../context";
import { audit } from "../audit";
import { ForbiddenError, NotFoundError, UserError } from "../rbac";
import { hashPassword, validatePasswordStrength } from "../auth/password";
import { revokeAllUserSessions } from "../auth/sessions";
import { getSettings } from "./settings";
import { seedDefaultRules } from "./automations";

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || `org-${Date.now().toString(36)}`;
}

/** Creates an organization with its owner. Used by bootstrap (and future self-signup). */
export async function createOrganizationWithOwner(input: {
  orgName: string;
  industry?: string | null;
  owner: { email: string; name: string; password: string };
}) {
  const pwError = validatePasswordStrength(input.owner.password);
  if (pwError) throw new UserError(pwError);
  const email = input.owner.email.trim().toLowerCase();
  let slug = slugify(input.orgName);
  if (await db.organization.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;
  const passwordHash = await hashPassword(input.owner.password);
  const result = await db.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: input.orgName.trim(), slug, industry: input.industry ?? null } });
    const user = await tx.user.upsert({
      where: { email },
      update: {},
      create: { email, name: input.owner.name.trim(), passwordHash },
    });
    await tx.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "OWNER" } });
    return { org, user };
  });
  await getSettings(result.org.id);
  await seedDefaultRules(result.org.id);
  return result;
}

export async function listMembers(ctx: OrgContext) {
  assertCan(ctx, "settings:read");
  return db.organizationMember.findMany({
    where: { organizationId: ctx.orgId },
    include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true, isActive: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Adds a team member with an initial password (shared out-of-band; the user
 * should change it). Email-based invitations can be added once an email
 * provider is configured.
 */
export async function addMember(ctx: OrgContext, input: { email: string; name: string; role: Role; password: string }) {
  assertCan(ctx, "users:manage");
  if (input.role === "OWNER" && ctx.role !== "OWNER") throw new ForbiddenError("רק בעלים יכולים למנות בעלים");
  const email = input.email.trim().toLowerCase();
  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    const pwError = validatePasswordStrength(input.password);
    if (pwError) throw new UserError(pwError);
    user = await db.user.create({ data: { email, name: input.name.trim(), passwordHash: await hashPassword(input.password) } });
  }
  const existing = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.orgId, userId: user.id } } });
  if (existing) throw new UserError("המשתמש כבר חבר בעסק");
  await db.organizationMember.create({ data: { organizationId: ctx.orgId, userId: user.id, role: input.role } });
  await audit(ctx, "member.invite", { type: "user", id: user.id }, { role: input.role });
  return user;
}

export async function updateMemberRole(ctx: OrgContext, userId: string, role: Role) {
  assertCan(ctx, "users:manage");
  const m = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.orgId, userId } } });
  if (!m) throw new NotFoundError("המשתמש לא נמצא");
  if ((m.role === "OWNER" || role === "OWNER") && ctx.role !== "OWNER") throw new ForbiddenError("רק בעלים יכולים לשנות הרשאת בעלים");
  if (m.role === "OWNER" && role !== "OWNER") {
    const owners = await db.organizationMember.count({ where: { organizationId: ctx.orgId, role: "OWNER" } });
    if (owners <= 1) throw new UserError("חייב להישאר לפחות בעלים אחד");
  }
  await db.organizationMember.update({ where: { id: m.id }, data: { role } });
  await audit(ctx, "member.update", { type: "user", id: userId }, { from: m.role, to: role });
}

export async function removeMember(ctx: OrgContext, userId: string) {
  assertCan(ctx, "users:manage");
  const m = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ctx.orgId, userId } } });
  if (!m) throw new NotFoundError("המשתמש לא נמצא");
  if (m.role === "OWNER") {
    if (ctx.role !== "OWNER") throw new ForbiddenError();
    const owners = await db.organizationMember.count({ where: { organizationId: ctx.orgId, role: "OWNER" } });
    if (owners <= 1) throw new UserError("לא ניתן להסיר את הבעלים האחרון");
  }
  await db.organizationMember.delete({ where: { id: m.id } });
  // Drop sessions pointing at this org.
  await db.session.deleteMany({ where: { userId, activeOrgId: ctx.orgId } });
  await audit(ctx, "member.remove", { type: "user", id: userId });
}

export async function changePassword(userId: string, current: string, next: string) {
  const { verifyPassword } = await import("../auth/password");
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(current, user.passwordHash))) throw new UserError("הסיסמה הנוכחית שגויה");
  const err = validatePasswordStrength(next);
  if (err) throw new UserError(err);
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
  await revokeAllUserSessions(userId);
}

export async function updateOrganization(ctx: OrgContext, input: { name?: string; industry?: string | null }) {
  assertCan(ctx, "settings:write");
  await db.organization.update({ where: { id: ctx.orgId }, data: { name: input.name?.trim() || undefined, industry: input.industry === undefined ? undefined : input.industry } });
}
