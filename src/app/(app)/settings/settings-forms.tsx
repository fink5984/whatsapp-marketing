"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { saveAlertsAction, saveBusinessAction, saveCostsAction, saveRetentionAction, saveSendingAction, saveUnsubscribeAction } from "./actions";

function Field({ id, label, hint, children }: { id?: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SaveFooter({ canWrite, pending, onSave }: { canWrite: boolean; pending: boolean; onSave: () => void }) {
  if (!canWrite) return <CardFooter className="text-sm text-muted-foreground">צפייה בלבד</CardFooter>;
  return (
    <CardFooter>
      <Button disabled={pending} onClick={onSave}>
        {pending ? <Spinner /> : null}
        שמירה
      </Button>
    </CardFooter>
  );
}

type Business = {
  orgName: string;
  industry: string | null;
  displayName: string;
  legalName: string;
  businessIdNumber: string;
  contactPhone: string;
  contactEmail: string;
  websiteUrl: string;
  privacyPolicyUrl: string;
  logoUrl: string;
  timezone: string;
  defaultWhatsappAccountId: string | null;
};

export function BusinessForm({ initial, canWrite, accounts, financialValue }: { initial: Business; canWrite: boolean; accounts: { id: string; name: string }[]; financialValue: string }) {
  const [f, setF] = useState(initial);
  const { run, pending } = useAction();
  const text = (k: keyof Business, label: string, opts: { hint?: string; ltr?: boolean } = {}) => (
    <Field id={`b-${k}`} label={label} hint={opts.hint}>
      <Input id={`b-${k}`} dir={opts.ltr ? "ltr" : undefined} className={opts.ltr ? "text-start" : undefined} value={(f[k] as string) ?? ""} disabled={!canWrite} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>פרטי העסק</CardTitle>
        <CardDescription>הפרטים משמשים לזיהוי המפרסם בהודעות ולבדיקות התאימות.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {text("orgName", "שם העסק במערכת")}
        <Field label="תחום פעילות">
          <Select value={f.industry ?? "OTHER"} disabled={!canWrite} onValueChange={(v) => setF({ ...f, industry: v === "OTHER" ? null : v })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={financialValue}>שירותים פיננסיים / הלוואות / אשראי</SelectItem>
              <SelectItem value="OTHER">אחר</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {text("displayName", "שם לתצוגה בהודעות", { hint: "יופיע בהודעות אישור ההסרה ובתיעוד ההסכמות" })}
        {text("legalName", "שם משפטי")}
        {text("businessIdNumber", "ח.פ. / ע.מ.")}
        {text("contactPhone", "טלפון ליצירת קשר", { ltr: true })}
        {text("contactEmail", "דוא״ל ליצירת קשר", { ltr: true })}
        {text("websiteUrl", "אתר", { ltr: true })}
        {text("privacyPolicyUrl", "כתובת מדיניות פרטיות", { ltr: true })}
        {text("logoUrl", "כתובת לוגו", { ltr: true })}
        {text("timezone", "אזור זמן", { ltr: true, hint: "לדוגמה Asia/Jerusalem — כל התאריכים מוצגים לפיו" })}
        <Field label="חשבון WhatsApp ברירת מחדל">
          <Select value={f.defaultWhatsappAccountId ?? "__none"} disabled={!canWrite} onValueChange={(v) => setF({ ...f, defaultWhatsappAccountId: v === "__none" ? null : v })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">—</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </CardContent>
      <SaveFooter canWrite={canWrite} pending={pending} onSave={() => run(() => saveBusinessAction(f), { success: "נשמר" })} />
    </Card>
  );
}

type Window = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", [string, string]>>;
const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function SendingForm({
  initial,
  canWrite,
}: {
  initial: { sendingWindow: Window; safetyRollingCap: number; defaultMessagesPerSecond: number; testRecipients: string[]; allowedRedirectDomains: string[]; perContactClickTracking: boolean };
  canWrite: boolean;
}) {
  const [win, setWin] = useState<Window>(initial.sendingWindow);
  const [cap, setCap] = useState(initial.safetyRollingCap);
  const [mps, setMps] = useState(initial.defaultMessagesPerSecond);
  const [tests, setTests] = useState(initial.testRecipients.join("\n"));
  const [domains, setDomains] = useState(initial.allowedRedirectDomains.join("\n"));
  const [perContact, setPerContact] = useState(initial.perContactClickTracking);
  const { run, pending } = useAction();
  return (
    <Card>
      <CardHeader>
        <CardTitle>הגדרות שליחה</CardTitle>
        <CardDescription>ערכים שמרניים מגנים על דירוג האיכות של המספר. המגבלות בפועל נקבעות ע״י Meta.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>שעות שליחה מותרות (לפי אזור הזמן של העסק)</Label>
          <div className="grid gap-2">
            {DAYS.map((d, i) => {
              const k = String(i) as keyof Window;
              const range = win[k];
              return (
                <div key={k} className="flex flex-wrap items-center gap-3">
                  <label className="flex w-24 items-center gap-2 text-sm">
                    <Checkbox
                      checked={!!range}
                      disabled={!canWrite}
                      onCheckedChange={(v) => {
                        const next = { ...win };
                        if (v) next[k] = ["09:00", "20:00"];
                        else delete next[k];
                        setWin(next);
                      }}
                    />
                    {d}
                  </label>
                  {range ? (
                    <div className="flex items-center gap-2">
                      <Input type="time" dir="ltr" className="w-28" value={range[0]} disabled={!canWrite} onChange={(e) => setWin({ ...win, [k]: [e.target.value, range[1]] })} />
                      <span className="text-muted-foreground">עד</span>
                      <Input type="time" dir="ltr" className="w-28" value={range[1]} disabled={!canWrite} onChange={(e) => setWin({ ...win, [k]: [range[0], e.target.value] })} />
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">ללא שליחה</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="s-cap" label="תקרת בטיחות — נמענים ייחודיים ב-24 שעות מתגלגלות" hint="תקרה שמרנית בנוסף למגבלת Meta בפועל (250 / 2,000 / 10,000 / 100,000 / ללא הגבלה). המגבלה מתגלגלת — לא מתאפסת בחצות.">
            <Input id="s-cap" type="number" min={1} value={cap} disabled={!canWrite} onChange={(e) => setCap(Number(e.target.value))} />
          </Field>
          <Field id="s-mps" label="קצב ברירת מחדל (הודעות לשנייה)" hint="ניתן לקבוע קצב ספציפי לכל מספר בעמוד החשבונות">
            <Input id="s-mps" type="number" min={1} max={80} value={mps} disabled={!canWrite} onChange={(e) => setMps(Number(e.target.value))} />
          </Field>
          <Field id="s-tests" label="מספרי בדיקה מורשים" hint="שורה לכל מספר. רק אליהם ניתן לשלוח הודעות בדיקה.">
            <Textarea id="s-tests" dir="ltr" rows={3} value={tests} disabled={!canWrite} onChange={(e) => setTests(e.target.value)} />
          </Field>
          <Field id="s-domains" label="דומיינים מותרים לקישורי מעקב" hint="שורה לכל דומיין (תתי-דומיינים כלולים). ריק = כל דומיין.">
            <Textarea id="s-domains" dir="ltr" rows={3} value={domains} disabled={!canWrite} onChange={(e) => setDomains(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <span>
            <span className="block text-sm font-medium">שיוך קליקים לאיש קשר</span>
            <span className="block text-xs text-muted-foreground">כבוי = מעקב מצטבר בלבד, ללא קישור קליק לאדם מסוים. המזהה בקישור אקראי ואינו כולל מידע אישי.</span>
          </span>
          <Switch checked={perContact} disabled={!canWrite} onCheckedChange={setPerContact} />
        </label>
      </CardContent>
      <SaveFooter
        canWrite={canWrite}
        pending={pending}
        onSave={() =>
          run(
            () =>
              saveSendingAction({
                sendingWindow: win,
                safetyRollingCap: cap,
                defaultMessagesPerSecond: mps,
                testRecipients: tests.split(/\n|,/).map((t) => t.trim()).filter(Boolean),
                allowedRedirectDomains: domains.split(/\n|,/).map((t) => t.trim()).filter(Boolean),
                perContactClickTracking: perContact,
              }),
            { success: "נשמר" },
          )
        }
      />
    </Card>
  );
}

export function UnsubscribeForm({
  initial,
  canWrite,
  isOwner,
}: {
  initial: { unsubscribeFooterText: string; unsubscribeKeywords: string[]; sendUnsubscribeConfirmation: boolean; unsubscribeConfirmationText: string; requireAdvertisingLabel: boolean };
  canWrite: boolean;
  isOwner: boolean;
}) {
  const [f, setF] = useState({ ...initial, keywords: initial.unsubscribeKeywords.join(", "), labelChangeReason: "" });
  const { run, pending } = useAction();
  return (
    <Card>
      <CardHeader>
        <CardTitle>מנגנון הסרה</CardTitle>
        <CardDescription>הסרה מבוצעת אוטומטית ומיידית בכל מספרי העסק. לא ניתן לכבות את המנגנון.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field id="u-footer" label="טקסט הסרה ברירת מחדל לתבניות" hint="עד 60 תווים">
          <Input id="u-footer" maxLength={60} value={f.unsubscribeFooterText} disabled={!canWrite} onChange={(e) => setF({ ...f, unsubscribeFooterText: e.target.value })} />
        </Field>
        <Field id="u-kw" label="מילות הסרה" hint="מופרדות בפסיק. הזיהוי מתעלם מניקוד, רווחים, סימני פיסוק ואותיות סופיות. הודעה קצרה (עד 6 מילים) שמכילה מילה מהרשימה תיחשב בקשת הסרה.">
          <Input id="u-kw" value={f.keywords} disabled={!canWrite} onChange={(e) => setF({ ...f, keywords: e.target.value })} />
        </Field>
        <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <span className="text-sm font-medium">שליחת הודעת אישור לאחר הסרה (בתוך חלון השירות)</span>
          <Switch checked={f.sendUnsubscribeConfirmation} disabled={!canWrite} onCheckedChange={(v) => setF({ ...f, sendUnsubscribeConfirmation: v })} />
        </label>
        {f.sendUnsubscribeConfirmation ? (
          <Field id="u-conf" label="נוסח הודעת האישור">
            <Textarea id="u-conf" rows={2} value={f.unsubscribeConfirmationText} disabled={!canWrite} onChange={(e) => setF({ ...f, unsubscribeConfirmationText: e.target.value })} />
          </Field>
        ) : null}
        <div className="space-y-2 rounded-lg border p-3">
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">חובת המילה &quot;פרסומת&quot; בתבניות שיווקיות</span>
              <span className="block text-xs text-muted-foreground">לפי סעיף 30א לחוק התקשורת. שינוי — בעלים בלבד, עם נימוק מתועד.</span>
            </span>
            <Switch checked={f.requireAdvertisingLabel} disabled={!canWrite || !isOwner} onCheckedChange={(v) => setF({ ...f, requireAdvertisingLabel: v })} />
          </label>
          {!f.requireAdvertisingLabel && initial.requireAdvertisingLabel ? (
            <Textarea rows={2} placeholder="נימוק לביטול הדרישה (יירשם ביומן הביקורת)" value={f.labelChangeReason} onChange={(e) => setF({ ...f, labelChangeReason: e.target.value })} />
          ) : null}
        </div>
      </CardContent>
      <SaveFooter
        canWrite={canWrite}
        pending={pending}
        onSave={() =>
          run(
            () =>
              saveUnsubscribeAction({
                unsubscribeFooterText: f.unsubscribeFooterText,
                unsubscribeKeywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean),
                sendUnsubscribeConfirmation: f.sendUnsubscribeConfirmation,
                unsubscribeConfirmationText: f.unsubscribeConfirmationText,
                requireAdvertisingLabel: f.requireAdvertisingLabel,
                labelChangeReason: f.labelChangeReason || undefined,
              }),
            { success: "נשמר" },
          )
        }
      />
    </Card>
  );
}

export function CostsForm({ initial, canWrite }: { initial: { costCurrency: string; marketing: number | null; utility: number | null }; canWrite: boolean }) {
  const [f, setF] = useState({ costCurrency: initial.costCurrency, marketing: initial.marketing?.toString() ?? "", utility: initial.utility?.toString() ?? "" });
  const { run, pending } = useAction();
  return (
    <Card>
      <CardHeader>
        <CardTitle>תעריפים לאומדן עלות</CardTitle>
        <CardDescription>Meta מחייבת לפי הודעת תבנית שנמסרה, לפי קטגוריה ומדינת הנמען. הזינו את התעריף העדכני לישראל ממחירון Meta. החשבונית של Meta היא המקור הקובע.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <Field id="c-cur" label="מטבע">
          <Input id="c-cur" dir="ltr" maxLength={3} value={f.costCurrency} disabled={!canWrite} onChange={(e) => setF({ ...f, costCurrency: e.target.value.toUpperCase() })} />
        </Field>
        <Field id="c-mkt" label="שיווק — להודעה">
          <Input id="c-mkt" type="number" step="0.0001" min={0} dir="ltr" value={f.marketing} disabled={!canWrite} onChange={(e) => setF({ ...f, marketing: e.target.value })} placeholder="לא הוגדר" />
        </Field>
        <Field id="c-utl" label="שירות (Utility) — להודעה">
          <Input id="c-utl" type="number" step="0.0001" min={0} dir="ltr" value={f.utility} disabled={!canWrite} onChange={(e) => setF({ ...f, utility: e.target.value })} placeholder="לא הוגדר" />
        </Field>
      </CardContent>
      <SaveFooter
        canWrite={canWrite}
        pending={pending}
        onSave={() => run(() => saveCostsAction({ costCurrency: f.costCurrency, marketing: f.marketing === "" ? null : Number(f.marketing), utility: f.utility === "" ? null : Number(f.utility) }), { success: "נשמר" })}
      />
    </Card>
  );
}

export function RetentionForm({ initial, canWrite }: { initial: { retentionInboundDays: number; retentionClicksDays: number; retentionWebhookRawDays: number; retentionAuditDays: number }; canWrite: boolean }) {
  const [f, setF] = useState(initial);
  const { run, pending } = useAction();
  const num = (k: keyof typeof f, label: string, hint: string) => (
    <Field id={`r-${k}`} label={label} hint={hint}>
      <Input id={`r-${k}`} type="number" value={f[k]} disabled={!canWrite} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} />
    </Field>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>מדיניות שמירת מידע</CardTitle>
        <CardDescription>מחיקה אוטומטית מתבצעת ע״י ה-Worker. רשומות הסרה אינן נמחקות לעולם (נשמר גיבוב בלבד) כדי למנוע פנייה חוזרת.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {num("retentionInboundDays", "תוכן הודעות (ימים)", "תוכן הודעות נכנסות ויוצאות יימחק; המטא-דאטה (סטטוסים ותאריכים) נשמרת לדוחות")}
        {num("retentionClicksDays", "אירועי קליקים (ימים)", "")}
        {num("retentionWebhookRawDays", "אירועי Webhook גולמיים (ימים)", "")}
        {num("retentionAuditDays", "יומן ביקורת (ימים)", "מינימום שנה")}
      </CardContent>
      <SaveFooter canWrite={canWrite} pending={pending} onSave={() => run(() => saveRetentionAction(f), { success: "נשמר" })} />
    </Card>
  );
}

export function AlertsForm({ initial, canWrite, pending: pendingBadge }: { initial: { alertEmails: string[]; alertOnQualityDrop: boolean; alertOnSendErrors: boolean }; canWrite: boolean; pending: React.ReactNode }) {
  const [f, setF] = useState({ ...initial, emails: initial.alertEmails.join(", ") });
  const { run, pending } = useAction();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">התראות {pendingBadge}</CardTitle>
        <CardDescription>כבר עכשיו: ירידת איכות מספר משהה אוטומטית קמפיינים פעילים ונרשמת ביומן; שגיאות חשבון מסומנות בעמוד החשבונות ובכותרת המערכת.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>שליחת התראות בדוא״ל תופעל לאחר חיבור ספק דוא״ל (למשל Resend/SMTP). בינתיים ניתן לקבל את האירועים ב-n8n דרך Webhooks יוצאים.</AlertDescription>
        </Alert>
        <Field id="a-emails" label="כתובות להתראות" hint="מופרדות בפסיק">
          <Input id="a-emails" dir="ltr" value={f.emails} disabled={!canWrite} onChange={(e) => setF({ ...f, emails: e.target.value })} />
        </Field>
        <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
          התראה על ירידת איכות חשבון
          <Switch checked={f.alertOnQualityDrop} disabled={!canWrite} onCheckedChange={(v) => setF({ ...f, alertOnQualityDrop: v })} />
        </label>
        <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
          התראה על שגיאות שליחה
          <Switch checked={f.alertOnSendErrors} disabled={!canWrite} onCheckedChange={(v) => setF({ ...f, alertOnSendErrors: v })} />
        </label>
      </CardContent>
      <SaveFooter
        canWrite={canWrite}
        pending={pending}
        onSave={() => run(() => saveAlertsAction({ alertEmails: f.emails.split(",").map((e) => e.trim()).filter(Boolean), alertOnQualityDrop: f.alertOnQualityDrop, alertOnSendErrors: f.alertOnSendErrors }), { success: "נשמר" })}
      />
    </Card>
  );
}
