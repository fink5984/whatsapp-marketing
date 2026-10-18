"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, FlaskConical, Link2, Rocket, Users, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Pill, PhoneQualityBadge } from "@/components/app/badges";
import { WhatsAppPreview } from "@/components/app/whatsapp-preview";
import { useAction } from "@/hooks/use-action";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TemplateComponent } from "@/lib/templates";
import { createCampaignAction, createLinkAction, launchCampaignAction, preflightAction, previewAudienceAction, testCampaignAction, updateCampaignAction } from "./actions";

export type WizardData = {
  accounts: { id: string; name: string; status: string; phones: { id: string; display: string; status: string; quality: string | null; isDefault: boolean }[] }[];
  templates: { id: string; accountId: string; name: string; language: string; category: string; components: TemplateComponent[]; slots: { key: string; label: string; component: string; name: string }[]; media: string | null; compliant: boolean }[];
  audiences: { id: string; name: string; size: number; kind: string }[];
  tags: { id: string; name: string }[];
  sources: string[];
  campaigns: { id: string; name: string }[];
  links: { id: string; name: string; url: string; destination: string }[];
  trackingBase: string;
  testRecipients: string[];
  businessName: string;
  timezone: string;
  canLaunch: boolean;
};

type VarSource =
  | { type: "contact_field"; field: "name" | "first_name" | "phone"; fallback?: string }
  | { type: "attribute"; key: string; fallback?: string }
  | { type: "static"; value: string }
  | { type: "tracked_link" };

type Filter = { audienceIds?: string[]; tagIds?: string[]; tagMode?: "any" | "all"; excludeTagIds?: string[]; sources?: string[]; activity?: "never_sent" | "sent" | "delivered" | "read" | "clicked" | "replied" | "not_replied"; notSentForDays?: number; excludeCampaignIds?: string[] };

export type CampaignDraft = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  accountId: string | null;
  phoneNumberId: string | null;
  templateId: string | null;
  audienceFilter: Filter;
  variableMapping: Record<string, VarSource>;
  headerMediaUrl: string | null;
  trackedLinkId: string | null;
  scheduledAt: string | null;
  maxRecipients: number | null;
  messagesPerSecond: number | null;
  respectSendingWindow: boolean;
};

type Audience = { matched: number; eligible: number; excluded: number; reasons: Record<string, number> };
type PreflightResult = {
  ok: boolean;
  items: { key: string; label: string; ok: boolean; level: "error" | "warning"; detail?: string }[];
  audience: Audience;
  estimate: { cost: number | null; currency: string; rate: number | null; etaText: string; rollingCapRemaining: number; rollingCap: number };
};

