"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, Info, Send, ShieldCheck, Upload, Users, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { WhatsAppPreview } from "@/components/app/whatsapp-preview";
import { useAction } from "@/hooks/use-action";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TemplateComponent } from "@/lib/templates";
import { previewQuickAction, quickSendAction, uploadHeaderMediaAction } from "../actions";
import { AudiencePicker, EMPTY_AUDIENCE, type AudienceValue } from "./audience-picker";

type Needs = { textSlots: { key: string; label: string }[]; needsLink: boolean; needsMedia: string | null; autoSlots: { key: string; label: string; source: string }[] };
type Preview = {
  ok: boolean;
  items: { key: string; label: string; ok: boolean; level: "error" | "warning"; detail?: string }[];
  audience: { matched: number; eligible: number; excluded: number; reasons: Record<string, number> };
  estimate: { cost: number | null; currency: string; etaText: string; rollingCap: number; rollingCapRemaining: number };
};

const REASONS: Record<string, string> = {
  SUPPRESSED: "ביקשו הסרה — לא יקבלו הודעות שיווקיות",
  CONSENT_REVOKED: "ההסכמה בוטלה",
  NO_CONSENT: "אין הסכמה רשומה — ייבאו אותם עם מקור הסכמה כדי לשלוח אליהם",
  MISSING_VARIABLE: "חסר ערך להודעה",
  OVER_LIMIT: "מעבר לכמות שנבחרה",
};

