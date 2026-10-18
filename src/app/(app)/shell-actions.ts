"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { getAppContext, getCurrentSession } from "@/server/auth/current";
import { revokeSessionToken, SESSION_COOKIE } from "@/server/auth/sessions";
import { audit } from "@/server/audit";
import { changePassword } from "@/server/services/organizations";
import { toActionError, type ActionResult } from "@/server/auth/action";

export async function logoutAction() {
  const ctx = await getAppContext();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSessionToken(token);
  if (ctx) await audit(ctx, "auth.logout");
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

/** Switches the active organization — only to one the user is a member of. */
export async function switchOrgAction(orgId: string): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "יש להתחבר מחדש" };
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId: session.userId } } });
  if (!member) return { ok: false, error: "אין לך גישה לעסק זה" };
  await db.session.update({ where: { id: session.sessionId }, data: { activeOrgId: orgId } });
  return { ok: true, data: undefined };
}

const pwSchema = z.object({ current: z.string().min(1), next: z.string().min(10).max(200) });

export async function changePasswordAction(input: z.infer<typeof pwSchema>): Promise<ActionResult> {
  const session = await getCurrentSession();
  if (!session) return { ok: false, error: "יש להתחבר מחדש" };
  const parsed = pwSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "הסיסמה החדשה חייבת להכיל לפחות 10 תווים" };
  try {
    await changePassword(session.userId, parsed.data.current, parsed.data.next);
  } catch (err) {
    return toActionError(err);
  }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