const STEPS = ["פרטי קמפיין", "בחירת קהל", "תוכן והגדרות שליחה", "אישור סופי"];
const EXCLUSION_LABELS: Record<string, string> = {
  SUPPRESSED: "ביקשו הסרה",
  CONSENT_REVOKED: "הסכמה בוטלה",
  NO_CONSENT: "אין הסכמה מתועדת",
  MISSING_VARIABLE: "חסר ערך למשתנה",
  OVER_LIMIT: "מעבר לכמות המרבית",
};

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function CampaignWizard({ data, draft, initialStep = 0 }: { data: WizardData; draft?: CampaignDraft; initialStep?: number }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [step, setStep] = useState(draft ? initialStep : 0);
  const defaultAccount = data.accounts.find((a) => a.status === "CONNECTED") ?? data.accounts[0];
  const [c, setC] = useState<Omit<CampaignDraft, "id">>(
    draft ?? {
      name: "",
      description: "",
      tags: [],
      accountId: defaultAccount?.id ?? null,
      phoneNumberId: defaultAccount?.phones.find((p) => p.isDefault)?.id ?? defaultAccount?.phones[0]?.id ?? null,
      templateId: null,
      audienceFilter: {},
      variableMapping: {},
      headerMediaUrl: null,
      trackedLinkId: null,
      scheduledAt: null,
      maxRecipients: null,
      messagesPerSecond: null,
      respectSendingWindow: true,
    },
  );
  const [audience, setAudience] = useState<Audience | null>(null);
  const [pf, setPf] = useState<PreflightResult | null>(null);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">(draft?.scheduledAt ? "later" : "now");
  const [newLink, setNewLink] = useState({ name: "", destinationUrl: "" });
  const [testPhone, setTestPhone] = useState(data.testRecipients[0] ?? "");

  const account = data.accounts.find((a) => a.id === c.accountId);
  const template = data.templates.find((t) => t.id === c.templateId);
  const templatesForAccount = data.templates.filter((t) => t.accountId === c.accountId);
  const filter = c.audienceFilter;
  const setFilter = (f: Filter) => setC({ ...c, audienceFilter: f });
  const toggle = (key: "audienceIds" | "tagIds" | "excludeTagIds" | "sources" | "excludeCampaignIds", v: string) => {
    const cur = filter[key] ?? [];
    setFilter({ ...filter, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };

  // Picking a template pre-fills sensible variable defaults (keeps any existing mapping).
  const selectTemplate = (id: string) => {
    const t = data.templates.find((x) => x.id === id);
    const next: Record<string, VarSource> = {};
    for (const sl of t?.slots ?? []) {
      next[sl.key] = c.variableMapping[sl.key] ?? (sl.component === "button" ? { type: "tracked_link" } : sl.name === "1" ? { type: "contact_field", field: "first_name", fallback: "לקוח/ה" } : { type: "static", value: "" });
    }
    setC({ ...c, templateId: id, variableMapping: next });
  };

  const payload = () => ({
    ...c,
    description: c.description || null,
    scheduledAt: scheduleMode === "later" && c.scheduledAt ? new Date(c.scheduledAt) : null,
    headerMediaUrl: c.headerMediaUrl || null,
    variableMapping: Object.fromEntries(Object.entries(c.variableMapping).filter(([, v]) => !(v.type === "static" && !v.value))),
  });

  const save = (nextStep: number, after?: () => void) => {
    if (!draft) {
      run(() => createCampaignAction(payload() as never), { refresh: false, success: "טיוטת הקמפיין נשמרה", onSuccess: (id) => router.replace(`/campaigns/${id}/setup?step=${nextStep}`) });
      return;
    }
    run(() => updateCampaignAction({ id: draft.id, ...(payload() as object) } as Parameters<typeof updateCampaignAction>[0]), {
      refresh: false,
      onSuccess: () => {
        setStep(nextStep);
        after?.();
        window.scrollTo({ top: 0, behavior: "smooth" });
      },
    });
  };

  const loadAudience = () => draft && run(() => previewAudienceAction({ id: draft.id }), { refresh: false, onSuccess: setAudience });
  const loadPreflight = () => draft && run(() => preflightAction({ id: draft.id }), { refresh: false, onSuccess: (r) => setPf(r) });

  useEffect(() => {
    if (step === 1 && draft) loadAudience();
    if (step === 3 && draft) loadPreflight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const previewValues = Object.fromEntries(
    (template?.slots ?? [])
      .filter((s) => s.component !== "button")
      .map((s) => {
        const m = c.variableMapping[s.key];
        const v = !m ? "" : m.type === "static" ? m.value : m.type === "contact_field" ? (m.field === "phone" ? "+972501234567" : m.field === "first_name" ? "דנה" : "דנה כהן") : m.type === "attribute" ? `[${m.key}]` : `${data.trackingBase}/r/…`;
        return [s.name, v || `{{${s.name}}}`];
      }),
  );

  const step0Valid = c.name.trim() && c.accountId && c.phoneNumberId && c.templateId;
  return (
    <div className="space-y-6">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              disabled={!draft || i > step}
              onClick={() => setStep(i)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-start text-sm transition-colors",
                i === step ? "border-primary bg-accent/50 font-medium" : i < step ? "border-transparent bg-muted/60 hover:bg-muted" : "border-dashed text-muted-foreground",
              )}
            >
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs", i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-primary/15 text-primary" : "bg-muted")}>
                {i < step ? <Check className="size-3.5" /> : i + 1}
              </span>
              {s}
            </button>
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          {step === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>פרטי קמפיין</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="w-name">שם הקמפיין *</Label>
                    <Input id="w-name" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="הצעת הלוואה — אוקטובר" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="w-tags">תגיות פנימיות</Label>
                    <Input id="w-tags" value={c.tags.join(", ")} onChange={(e) => setC({ ...c, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} placeholder="מופרדות בפסיק" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="w-desc">תיאור פנימי</Label>
                  <Textarea id="w-desc" rows={2} value={c.description ?? ""} onChange={(e) => setC({ ...c, description: e.target.value })} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>חשבון WhatsApp *</Label>
                    <Select
                      value={c.accountId ?? ""}
                      onValueChange={(v) => {
                        const a = data.accounts.find((x) => x.id === v);
                        setC({ ...c, accountId: v, phoneNumberId: a?.phones.find((p) => p.isDefault)?.id ?? a?.phones[0]?.id ?? null, templateId: null });
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="בחירת חשבון" />
                      </SelectTrigger>
                      <SelectContent>
                        {data.accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name} {a.status !== "CONNECTED" ? "(לא מחובר)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>מספר שולח *</Label>
                    <Select value={c.phoneNumberId ?? ""} onValueChange={(v) => setC({ ...c, phoneNumberId: v })}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="בחירת מספר" />
                      </SelectTrigger>
                      <SelectContent>
                        {account?.phones.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            <span className="ltr">{p.display}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {account?.phones.find((p) => p.id === c.phoneNumberId) ? <PhoneQualityBadge rating={account.phones.find((p) => p.id === c.phoneNumberId)!.quality} /> : null}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>תבנית מאושרת *</Label>
                  {templatesForAccount.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">אין תבניות מאושרות לחשבון זה. סנכרנו או צרו תבנית בעמוד התבניות.</p>
                  ) : (
                    <RadioGroup value={c.templateId ?? ""} onValueChange={selectTemplate} className="grid gap-2 sm:grid-cols-2">
                      {templatesForAccount.map((t) => (
                        <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/40">
                          <RadioGroupItem value={t.id} className="mt-0.5" />
                          <span className="min-w-0 space-y-1">
                            <span className="ltr block truncate text-sm font-medium">{t.name}</span>
                            <span className="flex flex-wrap gap-1">
                              <Pill tone="muted">{t.category === "MARKETING" ? "שיווק" : "שירות"}</Pill>
                              <Pill tone="muted">{t.language}</Pill>
                              {!t.compliant ? <Pill tone="danger">חסרה הסרה/&quot;פרסומת&quot;</Pill> : null}
                            </span>
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  )}
                </div>
              </CardContent>
              <CardFooter className="justify-end">
                <Button disabled={pending || !step0Valid} onClick={() => save(1)}>
                  {pending ? <Spinner /> : null}
                  המשך לבחירת קהל
                  <ChevronLeft />
                </Button>
              </CardFooter>
            </Card>
          ) : null}

          {step === 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>בחירת קהל</CardTitle>
                <CardDescription>ללא בחירה — כל אנשי הקשר. אנשים שביקשו הסרה או ללא הסכמה מתועדת מוצאים תמיד, גם אם נבחרו.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {data.audiences.length ? (
                  <FilterGroup label="קבוצות וקהלים">
                    {data.audiences.map((a) => (
                      <Check2 key={a.id} checked={filter.audienceIds?.includes(a.id)} onChange={() => toggle("audienceIds", a.id)}>
                        {a.name} <span className="text-muted-foreground">({fmtNumber(a.size)})</span>
                      </Check2>
                    ))}
                  </FilterGroup>
                ) : null}
                {data.tags.length ? (
                  <>
                    <FilterGroup
                      label="כולל תגיות"
                      extra={
                        <Select value={filter.tagMode ?? "any"} onValueChange={(v) => setFilter({ ...filter, tagMode: v as "any" | "all" })}>
                          <SelectTrigger size="sm" className="w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="any">אחת מהן</SelectItem>
                            <SelectItem value="all">כולן</SelectItem>
                          </SelectContent>
                        </Select>
                      }
                    >
                      {data.tags.map((t) => (
                        <Check2 key={t.id} checked={filter.tagIds?.includes(t.id)} onChange={() => toggle("tagIds", t.id)}>
                          {t.name}
                        </Check2>
                      ))}
                    </FilterGroup>
                    <FilterGroup label="ללא התגיות">
                      {data.tags.map((t) => (
                        <Check2 key={t.id} checked={filter.excludeTagIds?.includes(t.id)} onChange={() => toggle("excludeTagIds", t.id)}>
                          {t.name}
                        </Check2>
                      ))}
                    </FilterGroup>
                  </>
                ) : null}
                {data.sources.length ? (
                  <FilterGroup label="מקור">
                    {data.sources.map((s) => (
                      <Check2 key={s} checked={filter.sources?.includes(s)} onChange={() => toggle("sources", s)}>
                        {s}
                      </Check2>
                    ))}
                  </FilterGroup>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>פעילות קודמת</Label>
                    <Select value={filter.activity ?? "__any"} onValueChange={(v) => setFilter({ ...filter, activity: v === "__any" ? undefined : (v as Filter["activity"]) })}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__any">ללא סינון</SelectItem>
                        <SelectItem value="never_sent">טרם קיבלו הודעה</SelectItem>
                        <SelectItem value="read">קראו הודעה בעבר</SelectItem>
                        <SelectItem value="clicked">הקליקו בעבר</SelectItem>
                        <SelectItem value="replied">הגיבו בעבר</SelectItem>
                        <SelectItem value="not_replied">לא הגיבו</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="w-nsd">לא קיבלו הודעה ב-X הימים האחרונים</Label>
                    <Input id="w-nsd" type="number" min={1} value={filter.notSentForDays ?? ""} onChange={(e) => setFilter({ ...filter, notSentForDays: e.target.value ? Number(e.target.value) : undefined })} />
                  </div>
                </div>
                {data.campaigns.length ? (
                  <FilterGroup label="הוצאת מי שכבר קיבלו קמפיין">
                    {data.campaigns.slice(0, 30).map((x) => (
                      <Check2 key={x.id} checked={filter.excludeCampaignIds?.includes(x.id)} onChange={() => toggle("excludeCampaignIds", x.id)}>
                        {x.name}
                      </Check2>
                    ))}
                  </FilterGroup>
                ) : null}
                <Button variant="outline" disabled={pending} onClick={() => save(1, loadAudience)}>
                  {pending ? <Spinner /> : <Users />}
                  עדכון ספירת נמענים
                </Button>
              </CardContent>
              <CardFooter className="justify-between">
                <Button variant="ghost" onClick={() => setStep(0)}>
                  <ChevronRight />
                  חזרה
                </Button>
                <Button disabled={pending} onClick={() => save(2)}>
                  המשך
                  <ChevronLeft />
                </Button>
              </CardFooter>
            </Card>
          ) : null}

          {step === 2 && template ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>משתני התבנית</CardTitle>
                  <CardDescription>לכל נמען יוזן ערך אישי. נמען שחסר לו ערך (וללא ערך חלופי) יוצא מהקמפיין — Meta דוחה פרמטרים ריקים.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {template.slots.length === 0 && !template.media ? <p className="text-sm text-muted-foreground">לתבנית זו אין משתנים.</p> : null}
                  {template.slots.map((s) => {
                    const m = c.variableMapping[s.key] ?? { type: "static", value: "" };
                    const setM = (v: VarSource) => setC({ ...c, variableMapping: { ...c.variableMapping, [s.key]: v } });
                    const kind = m.type === "contact_field" ? `field:${m.field}` : m.type;
                    return (
                      <div key={s.key} className="grid items-end gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_1fr]">
                        <div className="space-y-1.5">
                          <Label>{s.label}</Label>
                          <Select
                            value={kind}
                            onValueChange={(v) =>
                              setM(v.startsWith("field:") ? { type: "contact_field", field: v.slice(6) as "name" | "first_name" | "phone", fallback: "fallback" in m ? m.fallback : "" } : v === "attribute" ? { type: "attribute", key: "" } : v === "tracked_link" ? { type: "tracked_link" } : { type: "static", value: "" })
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {s.component !== "button" ? (
                                <>
                                  <SelectItem value="field:first_name">שם פרטי של איש הקשר</SelectItem>
                                  <SelectItem value="field:name">שם מלא של איש הקשר</SelectItem>
                                  <SelectItem value="attribute">שדה מותאם מהייבוא</SelectItem>
                                </>
                              ) : null}
                              <SelectItem value="static">טקסט קבוע</SelectItem>
                              <SelectItem value="tracked_link">קישור מעקב אישי</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {m.type === "static" ? (
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label>ערך</Label>
                            <Input value={m.value} onChange={(e) => setM({ type: "static", value: e.target.value })} />
                          </div>
                        ) : m.type === "attribute" ? (
                          <>
                            <div className="space-y-1.5">
                              <Label>שם השדה</Label>
                              <Input value={m.key} onChange={(e) => setM({ ...m, key: e.target.value })} />
                            </div>
                            <div className="space-y-1.5">
                              <Label>ערך חלופי</Label>
                              <Input value={m.fallback ?? ""} onChange={(e) => setM({ ...m, fallback: e.target.value })} />
                            </div>
                          </>
                        ) : m.type === "contact_field" ? (
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label>ערך חלופי כשאין שם</Label>
                            <Input value={m.fallback ?? ""} onChange={(e) => setM({ ...m, fallback: e.target.value })} placeholder="לקוח/ה יקר/ה" />
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground sm:col-span-2">{s.component === "button" ? "סיומת הכתובת תהיה מזהה אקראי אישי — ללא מספר טלפון או מידע מזהה." : `יוכנס קישור מלא: ${data.trackingBase}/r/…`}</p>
                        )}
                      </div>
                    );
                  })}
                  {template.media ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="w-media">כתובת קובץ לכותרת ({template.media}) *</Label>
                      <Input id="w-media" dir="ltr" value={c.headerMediaUrl ?? ""} onChange={(e) => setC({ ...c, headerMediaUrl: e.target.value })} placeholder="https://…" />
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {Object.values(c.variableMapping).some((m) => m.type === "tracked_link") ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Link2 className="size-4" />
                      קישור מעקב
                    </CardTitle>
                    <CardDescription>הלחיצה תירשם ותופנה לכתובת היעד. בוטים ותצוגות מקדימות של WhatsApp אינם נספרים.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {data.links.length ? (
                      <Select value={c.trackedLinkId ?? ""} onValueChange={(v) => setC({ ...c, trackedLinkId: v })}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="בחירת קישור קיים" />
                        </SelectTrigger>
                        <SelectContent>
                          {data.links.map((l) => (
                            <SelectItem key={l.id} value={l.id}>
                              {l.name} → <span className="ltr">{l.destination}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    <div className="grid items-end gap-2 sm:grid-cols-[1fr_2fr_auto]">
                      <div className="space-y-1.5">
                        <Label>שם</Label>
                        <Input value={newLink.name} onChange={(e) => setNewLink({ ...newLink, name: e.target.value })} placeholder="דף נחיתה" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>כתובת יעד</Label>
                        <Input dir="ltr" value={newLink.destinationUrl} onChange={(e) => setNewLink({ ...newLink, destinationUrl: e.target.value })} placeholder="https://…" />
                      </div>
                      <Button
                        variant="outline"
                        disabled={pending || !draft || !newLink.destinationUrl}
                        onClick={() =>
                          run(() => createLinkAction({ campaignId: draft!.id, name: newLink.name || "קישור", destinationUrl: newLink.destinationUrl }), {
                            success: "הקישור נוצר",
                            onSuccess: (l) => setC({ ...c, trackedLinkId: l.id }),
                          })
                        }
                      >
                        יצירה
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader>
                  <CardTitle>הגדרות שליחה</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <RadioGroup value={scheduleMode} onValueChange={(v) => setScheduleMode(v as "now" | "later")} className="grid gap-2 sm:grid-cols-2">
                    {[
                      ["now", "שליחה מיידית", "תחל מיד לאחר האישור, בתוך שעות השליחה"],
                      ["later", "תזמון", "בתאריך ושעה שתבחרו"],
                    ].map(([v, l, d]) => (
                      <label key={v} className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/40">
                        <RadioGroupItem value={v} className="mt-0.5" />
                        <span>
                          <span className="block text-sm font-medium">{l}</span>
                          <span className="block text-xs text-muted-foreground">{d}</span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                  {scheduleMode === "later" ? (
                    <div className="max-w-xs space-y-1.5">
                      <Label htmlFor="w-when">מועד שליחה</Label>
                      <Input id="w-when" type="datetime-local" dir="ltr" value={toLocalInput(c.scheduledAt)} onChange={(e) => setC({ ...c, scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                    </div>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="w-max">כמות נמענים מרבית</Label>
                      <Input id="w-max" type="number" min={1} value={c.maxRecipients ?? ""} onChange={(e) => setC({ ...c, maxRecipients: e.target.value ? Number(e.target.value) : null })} placeholder="ללא הגבלה" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="w-mps">קצב (הודעות לשנייה)</Label>
                      <Input id="w-mps" type="number" min={1} max={80} value={c.messagesPerSecond ?? ""} onChange={(e) => setC({ ...c, messagesPerSecond: e.target.value ? Number(e.target.value) : null })} placeholder="לפי הגדרות המספר" />
                    </div>
                  </div>
                  <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <span>
                      <span className="block text-sm font-medium">שליחה רק בשעות המותרות</span>
                      <span className="block text-xs text-muted-foreground">לפי ההגדרות (ברירת מחדל: א׳-ה׳ 9:00-20:00, ו׳ עד 13:00)</span>
                    </span>
                    <Switch checked={c.respectSendingWindow} onCheckedChange={(v) => setC({ ...c, respectSendingWindow: v })} />
                  </label>
                </CardContent>
                <CardFooter className="justify-between">
                  <Button variant="ghost" onClick={() => setStep(1)}>
                    <ChevronRight />
                    חזרה
                  </Button>
                  <Button disabled={pending} onClick={() => save(3)}>
                    {pending ? <Spinner /> : null}
                    לבדיקה ואישור
                    <ChevronLeft />
                  </Button>
                </CardFooter>
              </Card>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>בדיקות לפני הפעלה</CardTitle>
                  <CardDescription>הקמפיין יופעל רק כשכל הבדיקות המחייבות עוברות.</CardDescription>
                </CardHeader>
                <CardContent>
                  {!pf ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Spinner /> מחשב נמענים ובודק תנאים…
                    </div>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {pf.items.map((i) => (
                        <li key={i.key} className="flex items-start gap-2">
                          {i.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : i.level === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
                          <span>
                            <span className={cn("font-medium", !i.ok && i.level === "error" && "text-destructive")}>{i.label}</span>
                            {i.detail && (!i.ok || i.key === "audience") ? <span className="block text-muted-foreground">{i.detail}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
              {pf ? (
                <Card>
                  <CardHeader>
                    <CardTitle>סיכום</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                      <Stat label="נמענים כשירים" value={fmtNumber(pf.audience.eligible)} strong />
                      <Stat label="נפסלו / נחסמו" value={fmtNumber(pf.audience.excluded)} />
                      <Stat label="תבנית" value={<span className="ltr">{template?.name}</span>} />
                      <Stat label="מספר שולח" value={<span className="ltr">{account?.phones.find((p) => p.id === c.phoneNumberId)?.display}</span>} />
                      <Stat label="עלות משוערת" value={pf.estimate.cost !== null ? fmtMoney(pf.estimate.cost, pf.estimate.currency) : "לא הוגדר תעריף"} />
                      <Stat label="זמן משוער לסיום" value={pf.estimate.etaText} />
                    </dl>
                    <p className="mt-3 text-xs text-muted-foreground">
                      מגבלת נמענים ייחודיים ב-24 שעות מתגלגלות: {fmtNumber(pf.estimate.rollingCap)} (נותרו {fmtNumber(pf.estimate.rollingCapRemaining)}). זו מגבלה מתגלגלת של Meta — אינה מתאפסת בחצות. העלות היא הערכה לפי התעריף שהוגדר; החשבונית של Meta היא המקור הקובע.
                    </p>
                  </CardContent>
                </Card>
              ) : null}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FlaskConical className="size-4" />
                    בדיקת הודעה לפני ההפעלה
                  </CardTitle>
                  <CardDescription>שליחת ההודעה עם ההגדרות שנבחרו למספר בדיקה מורשה.</CardDescription>
                </CardHeader>
                <CardContent>
                  {data.testRecipients.length ? (
                    <div className="flex flex-wrap gap-2">
                      <Select value={testPhone} onValueChange={setTestPhone}>
                        <SelectTrigger className="w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {data.testRecipients.map((p) => (
                            <SelectItem key={p} value={p}>
                              <span className="ltr">{p}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        disabled={pending || !draft}
                        onClick={() =>
                          run(() => testCampaignAction({ id: draft!.id, phone: testPhone }), {
                            refresh: false,
                            success: (r) => (r.status === "SUBMITTED" ? "הודעת הבדיקה התקבלה ע״י Meta" : `סטטוס: ${r.status}${"error" in r && r.error ? ` — ${r.error}` : ""}`),
                          })
                        }
                      >
                        שליחת בדיקה
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">לא הוגדרו מספרי בדיקה (הגדרות ← שליחה).</p>
                  )}
                </CardContent>
              </Card>
              <Card className="border-primary/30">
                <CardContent className="space-y-4 pt-6">
                  <p className="text-sm text-muted-foreground">ההודעות יישלחו רק לנמענים עם הסכמה רשומה שלא ביקשו הסרה. כל תגובת &quot;הסר&quot; תיאכף אוטומטית.</p>
                  {!data.canLaunch ? (
                    <Alert>
                      <AlertTitle>אין הרשאת הפעלה</AlertTitle>
                      <AlertDescription>הקמפיין נשמר כטיוטה. משתמש עם הרשאת הפעלה יכול לאשר אותו.</AlertDescription>
                    </Alert>
                  ) : null}
                </CardContent>
                <CardFooter className="justify-between">
                  <Button variant="ghost" onClick={() => setStep(2)}>
                    <ChevronRight />
                    חזרה
                  </Button>
                  <Button
                    size="lg"
                    disabled={pending || !pf?.ok || !data.canLaunch || !draft}
                    onClick={() => {
                      const noOptOut = pf!.items.some((i) => i.key === "optout" && !i.ok);
                      if (
                        noOptOut &&
                        !window.confirm(
                          `ההודעה אינה כוללת אפשרות הסרה.\n\nחוק התקשורת (סעיף 30א) מחייב אפשרות סירוב בכל הודעה פרסומית — חשיפה לפיצוי של עד ₪1,000 לכל הודעה (${pf!.audience.eligible} הודעות). תגובת "הסר" תמשיך להיאכף אוטומטית, והאישור יירשם ביומן הביקורת.\n\nלשלוח בכל זאת?`,
                        )
                      )
                        return;
                      run(() => launchCampaignAction({ id: draft!.id, confirmedEligibleCount: pf!.audience.eligible, acknowledgeNoOptOut: noOptOut }), {
                        success: (r) => (r.scheduled ? `הקמפיין תוזמן ל-${r.eligible} נמענים` : `הקמפיין הופעל ל-${r.eligible} נמענים`),
                        onSuccess: () => router.push(`/campaigns/${draft!.id}`),
                        onError: () => loadPreflight(),
                      });
                    }}
                  >
                    {pending ? <Spinner /> : <Rocket />}
                    {scheduleMode === "later" ? "תזמון הקמפיין" : "הפעלת הקמפיין"}
                  </Button>
                </CardFooter>
              </Card>
            </>
          ) : null}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {template ? <WhatsAppPreview components={template.components} values={previewValues} businessName={data.businessName} /> : <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">בחרו תבנית לתצוגה מקדימה</div>}
          {step >= 1 && (audience || pf) ? <AudienceSummary a={(step === 3 && pf ? pf.audience : audience)!} /> : null}
        </aside>
      </div>
    </div>
  );
}

function AudienceSummary({ a }: { a: Audience }) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-sm">נמענים</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">תואמים לסינון</span>
          <span className="tabular font-medium">{fmtNumber(a.matched)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">כשירים לשליחה</span>
          <span className="tabular text-lg font-semibold text-primary">{fmtNumber(a.eligible)}</span>
        </div>
        {a.excluded ? (
          <div className="space-y-1 border-t pt-2">
            <div className="text-xs text-muted-foreground">נפסלו ({fmtNumber(a.excluded)}):</div>
            {Object.entries(a.reasons).map(([r, n]) => (
              <div key={r} className="flex justify-between text-xs">
                <span>{EXCLUSION_LABELS[r] ?? r}</span>
                <span className="tabular">{fmtNumber(n)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FilterGroup({ label, children, extra }: { label: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {extra}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">{children}</div>
    </div>
  );
}

function Check2({ checked, onChange, children }: { checked?: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <Checkbox checked={!!checked} onCheckedChange={onChange} />
      {children}
    </label>
  );
}

function Stat({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium", strong && "text-lg text-primary")}>{value}</dd>
    </div>
  );
}
