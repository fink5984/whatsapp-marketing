"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { WhatsAppPreview } from "@/components/app/whatsapp-preview";
import { useAction } from "@/hooks/use-action";
import { ADVERTISING_LABEL, TEMPLATE_LIMITS, extractVars, validateTemplate, type HeaderFormat, type TemplateButton, type TemplateComponent } from "@/lib/templates";
import { saveTemplateAction } from "./actions";

type Initial = { id?: string; accountId: string; name: string; language: string; category: "MARKETING" | "UTILITY"; components: TemplateComponent[] };

const LANGS = [
  ["he", "עברית"],
  ["en_US", "English (US)"],
  ["ar", "العربية"],
  ["ru", "Русский"],
];

export function TemplateEditor({ accounts, initial, unsubscribeText, businessName }: { accounts: { id: string; name: string }[]; initial?: Initial; unsubscribeText: string; businessName: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const initHeader = initial?.components.find((c) => c.type === "HEADER") as Extract<TemplateComponent, { type: "HEADER" }> | undefined;
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [language, setLanguage] = useState(initial?.language ?? "he");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">(initial?.category ?? "MARKETING");
  const [headerFormat, setHeaderFormat] = useState<"NONE" | HeaderFormat>(initHeader?.format ?? "NONE");
  const [headerText, setHeaderText] = useState(initHeader?.text ?? "");
  const [body, setBody] = useState((initial?.components.find((c) => c.type === "BODY") as { text: string } | undefined)?.text ?? `${ADVERTISING_LABEL}: `);
  const [footer, setFooter] = useState((initial?.components.find((c) => c.type === "FOOTER") as { text: string } | undefined)?.text ?? unsubscribeText);
  const [buttons, setButtons] = useState<TemplateButton[]>((initial?.components.find((c) => c.type === "BUTTONS") as { buttons: TemplateButton[] } | undefined)?.buttons ?? []);
  const [samples, setSamples] = useState<Record<string, string>>({});

  const components = useMemo<TemplateComponent[]>(() => {
    const out: TemplateComponent[] = [];
    const sampleList = (text: string) => extractVars(text).map((v) => samples[v] || `דוגמה ${v}`);
    if (headerFormat === "TEXT") out.push({ type: "HEADER", format: "TEXT", text: headerText, ...(extractVars(headerText).length ? { example: { header_text: sampleList(headerText) } } : {}) });
    else if (headerFormat !== "NONE") out.push({ type: "HEADER", format: headerFormat });
    out.push({ type: "BODY", text: body, ...(extractVars(body).length ? { example: { body_text: [[...new Set(extractVars(body))].map((v) => samples[v] || `דוגמה ${v}`)] } } : {}) });
    if (footer.trim()) out.push({ type: "FOOTER", text: footer });
    if (buttons.length)
      out.push({
        type: "BUTTONS",
        buttons: buttons.map((b) => (b.type === "URL" && extractVars(b.url).length ? { ...b, example: [b.url.replace(/\{\{[^}]+\}\}/, "abc123")] } : b)),
      });
    return out;
  }, [headerFormat, headerText, body, footer, buttons, samples]);

  const issues = validateTemplate({ name, category, components });
  const errors = issues.filter((i) => i.level === "error");
  const vars = [...new Set([...extractVars(headerFormat === "TEXT" ? headerText : ""), ...extractVars(body)])];
  const addVar = () => setBody((b) => `${b}{{${vars.filter((v) => /^\d+$/.test(v)).length + 1}}}`);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>פרטי תבנית</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="t-name">שם (באנגלית)</Label>
              <Input id="t-name" dir="ltr" className="text-start" value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="loan_offer_oct" disabled={!!initial?.id} />
            </div>
            <div className="space-y-1.5">
              <Label>חשבון</Label>
              <Select value={accountId} onValueChange={setAccountId} disabled={!!initial?.id}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>קטגוריה</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as "MARKETING" | "UTILITY")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MARKETING">שיווק (Marketing)</SelectItem>
                  <SelectItem value="UTILITY">שירות / עדכון לעסקה קיימת (Utility)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">הצעות, מבצעים וקידום מכירות = שיווק. Meta עשויה לשנות קטגוריה שהוגדרה שגוי.</p>
            </div>
            <div className="space-y-1.5">
              <Label>שפה</Label>
              <Select value={language} onValueChange={setLanguage} disabled={!!initial?.id}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGS.map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>תוכן</CardTitle>
            <CardDescription>עיצוב: *מודגש* _נטוי_ ~קו חוצה~. משתנים: {"{{1}}"}, {"{{2}}"} — יוחלפו בערכים לכל נמען בעת השליחה.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <div className="space-y-1.5">
                <Label>כותרת</Label>
                <Select value={headerFormat} onValueChange={(v) => setHeaderFormat(v as "NONE" | HeaderFormat)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">ללא</SelectItem>
                    <SelectItem value="TEXT">טקסט</SelectItem>
                    <SelectItem value="IMAGE">תמונה</SelectItem>
                    <SelectItem value="VIDEO">וידאו</SelectItem>
                    <SelectItem value="DOCUMENT">מסמך (PDF)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {headerFormat === "TEXT" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="t-header">טקסט כותרת ({headerText.length}/{TEMPLATE_LIMITS.headerTextMax})</Label>
                  <Input id="t-header" maxLength={TEMPLATE_LIMITS.headerTextMax} value={headerText} onChange={(e) => setHeaderText(e.target.value)} />
                </div>
              ) : headerFormat !== "NONE" ? (
                <p className="self-end text-sm text-muted-foreground">
                  קובץ לדוגמה יידרש בשליחה לאישור (עד {TEMPLATE_LIMITS.mediaMaxMb[headerFormat]}MB, {TEMPLATE_LIMITS.mediaTypes[headerFormat].join(", ")}). בכל קמפיין תוזן כתובת הקובץ בפועל.
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="t-body">
                  גוף ההודעה ({body.length}/{TEMPLATE_LIMITS.bodyMax})
                </Label>
                <Button type="button" variant="ghost" size="xs" onClick={addVar}>
                  <Plus />
                  הוספת משתנה
                </Button>
              </div>
              <Textarea id="t-body" rows={7} maxLength={TEMPLATE_LIMITS.bodyMax} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            {vars.length ? (
              <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                <p className="text-xs text-muted-foreground sm:col-span-2">ערכי דוגמה (נשלחים ל-Meta לצורך הבדיקה, ומוצגים בתצוגה המקדימה)</p>
                {vars.map((v) => (
                  <div key={v} className="flex items-center gap-2">
                    <span className="ltr w-14 shrink-0 text-xs text-muted-foreground">{`{{${v}}}`}</span>
                    <Input value={samples[v] ?? ""} onChange={(e) => setSamples({ ...samples, [v]: e.target.value })} placeholder={v === "1" ? "דנה" : "ערך לדוגמה"} />
                  </div>
                ))}
              </div>
            ) : null}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="t-footer">
                  Footer ({footer.length}/{TEMPLATE_LIMITS.footerMax})
                </Label>
                {footer !== unsubscribeText ? (
                  <Button type="button" variant="ghost" size="xs" onClick={() => setFooter(unsubscribeText)}>
                    הוספת שורת הסרה
                  </Button>
                ) : null}
              </div>
              <Input id="t-footer" maxLength={TEMPLATE_LIMITS.footerMax} value={footer} onChange={(e) => setFooter(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>כפתורים</CardTitle>
            <CardDescription>
              עד {TEMPLATE_LIMITS.buttonsMax} כפתורים, מתוכם עד {TEMPLATE_LIMITS.urlButtonsMax} קישורים ו-{TEMPLATE_LIMITS.phoneButtonsMax} טלפון. למעקב קליקים לכל נמען השתמשו בכתובת עם משתנה בסוף, לדוגמה: https://track.example.com/r/{"{{1}}"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {buttons.map((b, i) => (
              <div key={i} className="grid items-end gap-2 rounded-lg border p-3 sm:grid-cols-[140px_1fr_1fr_auto]">
                <div className="space-y-1.5">
                  <Label>סוג</Label>
                  <Select
                    value={b.type}
                    onValueChange={(v) =>
                      setButtons(buttons.map((x, j) => (j === i ? (v === "URL" ? { type: "URL", text: x.text, url: "https://" } : v === "PHONE_NUMBER" ? { type: "PHONE_NUMBER", text: x.text, phone_number: "+972" } : { type: "QUICK_REPLY", text: x.text }) : x)))
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="QUICK_REPLY">תגובה מהירה</SelectItem>
                      <SelectItem value="URL">קישור</SelectItem>
                      <SelectItem value="PHONE_NUMBER">חיוג</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>טקסט ({b.text.length}/25)</Label>
                  <Input maxLength={25} value={b.text} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                </div>
                <div className="space-y-1.5">
                  {b.type === "URL" ? (
                    <>
                      <Label>כתובת</Label>
                      <Input dir="ltr" className="text-start" value={b.url} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } as TemplateButton : x)))} />
                    </>
                  ) : b.type === "PHONE_NUMBER" ? (
                    <>
                      <Label>מספר</Label>
                      <Input dir="ltr" className="text-start" value={b.phone_number} onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, phone_number: e.target.value } as TemplateButton : x)))} />
                    </>
                  ) : null}
                </div>
                <Button type="button" variant="ghost" size="icon" aria-label="הסרת כפתור" onClick={() => setButtons(buttons.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={buttons.length >= TEMPLATE_LIMITS.buttonsMax} onClick={() => setButtons([...buttons, { type: "QUICK_REPLY", text: "" }])}>
                <Plus />
                כפתור
              </Button>
              {!buttons.some((b) => b.type === "QUICK_REPLY" && /הסר/.test(b.text)) ? (
                <Button type="button" variant="outline" size="sm" disabled={buttons.length >= TEMPLATE_LIMITS.buttonsMax} onClick={() => setButtons([...buttons, { type: "QUICK_REPLY", text: "הסרה מרשימת התפוצה" }])}>
                  <Plus />
                  כפתור הסרה
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <WhatsAppPreview components={components} values={Object.fromEntries(vars.map((v) => [v, samples[v] || `{{${v}}}`]))} businessName={businessName} />
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="text-sm">בדיקת תקינות</CardTitle>
          </CardHeader>
          <CardContent>
            {issues.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" />
                התבנית עומדת בכללים המקומיים
              </p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {issues.map((i, k) => (
                  <li key={k} className="flex items-start gap-2">
                    {i.level === "error" ? <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />}
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Button
          className="w-full"
          size="lg"
          disabled={pending || errors.length > 0 || !accountId}
          onClick={() =>
            run(() => saveTemplateAction({ id: initial?.id, accountId, name, language, category, components: components as never }), {
              success: "הטיוטה נשמרה",
              onSuccess: (id) => router.push(`/templates/${id}`),
            })
          }
        >
          {pending ? <Spinner /> : null}
          שמירת טיוטה
        </Button>
        <p className="text-center text-xs text-muted-foreground">לאחר השמירה ניתן לשלוח את התבנית לאישור Meta.</p>
      </div>
    </div>
  );
}