export function QuickSend({
  phones,
  templates,
  audiences,
  tags,
  sources,
  campaigns,
  canLaunch,
  complianceOk,
  eligibleTotal,
  businessName,
}: {
  phones: { id: string; accountId: string; label: string; connected: boolean; quality: string | null }[];
  templates: { id: string; accountId: string; name: string; category: string; language: string; components: TemplateComponent[]; needs: Needs; optOut: boolean }[];
  audiences: { id: string; name: string; size: number }[];
  tags: { id: string; name: string }[];
  sources: string[];
  campaigns: { id: string; name: string }[];
  canLaunch: boolean;
  complianceOk: boolean;
  eligibleTotal: number;
  businessName: string;
}) {
  const router = useRouter();
  const send = useAction();
  const previewAction = useAction();
  const firstPhone = phones.find((p) => p.connected) ?? phones[0];
  const [phoneId, setPhoneId] = useState(firstPhone?.id ?? "");
  const phone = phones.find((p) => p.id === phoneId);
  const available = templates.filter((t) => t.accountId === phone?.accountId);
  const [templateId, setTemplateId] = useState(available.length === 1 ? available[0].id : "");
  const template = available.find((t) => t.id === templateId);
  const [audience, setAudience] = useState<AudienceValue>(EMPTY_AUDIENCE);
  const [quantity, setQuantity] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [linkUrl, setLinkUrl] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaName, setMediaName] = useState("");
  const [uploading, setUploading] = useState(false);
  const upload = useAction();
  const [advanced, setAdvanced] = useState(false);
  const [name, setName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [respectWindow, setRespectWindow] = useState(true);
  const [previewState, setPreview] = useState<Preview | null>(null);
  // Don't evaluate until the chosen audience mode has its selection.
  const audienceHint = audience.mode === "contacts" && !audience.contacts.length ? "בחרו אנשי קשר מהרשימה" : audience.mode === "group" && !audience.audienceId ? "בחרו קבוצה" : null;
  const ready = !!phoneId && !!templateId && !audienceHint;
  const preview = ready ? previewState : null;

  const input = useMemo(
    () => ({
      phoneNumberId: phoneId,
      templateId,
      audienceMode: audience.mode,
      audienceId: audience.mode === "group" ? audience.audienceId : null,
      conditions: audience.mode === "conditions" ? audience.conditions : undefined,
      contactIds: audience.mode === "contacts" ? audience.contacts.map((c) => c.id) : undefined,
      maxRecipients: quantity ? Number(quantity) : null,
      variables,
      linkUrl: linkUrl.trim() || null,
      headerMediaUrl: mediaUrl.trim() || null,
      name: name.trim() || undefined,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      respectSendingWindow: respectWindow,
    }),
    [phoneId, templateId, audience, quantity, variables, linkUrl, mediaUrl, name, scheduledAt, respectWindow],
  );

  // Debounced live preview — checks run automatically as the form changes.
  const seq = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      previewAction.run(() => previewQuickAction(input), { refresh: false, onSuccess: (p) => my === seq.current && setPreview(p as Preview), onError: () => my === seq.current && setPreview(null) });
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  // Missing inputs are prompted inline by their fields; the red box is for real problems only.
  const INPUT_KEYS = ["link", "variables", "media"];
  const inputMissing = preview?.items.filter((i) => !i.ok && INPUT_KEYS.includes(i.key)) ?? [];
  const noOptOut = !!preview?.items.some((i) => i.key === "optout" && !i.ok);
  const [confirmNoOptOut, setConfirmNoOptOut] = useState(false);
  const doSend = (acknowledgeNoOptOut: boolean) =>
    send.run(() => quickSendAction({ ...input, acknowledgeNoOptOut }), {
      success: (r) => (r.scheduled ? `הקמפיין תוזמן ל-${fmtNumber(r.eligible)} נמענים` : `הקמפיין יצא לדרך — ${fmtNumber(r.eligible)} נמענים`),
      onSuccess: (r) => router.push(`/campaigns/${r.campaignId}`),
    });
  const errors = preview?.items.filter((i) => !i.ok && i.level === "error" && !INPUT_KEYS.includes(i.key)) ?? [];
  const warnings = preview?.items.filter((i) => !i.ok && i.level === "warning" && i.key !== "cap") ?? [];
  const capWarning = preview?.items.find((i) => i.key === "cap" && !i.ok);
  const eligible = preview?.audience.eligible ?? 0;
  const values = Object.fromEntries([...(template?.needs.autoSlots ?? []).map((a) => [a.key.split(".")[1], "דנה"]), ...(template?.needs.textSlots ?? []).map((s) => [s.key.split(".")[1], variables[s.key] || `{{${s.key.split(".")[1]}}}`])]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-4">
        {!complianceOk ? (
          <Alert className="border-warning/40">
            <ShieldCheck />
            <AlertTitle>נדרשת הגדרת תאימות חד-פעמית</AlertTitle>
            <AlertDescription>
              לפני הקמפיין הראשון יש לאשר פעם אחת את מקורות ההסכמה ומדיניות WhatsApp.{" "}
              <Link href="/settings?tab=compliance" className="font-medium underline">
                להשלמה (דקה אחת)
              </Link>
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardContent className="grid gap-5 pt-6 sm:grid-cols-2">
            <Field n={1} label="מספר שולח">
              <Select value={phoneId} onValueChange={(v) => (setPhoneId(v), setTemplateId(""))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="בחירת מספר" />
                </SelectTrigger>
                <SelectContent>
                  {phones.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="ltr">{p.label}</span>
                      {!p.connected ? " (לא מחובר)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field n={2} label="תבנית">
              <Select value={templateId} onValueChange={(v) => (setTemplateId(v), setVariables({}))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={available.length ? "בחירת תבנית מאושרת" : "אין תבניות מאושרות"} />
                </SelectTrigger>
                <SelectContent>
                  {available.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="ltr">{t.name}</span> · {t.category === "MARKETING" ? "שיווק" : "שירות"}
                      {!t.optOut ? <span className="text-[color-mix(in_oklch,var(--warning),black_35%)]"> · ללא אפשרות הסרה</span> : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!available.length ? (
                <p className="text-xs text-muted-foreground">
                  <Link href="/templates" className="underline">
                    סנכרון או יצירת תבנית
                  </Link>
                </p>
              ) : null}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">3</span>
              קהל
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <AudiencePicker value={audience} onChange={setAudience} audiences={audiences} tags={tags} sources={sources} campaigns={campaigns} eligibleTotal={eligibleTotal} />
            <div className="max-w-xs">
              <Field n={4} label="כמות (לא חובה)">
                <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="כל הכשירים" aria-label="כמות נמענים מרבית" />
              </Field>
            </div>
          </CardContent>
        </Card>

        {template && (template.needs.textSlots.length || template.needs.needsLink || template.needs.needsMedia) ? (
          <Card>
            <CardHeader className="pb-0">
              <CardTitle className="text-base">התבנית צריכה עוד פרט{template.needs.textSlots.length + Number(template.needs.needsLink) + Number(!!template.needs.needsMedia) > 1 ? "ים" : ""}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
              {template.needs.textSlots.map((s) => (
                <div key={s.key} className="space-y-1.5">
                  <Label>{s.label}</Label>
                  <Input value={variables[s.key] ?? ""} onChange={(e) => setVariables({ ...variables, [s.key]: e.target.value })} />
                </div>
              ))}
              {template.needs.needsLink ? (
                <div className="space-y-1.5">
                  <Label>לאן יוביל כפתור הקישור?</Label>
                  <Input dir="ltr" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
                  <p className="text-xs text-muted-foreground">כל נמען יקבל קישור מעקב אישי — כך תראו מי הקליק ואיזה קמפיין הביא תוצאות.</p>
                </div>
              ) : null}
              {template.needs.needsMedia ? (
                <div className="space-y-1.5">
                  <Label>{template.needs.needsMedia === "IMAGE" ? "תמונה לכותרת ההודעה" : template.needs.needsMedia === "VIDEO" ? "וידאו לכותרת ההודעה" : "מסמך לכותרת ההודעה"}</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className={cn("inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted", uploading && "pointer-events-none opacity-60")}>
                      {uploading ? <Spinner /> : <Upload className="size-4" />}
                      {mediaUrl.startsWith("media:") ? "החלפת קובץ" : "העלאת קובץ"}
                      <input
                        type="file"
                        className="sr-only"
                        accept={template.needs.needsMedia === "IMAGE" ? "image/jpeg,image/png" : template.needs.needsMedia === "VIDEO" ? "video/mp4,video/3gpp" : "application/pdf"}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const fd = new FormData();
                          fd.set("file", f);
                          fd.set("phoneNumberId", phoneId);
                          fd.set("format", template.needs.needsMedia!);
                          setUploading(true);
                          upload.run(() => uploadHeaderMediaAction(fd), { refresh: false, success: "הקובץ הועלה", onSuccess: (ref) => (setMediaUrl(ref), setMediaName(f.name)) }).finally(() => setUploading(false));
                        }}
                      />
                    </label>
                    {mediaUrl.startsWith("media:") ? <span className="text-xs text-success">✓ {mediaName || "קובץ הועלה"}</span> : null}
                  </div>
                  {!mediaUrl.startsWith("media:") ? <Input dir="ltr" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="או כתובת קובץ ציבורית https://…" /> : null}
                </div>
              ) : null}
              {template.needs.autoSlots.map((a) => (
                <p key={a.key} className="text-xs text-muted-foreground sm:col-span-2">
                  {a.label}: {a.source} — אוטומטי
                </p>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <div>
          <button type="button" onClick={() => setAdvanced(!advanced)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("size-4 transition-transform", advanced && "rotate-180")} />
            אפשרויות נוספות (שם, תזמון, שעות שליחה)
          </button>
          {advanced ? (
            <Card className="mt-2">
              <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="q-name">שם הקמפיין</Label>
                  <Input id="q-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={template ? `${template.name} · היום` : ""} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="q-when">תזמון (ריק = עכשיו)</Label>
                  <Input id="q-when" type="datetime-local" dir="ltr" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
                </div>
                <label className="flex items-center justify-between gap-4 rounded-lg border p-3 sm:col-span-2">
                  <span>
                    <span className="block text-sm font-medium">שליחה רק בשעות המותרות</span>
                    <span className="block text-xs text-muted-foreground">מחוץ לשעות — ההודעות ימתינו ויישלחו אוטומטית כשהחלון ייפתח</span>
                  </span>
                  <Switch checked={respectWindow} onCheckedChange={setRespectWindow} />
                </label>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {errors.length ? (
          <Alert variant="destructive">
            <XCircle />
            <AlertTitle>צריך לטפל לפני שליחה</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 space-y-1">
                {errors.map((e) => (
                  <li key={e.key}>
                    <span className="font-medium">{e.label}</span>
                    {e.detail ? <span className="block opacity-90">{e.detail}</span> : null}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        {warnings.length || capWarning ? (
          <Alert className="border-warning/40">
            <AlertTriangle />
            <AlertTitle>לתשומת לבך</AlertTitle>
            <AlertDescription>
              <ul className="mt-1 space-y-1">
                {[...warnings, ...(capWarning ? [capWarning] : [])].map((w) => (
                  <li key={w.key}>{w.detail ?? w.label}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <Card className="border-primary/30">
          <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5 text-sm">
              {preview ? (
                <>
                  <div className="text-base font-semibold">
                    {fmtNumber(eligible)} נמענים יקבלו את ההודעה
                    {previewAction.pending ? <Spinner className="ms-2 inline" /> : null}
                  </div>
                  <div className="text-muted-foreground">
                    {preview.estimate.cost !== null ? `עלות משוערת ${fmtMoney(preview.estimate.cost, preview.estimate.currency)} · ` : ""}
                    {preview.estimate.etaText}
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">{previewAction.pending ? "מחשב נמענים…" : (audienceHint ?? "בחרו מספר ותבנית כדי לראות כמה יקבלו את ההודעה")}</div>
              )}
            </div>
            <Button
              size="lg"
              className="min-w-48"
              disabled={!canLaunch || send.pending || previewAction.pending || !preview?.ok || eligible === 0}
              onClick={() => (noOptOut ? setConfirmNoOptOut(true) : doSend(false))}
            >
              {send.pending ? <Spinner /> : <Send />}
              {scheduledAt ? "תזמון שליחה" : `שליחה${eligible ? ` ל-${fmtNumber(eligible)}` : ""}`}
            </Button>
          </CardContent>
          {inputMissing.length ? <p className="px-6 pb-4 text-xs text-muted-foreground">כדי לשלוח: {inputMissing.map((i) => i.label.replace(/^יש /, "")).join(" · ")}</p> : null}
          {!canLaunch ? <p className="px-6 pb-4 text-xs text-muted-foreground">אין לך הרשאת שליחה — פנה/י למנהל קמפיינים או מנהל מערכת.</p> : null}
        </Card>
      </div>

      <AlertDialog open={confirmNoOptOut} onOpenChange={setConfirmNoOptOut}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-warning" />
              ההודעה אינה כוללת אפשרות הסרה
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>בתבנית שנבחרה אין שורת הסרה או כפתור הסרה, כך שהנמענים לא יידעו איך לבקש להפסיק לקבל הודעות.</p>
                <p>חוק התקשורת (סעיף 30א) מחייב אפשרות סירוב בכל הודעה פרסומית. שליחה בלעדיה חושפת את העסק לפיצוי של עד ₪1,000 לכל הודעה — כאן {fmtNumber(eligible)} הודעות.</p>
                <p>תגובת &quot;הסר&quot; תמשיך להיאכף אוטומטית. האישור שלך יירשם ביומן הביקורת.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>חזרה לבחירת תבנית</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" disabled={send.pending} onClick={(e) => { e.preventDefault(); setConfirmNoOptOut(false); doSend(true); }}>
                שליחה בכל זאת
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        {template ? (
          <WhatsAppPreview components={template.components} values={values} businessName={businessName} />
        ) : (
          <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">תצוגה מקדימה תופיע כאן</div>
        )}
        {preview && preview.audience.matched > 0 ? (
          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Users className="size-4" />
                מי יקבל ומי לא
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">בקהל שנבחר</span>
                <span className="tabular">{fmtNumber(preview.audience.matched)}</span>
              </div>
              <div className="flex justify-between font-medium text-primary">
                <span>יקבלו</span>
                <span className="tabular">{fmtNumber(eligible)}</span>
              </div>
              {Object.entries(preview.audience.reasons).map(([r, n]) => (
                <div key={r} className="flex justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">{REASONS[r] ?? r}</span>
                  <span className="tabular">{fmtNumber(n)}</span>
                </div>
              ))}
              <p className="flex items-start gap-1.5 border-t pt-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                מי שביקש הסרה לא יקבל הודעות מאף מספר של העסק, והבדיקה חוזרת רגע לפני כל הודעה.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </aside>
    </div>
  );
}

function Field({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">{n}</span>
        {label}
      </Label>
      {children}
    </div>
  );
}
