"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Filter, Search, UserCheck, Users, UsersRound, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Pill } from "@/components/app/badges";
import { formatPhoneDisplay } from "@/lib/phone";
import { ELIGIBILITY_INFO, type EligibilityReason } from "@/lib/consent";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { searchRecipientsAction } from "../actions";

export type Activity = "never_sent" | "sent" | "delivered" | "read" | "clicked" | "replied" | "not_replied";
export type Conditions = {
  tagIds?: string[];
  tagMode?: "any" | "all";
  excludeTagIds?: string[];
  sources?: string[];
  activity?: Activity;
  notSentForDays?: number;
  excludeCampaignIds?: string[];
};
export type PickedContact = { id: string; name: string | null; phone: string };
export type AudienceValue = { mode: "all" | "group" | "conditions" | "contacts"; audienceId: string | null; conditions: Conditions; contacts: PickedContact[] };

export const EMPTY_AUDIENCE: AudienceValue = { mode: "all", audienceId: null, conditions: {}, contacts: [] };

const MODES = [
  { value: "all", label: "כל אנשי הקשר", icon: Users },
  { value: "group", label: "קבוצה", icon: UsersRound },
  { value: "conditions", label: "לפי תנאים", icon: Filter },
  { value: "contacts", label: "בחירת אנשי קשר", icon: UserCheck },
] as const;

const TONE: Record<string, "success" | "danger" | "warning"> = { success: "success", danger: "danger", warning: "warning" };

