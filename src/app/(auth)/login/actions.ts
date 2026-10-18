"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { login, SESSION_COOKIE, SESSION_IDLE_MS } from "@/server/auth/sessions";

const schema = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) });

export async function loginAction(_prev: { error?: string } | null, formData: FormData): Promise<{ error?: string } | null> {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "יש להזין דוא״ל וסיסמה תקינים" };
  const h = await headers();
  const res = await login(parsed.data.email, parsed.data.password, {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });
  if (!res.ok) return { error: res.error };
  (await cookies()).set(SESSION_COOKIE, res.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_IDLE_MS / 1000),
  });
  redirect("/");
}
