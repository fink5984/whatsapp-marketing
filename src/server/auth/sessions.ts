import { db } from "../db";
import { randomToken, sha256Hex } from "../crypto";
import { verifyPassword } from "./password";
import { rateLimit } from "../rate-limit";

export const SESSION_COOKIE = "wcm_session";
export const SESSION_IDLE_MS = 7 * 24 * 3600_000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 3600_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;

const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MS = 15 * 60_000;

export type LoginResult =
  | { ok: true; token: string; userId: string; expiresAt: Date }
  | { ok: false; error: string };

const GENERIC_LOGIN_ERROR = "דוא״ל או סיסמה שגויים";

export async function login(
  emailInput: string,
  password: string,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<LoginResult> {
  const email = emailInput.trim().toLowerCase();

  const ipLimit = await rateLimit(`login:ip:${meta.ip ?? "unknown"}`, 30, 15 * 60);
  const emailLimit = await rateLimit(`login:email:${email}`, 10, 15 * 60);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return { ok: false, error: "יותר מדי ניסיונות התחברות. נסו שוב בעוד מספר דקות." };
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    // Equalize timing with the password check to avoid user enumeration.
    await verifyPassword(password, "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==");
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, error: "החשבון ננעל זמנית עקב ניסיונות כושלים. נסו שוב מאוחר יותר." };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLogins + 1;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null,
      },
    });
    const membership = await db.organizationMember.findFirst({ where: { userId: user.id } });
    if (membership) {
      await db.auditLog.create({
        data: {
          organizationId: membership.organizationId,
          actorType: "user",
          actorUserId: user.id,
          action: "auth.login_failed",
          ip: meta.ip ?? null,
        },
      });
    }
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }

  const firstMembership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  if (!firstMembership) return { ok: false, error: "המשתמש אינו משויך לאף עסק" };

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_IDLE_MS);
  await db.$transaction([
    db.session.create({
      data: {
        tokenHash: sha256Hex(token),
        userId: user.id,
        activeOrgId: firstMembership.organizationId,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        expiresAt,
      },
    }),
    db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null },
    }),
    db.auditLog.create({
      data: {
        organizationId: firstMembership.organizationId,
        actorType: "user",
        actorUserId: user.id,
        action: "auth.login",
        ip: meta.ip ?? null,
      },
    }),
  ]);
  return { ok: true, token, userId: user.id, expiresAt };
}

export type ValidSession = {
  sessionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  activeOrgId: string | null;
};

export async function validateSessionToken(token: string): Promise<ValidSession | null> {
  if (!token || token.length > 200) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!session) return null;
  const now = Date.now();
  if (
    session.expiresAt.getTime() <= now ||
    session.createdAt.getTime() + SESSION_ABSOLUTE_MS <= now ||
    !session.user.isActive
  ) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(now + SESSION_IDLE_MS) },
    });
  }
  return {
    sessionId: session.id,
    userId: session.userId,
    userName: session.user.name,
    userEmail: session.user.email,
    activeOrgId: session.activeOrgId,
  };
}

export async function revokeSessionToken(token: string) {
  await db.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
}

export async function revokeAllUserSessions(userId: string) {
  await db.session.deleteMany({ where: { userId } });
}

export async function purgeExpiredSessions() {
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