export function AudiencePicker({
  value,
  onChange,
  audiences,
  tags,
  sources,
  campaigns,
  eligibleTotal,
}: {
  value: AudienceValue;
  onChange: (v: AudienceValue) => void;
  audiences: { id: string; name: string; size: number }[];
  tags: { id: string; name: string }[];
  sources: string[];
  campaigns: { id: string; name: string }[];
  eligibleTotal: number;
}) {
  const set = (patch: Partial<AudienceValue>) => onChange({ ...value, ...patch });
  const setCond = (patch: Partial<Conditions>) => set({ conditions: { ...value.conditions, ...patch } });
  const toggleIn = (key: "tagIds" | "excludeTagIds" | "sources" | "excludeCampaignIds", v: string) => {
    const cur = value.conditions[key] ?? [];
    setCond({ [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="אופן בחירת הקהל">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={value.mode === m.value}
            onClick={() => set({ mode: m.value })}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
              value.mode === m.value ? "border-primary bg-accent/60 font-medium text-accent-foreground" : "hover:bg-muted",
            )}
          >
            <m.icon className="size-4" />
            {m.label}
          </button>
        ))}
      </div>

      {value.mode === "all" ? <p className="text-sm text-muted-foreground">כל אנשי הקשר הכשירים בעסק ({fmtNumber(eligibleTotal)}).</p> : null}

      {value.mode === "group" ? (
        audiences.length ? (
          <Select value={value.audienceId ?? ""} onValueChange={(v) => set({ audienceId: v })}>
            <SelectTrigger className="w-full sm:w-96">
              <SelectValue placeholder="בחירת קבוצה" />
            </SelectTrigger>
            <SelectContent>
              {audiences.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} ({fmtNumber(a.size)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">אין עדיין קבוצות. ניתן ליצור בעמוד &quot;קבוצות וקהלים&quot;, או לבחור לפי תנאים / אנשי קשר.</p>
        )
      ) : null}

      {value.mode === "conditions" ? (
        <div className="space-y-4 rounded-lg border p-4">
          {tags.length ? (
            <>
              <ChipGroup
                label="עם התגיות"
                extra={
                  <Select value={value.conditions.tagMode ?? "any"} onValueChange={(v) => setCond({ tagMode: v as "any" | "all" })}>
                    <SelectTrigger size="sm" className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">אחת מהן</SelectItem>
                      <SelectItem value="all">כולן</SelectItem>
                    </SelectContent>
                  </Select>
                }
                items={tags.map((t) => ({ value: t.id, label: t.name }))}
                selected={value.conditions.tagIds ?? []}
                onToggle={(v) => toggleIn("tagIds", v)}
              />
              <ChipGroup label="בלי התגיות" items={tags.map((t) => ({ value: t.id, label: t.name }))} selected={value.conditions.excludeTagIds ?? []} onToggle={(v) => toggleIn("excludeTagIds", v)} />
            </>
          ) : null}
          {sources.length ? <ChipGroup label="מקור" items={sources.map((s) => ({ value: s, label: s }))} selected={value.conditions.sources ?? []} onToggle={(v) => toggleIn("sources", v)} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>פעילות קודמת</Label>
              <Select value={value.conditions.activity ?? "__any"} onValueChange={(v) => setCond({ activity: v === "__any" ? undefined : (v as Activity) })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any">ללא סינון</SelectItem>
                  <SelectItem value="never_sent">טרם קיבלו הודעה</SelectItem>
                  <SelectItem value="read">קראו הודעה בעבר</SelectItem>
                  <SelectItem value="clicked">הקליקו על קישור</SelectItem>
                  <SelectItem value="replied">הגיבו בעבר</SelectItem>
                  <SelectItem value="not_replied">לא הגיבו</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cond-days">לא קיבלו הודעה ב-X הימים האחרונים</Label>
              <Input id="cond-days" type="number" min={1} value={value.conditions.notSentForDays ?? ""} onChange={(e) => setCond({ notSentForDays: e.target.value ? Number(e.target.value) : undefined })} placeholder="ללא" />
            </div>
          </div>
          {campaigns.length ? (
            <ChipGroup label="בלי מי שקיבל את הקמפיינים" items={campaigns.map((c) => ({ value: c.id, label: c.name }))} selected={value.conditions.excludeCampaignIds ?? []} onToggle={(v) => toggleIn("excludeCampaignIds", v)} />
          ) : null}
        </div>
      ) : null}

      {value.mode === "contacts" ? <ContactSearch picked={value.contacts} onChange={(contacts) => set({ contacts })} /> : null}
    </div>
  );
}

function ChipGroup({ label, items, selected, onToggle, extra }: { label: string; items: { value: string; label: string }[]; selected: string[]; onToggle: (v: string) => void; extra?: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {extra}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => {
          const on = selected.includes(i.value);
          return (
            <button
              key={i.value}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(i.value)}
              className={cn("rounded-full border px-3 py-1 text-xs transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {i.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type Result = PickedContact & { eligibility: EligibilityReason };

function ContactSearch({ picked, onChange }: { picked: PickedContact[]; onChange: (c: PickedContact[]) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [total, setTotal] = useState(0);
  const [pending, start] = useTransition();
  const seq = useRef(0);
  const pickedIds = new Set(picked.map((p) => p.id));

  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(
      () =>
        start(async () => {
          const res = await searchRecipientsAction({ q });
          if (my !== seq.current || !res.ok) return;
          setResults(res.data.rows);
          setTotal(res.data.total);
        }),
      q ? 300 : 0,
    );
    return () => clearTimeout(t);
  }, [q]);

  const toggle = (r: Result) => onChange(pickedIds.has(r.id) ? picked.filter((p) => p.id !== r.id) : [...picked, { id: r.id, name: r.name, phone: r.phone }]);
  const eligibleResults = results.filter((r) => r.eligibility === "ELIGIBLE" && !pickedIds.has(r.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <InputGroup className="sm:max-w-sm">
          <InputGroupAddon>{pending ? <Spinner /> : <Search />}</InputGroupAddon>
          <InputGroupInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם או טלפון" aria-label="חיפוש אנשי קשר" />
        </InputGroup>
        {eligibleResults.length ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...picked, ...eligibleResults.map(({ id, name, phone }) => ({ id, name, phone }))])}>
            הוספת כל הכשירים בתוצאות ({eligibleResults.length})
          </Button>
        ) : null}
      </div>

      <div className="max-h-72 overflow-y-auto rounded-lg border">
        {results.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">{pending ? "מחפש…" : q ? "לא נמצאו אנשי קשר" : "אין אנשי קשר"}</p>
        ) : (
          <ul className="divide-y">
            {results.map((r) => {
              const info = ELIGIBILITY_INFO[r.eligibility];
              const eligible = r.eligibility === "ELIGIBLE";
              return (
                <li key={r.id}>
                  <label className={cn("flex items-center gap-3 px-3 py-2 text-sm", eligible ? "cursor-pointer hover:bg-muted/60" : "opacity-60")} title={eligible ? undefined : info.explain}>
                    <Checkbox checked={pickedIds.has(r.id)} disabled={!eligible && !pickedIds.has(r.id)} onCheckedChange={() => toggle(r)} />
                    <span className="min-w-0 flex-1 truncate">{r.name || "ללא שם"}</span>
                    <span className="ltr tabular text-xs text-muted-foreground">{formatPhoneDisplay(r.phone)}</span>
                    <Pill tone={TONE[info.tone]}>{info.label}</Pill>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {total > results.length ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">מוצגים {results.length} מתוך {fmtNumber(total)} — חדדו את החיפוש</p> : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>נבחרו {fmtNumber(picked.length)}</Label>
          {picked.length ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => onChange([])}>
              ניקוי
            </Button>
          ) : null}
        </div>
        {picked.length ? (
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
            {picked.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 ps-2.5 pe-1 text-xs">
                {p.name || formatPhoneDisplay(p.phone)}
                <button type="button" onClick={() => onChange(picked.filter((x) => x.id !== p.id))} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`הסרת ${p.name ?? p.phone}`}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">סמנו אנשי קשר מהרשימה. מי שאינו כשיר מסומן וההסבר מופיע במעבר עכבר.</p>
        )}
      </div>
    </div>
  );
}
