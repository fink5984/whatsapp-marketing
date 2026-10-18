"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { fmtNumber } from "@/lib/format";
import { BULK_CONSENT_SOURCES, CONSENT_SOURCE_INFO, type ConsentSourceCode } from "@/lib/consent";
import { previewImportAction, runImportAction } from "../actions";

type Preview = { headers: string[]; sample: Record<string, string>[]; total: number; guess: Record<string, unknown> };
type Stats = { totalRows: number; created: number; updated: number; skipped: number; invalid: number; duplicatesInFile: number; suppressedKept: number; consentRecorded: number; errors: { row: number; reason: string }[] };

const FIELDS: { key: string; label: string; required?: boolean; consent?: boolean }[] = [
  { key: "phone", label: "מספר טלפון", required: true },
  { key: "name", label: "שם" },
  { key: "source", label: "מקור" },
  { key: "tags", label: "תגיות (מופרדות בפסיק)" },
  { key: "notes", label: "הערות" },
  { key: "consentProof", label: "פירוט הסכמה לכל שורה (לא חובה)", consent: true },
  { key: "consentDate", label: "תאריך הסכמה (לא חובה)", consent: true },
];

export function ImportWizard({ audiences, canConsent }: { audiences: { id: string; name: string }[]; canConsent: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [options, setOptions] = useState({ source: "", tags: "", audienceId: "__none" });
  const [consent, setConsent] = useState({ source: "__none", note: "" });
  const [stats, setStats] = useState<Stats | null>(null);
  const { run, pending } = useAction();

  const reset = () => {
    setFile(null);
    setPreview(null);
    setStats(null);
    setMapping({});
  };

  if (stats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-success" />
            הייבוא הושלם
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["שורות בקובץ", stats.totalRows],
              ["נוספו", stats.created],
              ["עודכנו", stats.updated],
              ["ללא שינוי", stats.skipped],
              ["כפולים בקובץ (אוחדו)", stats.duplicatesInFile],
              ["מספרים שגויים", stats.invalid],
              ["נשארו חסומים (הסרה)", stats.suppressedKept],
              ["נרשמה הסכמה", stats.consentRecorded],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{l}</div>
                <div className="tabular text-xl font-semibold">{fmtNumber(v as number)}</div>
              </div>
            ))}
          </div>
          {stats.errors.length ? (
            <div>
              <h3 className="mb-2 text-sm font-medium">שורות שלא יובאו</h3>
              <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg border p-3 text-sm">
                {stats.errors.map((e, i) => (
                  <li key={i}>
                    <span className="text-muted-foreground">שורה {e.row}:</span> {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="gap-2">
          <Button asChild>
            <Link href="/contacts">לאנשי הקשר</Link>
          </Button>
          <Button variant="outline" onClick={reset}>
            ייבוא נוסף
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (!preview) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>העלאת קובץ</CardTitle>
          <CardDescription>CSV (UTF-8 או Windows-1255) או XLSX. השורה הראשונה חייבת להכיל כותרות. עד 100,000 שורות.</CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors hover:border-primary/50 hover:bg-accent/30">
            <FileSpreadsheet className="size-10 text-muted-foreground" />
            <span className="text-sm">{file ? file.name : "לחצו לבחירת קובץ"}</span>
            <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </CardContent>
        <CardFooter>
          <Button
            disabled={!file || pending}
            onClick={() => {
              const fd = new FormData();
              fd.set("file", file!);
              run(() => previewImportAction(fd), {
                refresh: false,
                onSuccess: (p) => {
                  setPreview(p);
                  setMapping(Object.fromEntries(Object.entries(p.guess).filter(([, v]) => typeof v === "string" && v)) as Record<string, string>);
                  setOptions((o) => ({ ...o, source: o.source || file!.name.replace(/\.(csv|xlsx)$/i, "") }));
                },
              });
            }}
          >
            {pending ? <Spinner /> : <Upload />}
            המשך למיפוי עמודות
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const columnSelect = (key: string) => (
    <Select value={mapping[key] ?? "__none"} onValueChange={(v) => setMapping({ ...mapping, [key]: v })}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">— ללא —</SelectItem>
        {preview.headers.map((h) => (
          <SelectItem key={h} value={h}>
            {h}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>מיפוי עמודות</CardTitle>
          <CardDescription>
            {file?.name} · {fmtNumber(preview.total)} שורות
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.filter((f) => !f.consent || consent.source !== "__none").map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label>
                  {f.label}
                  {f.required ? " *" : ""}
                </Label>
                {columnSelect(f.key)}
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {preview.headers.map((h) => (
                    <TableHead key={h} className="whitespace-nowrap">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.sample.map((r, i) => (
                  <TableRow key={i}>
                    {preview.headers.map((h) => (
                      <TableCell key={h} className="max-w-48 truncate">
                        {r[h]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>הגדרות ייבוא</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="imp-src">מקור הנתונים *</Label>
              <Input id="imp-src" value={options.source} onChange={(e) => setOptions({ ...options, source: e.target.value })} placeholder="למשל: כנס אוקטובר 2026" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imp-tags">תגיות לכל השורות</Label>
              <Input id="imp-tags" value={options.tags} onChange={(e) => setOptions({ ...options, tags: e.target.value })} placeholder="מופרדות בפסיק" />
            </div>
            <div className="space-y-1.5">
              <Label>הוספה לקבוצה</Label>
              <Select value={options.audienceId} onValueChange={(v) => setOptions({ ...options, audienceId: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— ללא —</SelectItem>
                  {audiences.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {canConsent ? (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="space-y-1.5">
                <Label>מקור ההסכמה של הרשימה</Label>
                <Select value={consent.source} onValueChange={(v) => setConsent({ ...consent, source: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">ללא הסכמה רשומה — שמירת אנשי קשר בלבד</SelectItem>
                    {BULK_CONSENT_SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {CONSENT_SOURCE_INFO[s].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {consent.source === "__none"
                    ? "אנשי הקשר יישמרו, אך לא יקבלו קמפיינים עד שיירשם להם מקור הסכמה."
                    : CONSENT_SOURCE_INFO[consent.source as ConsentSourceCode].hint}
                </p>
              </div>
              {consent.source !== "__none" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="imp-note">הערה (לא חובה)</Label>
                  <Input id="imp-note" value={consent.note} onChange={(e) => setConsent({ ...consent, note: e.target.value })} placeholder={CONSENT_SOURCE_INFO[consent.source as ConsentSourceCode].defaultNote} />
                  <p className="text-xs text-muted-foreground">המקור נרשם לכל איש קשר ברשימה. מי שביקש הסרה או ביטל הסכמה בעבר — לא ישתנה.</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="gap-2">
          <Button
            disabled={pending || !mapping.phone || mapping.phone === "__none" || !options.source.trim()}
            onClick={() => {
              const fd = new FormData();
              fd.set("file", file!);
              fd.set("mapping", JSON.stringify(mapping));
              fd.set(
                "options",
                JSON.stringify({
                  source: options.source,
                  tagNames: options.tags.split(",").map((t) => t.trim()).filter(Boolean),
                  audienceId: options.audienceId === "__none" ? null : options.audienceId,
                  consent: consent.source !== "__none" ? { enabled: true, source: consent.source, note: consent.note || undefined } : null,
                }),
              );
              run(() => runImportAction(fd), { onSuccess: (r) => setStats(r.stats) });
            }}
          >
            {pending ? <Spinner /> : null}
            ייבוא {fmtNumber(preview.total)} שורות
          </Button>
          <Button variant="ghost" onClick={reset} disabled={pending}>
            ביטול
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
