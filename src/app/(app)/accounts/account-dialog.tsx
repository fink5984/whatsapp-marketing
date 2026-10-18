"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { createAccountAction, updateAccountAction } from "./actions";

export function AccountDialog({ account }: { account?: { id: string; name: string; wabaId: string; metaAppId: string | null } }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: account?.name ?? "", wabaId: account?.wabaId ?? "", accessToken: "", metaAppId: account?.metaAppId ?? "", appSecret: "", webhookVerifyToken: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, pending } = useAction();
  const field = (key: keyof typeof f, label: string, opts: { hint?: string; type?: string; ltr?: boolean; disabled?: boolean } = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`acc-${key}`}>{label}</Label>
      <Input
        id={`acc-${key}`}
        type={opts.type ?? "text"}
        dir={opts.ltr ? "ltr" : undefined}
        className={opts.ltr ? "text-start" : undefined}
        value={f[key]}
        disabled={opts.disabled}
        autoComplete="off"
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
        aria-invalid={!!errors[key]}
      />
      {errors[key] ? <p className="text-xs text-destructive">{errors[key]}</p> : opts.hint ? <p className="text-xs text-muted-foreground">{opts.hint}</p> : null}
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {account ? (
          <Button variant="outline" size="sm">
            <Pencil />
            עדכון פרטים
          </Button>
        ) : (
          <Button>
            <Plus />
            חיבור חשבון
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{account ? "עדכון פרטי חשבון" : "חיבור חשבון WhatsApp Business"}</DialogTitle>
          <DialogDescription>{account ? "שדות סודיים ריקים ישאירו את הערך הקיים." : "הפרטים זמינים ב-Meta Business Manager ובאפליקציה ב-Meta for Developers."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {field("name", "שם לתצוגה", { hint: "למשל: לינדר פיננסים — ראשי" })}
          {field("wabaId", "WhatsApp Business Account ID", { ltr: true, hint: "ב-API Setup: \"WhatsApp Business Account ID\" — לא Phone number ID" })}
          {field("accessToken", "Access Token (System User, קבוע)", { type: "password", ltr: true, hint: "הרשאות: whatsapp_business_messaging, whatsapp_business_management" })}
          {field("appSecret", "App Secret", { type: "password", ltr: true, hint: "לאימות חתימת Webhooks. אם ריק — יעשה שימוש ב-META_APP_SECRET של הפלטפורמה." })}
          {field("metaAppId", "Meta App ID", { ltr: true, hint: "נדרש להעלאת קבצי מדיה לתבניות" })}
          {field("webhookVerifyToken", "Webhook Verify Token", { ltr: true, hint: account ? "ריק = ללא שינוי" : "ריק = ייווצר אקראית" })}
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => {
              const payload = Object.fromEntries(Object.entries(f).filter(([k, v]) => v.trim() || k === "metaAppId"));
              run<unknown>(() => (account ? updateAccountAction({ id: account.id, ...payload }) : createAccountAction(payload as typeof f)), {
                success: account ? "נשמר" : "החשבון נוסף — הריצו בדיקת תקינות",
                onSuccess: () => setOpen(false),
                onError: (r) => setErrors(r.fieldErrors ?? {}),
              });
            }}
          >
            {pending ? <Spinner /> : null}
            שמירה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
