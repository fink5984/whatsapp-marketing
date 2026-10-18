"use client";

import { useState } from "react";
import { RefreshCw, Sheet, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ActionButton, ConfirmAction } from "@/components/app/confirm";
import { PendingExternal, StatusBadge } from "@/components/app/badges";
import { useAction } from "@/hooks/use-action";
import { fmtRelative } from "@/lib/format";
import { deleteSheetSourceAction, saveSheetSourceAction, syncSheetSourceAction } from "../actions";

type Source = { id: string; name: string; spreadsheetId: string; range: string; lastSyncAt: string | null; lastSyncStatus: string | null; lastSyncMessage: string | null; syncIntervalMin: number | null };

export function SheetSources({ configured, serviceEmail, sources, audiences }: { configured: boolean; serviceEmail: string | null; sources: Source[]; audiences: { id: string; name: string }[] }) {
  const { run, pending } = useAction();
  const [form, setForm] = useState({ name: "", spreadsheet: "", range: "Sheet1", phoneColumn: "טלפון", nameColumn: "שם", tags: "", audienceId: "__none", interval: "0" });

  if (!configured) {
    return (
      <Alert>
        <Sheet />
        <AlertTitle className="flex items-center gap-2">
          Google Sheets <PendingExternal />
        </AlertTitle>
        <AlertDescription>
          כדי לסנכרן גיליונות יש ליצור Service Account ב-Google Cloud עם הרשאת Google Sheets API, ולהגדיר את משתנה הסביבה <code className="ltr">GOOGLE_SERVICE_ACCOUNT_JSON</code>. לאחר מכן יש לשתף כל גיליון עם כתובת הדוא״ל של חשבון השירות (צפייה בלבד).
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="space-y-4">
      <Alert>
        <Sheet />
        <AlertDescription>
          שתפו את הגיליון (צפייה בלבד) עם: <span className="ltr font-medium select-all">{serviceEmail}</span>. סנכרון מוסיף ומעדכן פרטים בלבד — לעולם אינו משנה הסכמות ואינו מבטל הסרות.
        </AlertDescription>
      </Alert>
      {sources.map((s) => (
        <Card key={s.id} className="gap-3">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {s.name}
              {s.lastSyncStatus ? <StatusBadge status={s.lastSyncStatus === "OK" ? "PASSED" : "FAILED"} label={s.lastSyncStatus === "OK" ? "סונכרן" : "שגיאה"} /> : null}
            </CardTitle>
            <CardDescription className="ltr text-start">
              {s.spreadsheetId} · {s.range}
            </CardDescription>
          </CardHeader>
          <CardContent suppressHydrationWarning className="text-sm text-muted-foreground">
            {s.lastSyncAt ? `סנכרון אחרון ${fmtRelative(s.lastSyncAt)}: ${s.lastSyncMessage ?? ""}` : "טרם סונכרן"}
            {s.syncIntervalMin ? ` · סנכרון אוטומטי כל ${s.syncIntervalMin} דקות` : " · סנכרון ידני"}
          </CardContent>
          <CardFooter className="gap-2">
            <ActionButton size="sm" variant="outline" action={() => syncSheetSourceAction({ id: s.id })} success="הסנכרון הושלם">
              <RefreshCw />
              סנכרון עכשיו
            </ActionButton>
            <ConfirmAction
              trigger={
                <Button size="sm" variant="ghost">
                  <Trash2 />
                  הסרה
                </Button>
              }
              title="הסרת מקור גיליון"
              description="אנשי הקשר שכבר יובאו יישארו במערכת."
              destructive
              action={() => deleteSheetSourceAction({ id: s.id })}
            />
          </CardFooter>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>חיבור גיליון חדש</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sh-name">שם</Label>
            <Input id="sh-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="לידים מהאתר" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sh-url">קישור לגיליון או מזהה</Label>
            <Input id="sh-url" dir="ltr" value={form.spreadsheet} onChange={(e) => setForm({ ...form, spreadsheet: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sh-range">לשונית / טווח</Label>
            <Input id="sh-range" dir="ltr" value={form.range} onChange={(e) => setForm({ ...form, range: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sh-phone">כותרת עמודת טלפון</Label>
              <Input id="sh-phone" value={form.phoneColumn} onChange={(e) => setForm({ ...form, phoneColumn: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sh-namecol">כותרת עמודת שם</Label>
              <Input id="sh-namecol" value={form.nameColumn} onChange={(e) => setForm({ ...form, nameColumn: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sh-tags">תגיות</Label>
            <Input id="sh-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="מופרדות בפסיק" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>קבוצה</Label>
              <Select value={form.audienceId} onValueChange={(v) => setForm({ ...form, audienceId: v })}>
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
            <div className="space-y-1.5">
              <Label>סנכרון אוטומטי</Label>
              <Select value={form.interval} onValueChange={(v) => setForm({ ...form, interval: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">ידני בלבד</SelectItem>
                  <SelectItem value="15">כל 15 דקות</SelectItem>
                  <SelectItem value="60">כל שעה</SelectItem>
                  <SelectItem value="1440">פעם ביום</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  saveSheetSourceAction({
                    name: form.name,
                    spreadsheet: form.spreadsheet,
                    range: form.range,
                    phoneColumn: form.phoneColumn,
                    nameColumn: form.nameColumn || undefined,
                    tags: form.tags,
                    audienceId: form.audienceId === "__none" ? null : form.audienceId,
                    syncIntervalMin: Number(form.interval) || null,
                  }),
                { success: "הגיליון חובר", onSuccess: () => setForm({ ...form, name: "", spreadsheet: "" }) },
              )
            }
          >
            {pending ? <Spinner /> : null}
            שמירת מקור
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
