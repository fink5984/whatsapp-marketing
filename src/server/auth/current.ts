import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "../db";
import { SESSION_COOKIE, validateSessionToken } from "./sessions";
import type { OrgContext } from "../context";
import { can, ForbiddenError, type Permission } from "../rbac";
import type { Role } from "@/generated/prisma/enums";

export const ORG_COOKIE = "wcm_org";

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export const getCurrentSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(token);
});

export type AppContext = OrgContext & {
  user: { id: string; name: string; email: string };
  org: { id: string; name: string; slug: string };
  memberships: { orgId: string; orgName: string; role: Role }[];
  can: (p: Permission) => boolean;
};

/**
 * Resolves the signed-in user and the active organization. The active org is
 * re-validated against the user's memberships on every request, so changing
 * a cookie or an ID can never grant access to another tenant.
 */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const session = await getCurrentSession();
  if (!session) return null;
  const memberships = await db.organizationMember.findMany({
    where: { userId: session.userId, organization: { status: "ACTIVE" } },
    include: { organization: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) return null;
  const active = memberships.find((m) => m.organizationId === session.activeOrgId) ?? memberships[0];
  const role = active.role;
  return {
    orgId: active.organizationId,
    role,
    actor: { type: "user", userId: session.userId, name: session.userName },
    ip: await clientIp(),
    user: { id: session.userId, name: session.userName, email: session.userEmail },
    org: active.organization,
    memberships: memberships.map((m) => ({ orgId: m.organizationId, orgName: m.organization.name, role: m.role })),
    can: (p: Permission) => can(role, p),
  };
});

/** For pages: redirects to /login when signed out; throws Forbidden when lacking permission. */
export async function requireAppContext(permission?: Permission): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");
  if (permission && !ctx.can(permission)) throw new ForbiddenError();
  return ctx;
}
