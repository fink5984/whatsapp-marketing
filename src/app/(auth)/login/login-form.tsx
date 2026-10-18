"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { loginAction } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, null);
  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="email">דוא״ל</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required dir="ltr" className="text-start" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">סיסמה</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required dir="ltr" className="text-start" />
      </div>
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? <Spinner /> : null}
        התחברות
      </Button>
    </form>
  );
}
