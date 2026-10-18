import { redirect } from "next/navigation";
import { MessagesSquare, ShieldCheck } from "lucide-react";
import { getAppContext } from "@/server/auth/current";
import { LoginForm } from "./login-form";

export const metadata = { title: "התחברות" };

export default async function LoginPage() {
  if (await getAppContext()) redirect("/");
  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <MessagesSquare className="size-6" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">התחברות למערכת</h1>
            <p className="text-sm text-muted-foreground">WhatsApp Campaign Manager — ניהול קמפיינים, הסכמות ותוצאות.</p>
          </div>
          <LoginForm />
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            החיבור מאובטח. ניסיונות כושלים חוזרים יגרמו לנעילה זמנית.
          </p>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-[linear-gradient(135deg,var(--primary),color-mix(in_oklch,var(--primary),black_35%))] lg:block">
        <div className="absolute inset-0 opacity-[0.08] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:22px_22px]" />
        <div className="relative flex h-full flex-col justify-end p-12 text-primary-foreground">
          <blockquote className="max-w-md space-y-4">
            <p className="text-2xl font-medium leading-snug">קמפיינים שמכבדים את הנמענים — הסכמה מתועדת, הסרה מיידית, ותוצאות שאפשר למדוד.</p>
            <ul className="space-y-1.5 text-sm opacity-90">
              <li>• שליחה רק לנמענים עם הסכמה תקפה</li>
              <li>• &quot;הסר&quot; נאכף אוטומטית בכל מספרי העסק</li>
              <li>• מעקב מסירה, קריאה, קליקים ולידים</li>
            </ul>
          </blockquote>
        </div>
      </div>
    </main>
  );
}
