"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Copy, Eye, EyeOff, RefreshCw, Stethoscope, Trash2, Webhook, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ActionButton, ConfirmAction } from "@/components/app/confirm";
import { useAction } from "@/hooks/use-action";
import { AccountDialog } from "./account-dialog";
import { deleteAccountAction, healthCheckAction, phoneOptionsAction, subscribeWebhooksAction, syncTemplatesAction } from "./actions";

type Health = { ok: boolean; checks: { key: string; label: string; ok: boolean; detail?: string }[] };

export function AccountToolbar({ account }: { account: { id: string; name: string; wabaId: string; metaAppId: string | null } }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [health, setHealth] = useState<Health | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={pending} onClick={() => run(() => healthCheckAction({ id: account.id }), { refresh: false, onSuccess: setHealth })}>
        {pending ? <Spinner /> : <Stethoscope />}
        בדיקת תקינות
      </Button>
      <ActionButton size="sm" variant="outline" action={() => subscribeWebhooksAction({ id: account.id })} success="האפליקציה נרשמה ל-Webhooks של החשבון">
        <Webhook />
        רישום ל-Webhooks
      </ActionButton>
      <ActionButton size="sm" variant="outline" action={() => syncTemplatesAction({ accountId: account.id })} success="התבניות סונכרנו">
        <RefreshCw />
        סנכרון תבניות
      </ActionButton>
      <AccountDialog account={account} />
      <ConfirmAction
        trigger={
          <Button size="sm" variant="ghost" aria-label="ניתוק חשבון">
            <Trash2 />
          </Button>
        }
        title={`ניתוק "${account.name}"`}
        description="פרטי החשבון, המספרים והתבניות המקומיות יימחקו מהמערכת. היסטוריית הקמפיינים תישמר. החשבון ב-Meta אינו מושפע."
        destructive
        typeToConfirm="נתק"
        confirmLabel="ניתוק"
        action={() => deleteAccountAction({ id: account.id })}
        success="החשבון נותק"
      />
      <Dialog open={!!health} onOpenChange={(o) => { if (!o) { setHealth(null); router.refresh(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {health?.ok ? <CheckCircle2 className="size-5 text-success" /> : <XCircle className="size-5 text-destructive" />}
              {health?.ok ? "החיבור תקין" : "נמצאו בעיות בחיבור"}
            </DialogTitle>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {health?.checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2">
                {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
                <span>
                  <span className="font-medium">{c.label}</span>
                  {c.detail ? <span className="block text-muted-foreground">{c.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!secret);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-1">
        <Input readOnly dir="ltr" className="text-start font-mono text-xs" value={shown ? value : "•".repeat(Math.min(24, value.length))} />
        {secret ? (
          <Button type="button" size="icon" variant="outline" onClick={() => setShown(!shown)} aria-label={shown ? "הסתרה" : "הצגה"}>
            {shown ? <EyeOff /> : <Eye />}
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="העתקה"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

export function PhoneOptions({ phone }: { phone: { id: string; isDefault: boolean; mps: number | null } }) {
  const { run, pending } = useAction();
  const [mps, setMps] = useState(phone.mps?.toString() ?? "");
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={1}
        max={80}
        className="h-7 w-20"
        placeholder="ברירת מחדל"
        value={mps}
        onChange={(e) => setMps(e.target.value)}
        onBlur={() => {
          const v = mps ? Number(mps) : null;
          if (v !== phone.mps) run(() => phoneOptionsAction({ id: phone.id, messagesPerSecond: v }), { success: "קצב השליחה עודכן" });
        }}
        aria-label="הודעות לשנייה"
      />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Switch checked={phone.isDefault} disabled={pending || phone.isDefault} onCheckedChange={() => run(() => phoneOptionsAction({ id: phone.id, isDefault: true }))} />
        ברירת מחדל
      </label>
    </div>
  );
}
