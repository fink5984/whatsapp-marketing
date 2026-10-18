import { db } from "../db";
import { randomAlphanumeric, sha256Hex } from "../crypto";
import { actorUserId, assertCan, type OrgContext } from "../context";
import { audit } from "../audit";
import { NotFoundError, UserError, API_SCOPES, type ApiScope } from "../rbac";

const KEY_PREFIX = "wcm_";

/** Returns the plaintext key ONCE; only its SHA-256 hash is stored. */
export async function createApiKey(ctx: OrgContext, input: { name: string; scopes: string[]; expiresInDays?: number | null }) {
  assertCan(ctx, "apikeys:manage");
  const scopes = input.scopes.filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s));
  if (scopes.length === 0) throw new UserError("יש לבחור לפחות הרשאה אחת");
  const prefix = randomAlphanumeric(8);
  const secret = randomAlphanumeric(40);
  const plaintext = `${KEY_PREFIX}${prefix}_${secret}`;
  const key = await db.apiKey.create({
    data: {
      organizationId: ctx.orgId,
      name: input.name.trim() || "API key",
      prefix,
      keyHash: sha256Hex(plaintext),
      scopes,
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400_000) : null,
      createdById: actorUserId(ctx),
    },
  });
  await audit(ctx, "apikey.create", { type: "api_key", id: key.id }, { name: key.name, scopes });
  return { key, plaintext };
}

export async function revokeApiKey(ctx: OrgContext, id: string) {
  assertCan(ctx, "apikeys:manage");
  const res = await db.apiKey.updateMany({ where: { id, organizationId: ctx.orgId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!res.count) throw new NotFoundError("המפתח לא נמצא");
  await audit(ctx, "apikey.revoke", { type: "api_key", id });
}

export async function listApiKeys(ctx: OrgContext) {
  assertCan(ctx, "apikeys:manage");
  return db.apiKey.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "desc" } });
}

export type ApiKeyContext = OrgContext & { scopes: string[] };

/** Authenticates "Authorization: Bearer wcm_<prefix>_<secret>". */
export async function authenticateApiKey(header: string | null, ip: string | null): Promise<ApiKeyContext | null> {
  const m = header?.match(/^Bearer\s+(wcm_([A-Za-z0-9]{8})_[A-Za-z0-9]{40})$/);
  if (!m) return null;
  const key = await db.apiKey.findUnique({ where: { prefix: m[2] } });
  if (!key || key.keyHash !== sha256Hex(m[1]) || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) return null;
  const org = await db.organization.findUnique({ where: { id: key.organizationId }, select: { status: true } });
  if (org?.status !== "ACTIVE") return null;
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  }
  return {
    orgId: key.organizationId,
    // API keys act with campaign-manager rights, further restricted by scopes at each endpoint.
    role: "CAMPAIGN_MANAGER",
    actor: { type: "api_key", apiKeyId: key.id, scopes: key.scopes },
    ip,
    scopes: key.scopes,
  };
}
