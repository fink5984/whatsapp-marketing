import type { Role } from "@/generated/prisma/enums";
import { can, ForbiddenError, type Permission } from "./rbac";

/**
 * The tenant context every service receives. Services never accept an
 * organizationId from the client; they take it from here.
 */
export type OrgContext = {
  orgId: string;
  role: Role;
  actor:
    | { type: "user"; userId: string; name: string }
    | { type: "api_key"; apiKeyId: string; scopes: string[] }
    | { type: "system"; label: string };
  ip?: string | null;
};

export function assertCan(ctx: OrgContext, permission: Permission) {
  if (!can(ctx.role, permission)) throw new ForbiddenError();
}

export function actorUserId(ctx: OrgContext): string | null {
  return ctx.actor.type === "user" ? ctx.actor.userId : null;
}

export function systemContext(orgId: string, label = "system"): OrgContext {
  return { orgId, role: "OWNER", actor: { type: "system", label } };
}
