"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { saveAudienceAction } from "./actions";

type Activity = "never_sent" | "sent" | "delivered" | "read" | "clicked" | "replied" | "not_replied";
type Filter = { tagIds?: string[]; tagMode?: "any" | "all"; sources?: string[]; consent?: "UNKNOWN" | "GRANTED" | "REVOKED"; activity?: Activity; notSentForDays?: number };

export function AudienceDialog({
  tags,
  sources,
  audience,
}: {
  tags: { id: string; name: string }[];
  sources: string[];
  audience?: { id: string; name: string; description: string | null; kind: "STATIC" | "DYNAMIC"; filter: Record<string, unknown> };
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(audience?.name ?? "");
  const [description, setDescription] = useState(audience?.description ?? "");
  const [kind, setKind] = useState<"STATIC" | "DYNAMIC">(audience?.kind ?? "STATIC");
  const [filter, setFilter] = useState<Filter>((audience?.filter as Filter) ?? {});
  const { run, pending } = useAction();
  const toggleIn = (key: "tagIds" | "sources", v: string) => {
    const cur = filter[key] ?? [];
    setFilter({ ...filter, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] });
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {audience ? (
          <Button size="icon-sm" variant="ghost" aria-label="עריכה">
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus />
            קבוצה חדשה
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{audience ? "עריכת קבוצה" : "קבוצה חדשה"}</DialogTitle>
          <DialogDescription>אנשי קשר מתווספים לקבוצה סטטית מטבלת אנשי הקשר או בעת ייבוא.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="au-name">שם *</Label>
            <Input id="au-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="au-desc">תיאור</Label>
            <Input id="au-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {!audience ? (
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as "STATIC" | "DYNAMIC")} className="grid grid-cols-2 gap-2">
              {[
                ["STATIC", "סטטית", "רשימה קבועה"],
                ["DYNAMIC", "דינמית", "לפי כללים"],
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
          ) : null}
          {kind === "DYNAMIC" ? (
            <div className="space-y-4 rounded-xl border p-4">
              {tags.length ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>תגיות</Label>
                    <Select value={filter.tagMode ?? "any"} onValueChange={(v) => setFilter({ ...filter, tagMode: v as "any" | "all" })}>
                      <SelectTrigger size="sm" className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">אחת מהן</SelectItem>
                        <SelectItem value="all">כולן</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {tags.map((t) => (
                      <label key={t.id} className="flex items-center gap-1.5 text-sm">
                        <Checkbox checked={filter.tagIds?.includes(t.id) ?? false} onCheckedChange={() => toggleIn("tagIds", t.id)} />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              {sources.length ? (
                <div className="space-y-2">
                  <Label>מקור</Label>
                  <div className="flex flex-wrap gap-3">
                    {sources.map((s) => (
                      <label key={s} className="flex items-center gap-1.5 text-sm">
                        <Checkbox checked={filter.sources?.includes(s) ?? false} onCheckedChange={() => toggleIn("sources", s)} />
                        {s}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>פעילות קודמת</Label>
                  <Select value={filter.activity ?? "__any"} onValueChange={(v) => setFilter({ ...filter, activity: v === "__any" ? undefined : (v as Activity) })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any">ללא סינון</SelectItem>
                      <SelectItem value="never_sent">טרם קיבלו הודעה</SelectItem>
                      <SelectItem value="read">קראו הודעה</SelectItem>
                      <SelectItem value="clicked">הקליקו על קישור</SelectItem>
                      <SelectItem value="replied">הגיבו</SelectItem>
                      <SelectItem value="not_replied">לא הגיבו</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="au-days">לא קיבלו הודעה ב-X ימים</Label>
                  <Input id="au-days" type="number" min={1} value={filter.notSentForDays ?? ""} onChange={(e) => setFilter({ ...filter, notSentForDays: e.target.value ? Number(e.target.value) : undefined })} />
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !name.trim()}
            onClick={() =>
              run(() => saveAudienceAction({ id: audience?.id, name, description, kind, filter: kind === "DYNAMIC" ? filter : undefined }), {
                success: "נשמר",
                onSuccess: () => setOpen(false),
              })
            }
          >
            {pending ? <Spinner /> : null}
            שמירה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
