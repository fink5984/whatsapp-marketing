"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FlaskConical, Pencil, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmAction } from "@/components/app/confirm";
import { useAction } from "@/hooks/use-action";
import { deleteTemplateAction, submitTemplateAction, testTemplateAction } from "../actions";

export function TemplateActions({
  template,
  testRecipients,
  can,
}: {
  template: { id: string; status: string; media: string | null; slots: { key: string; label: string }[] };
  testRecipients: string[];
  can: { write: boolean; test: boolean };
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [dialog, setDialog] = useState<null | "submit" | "test">(null);
  const [file, setFile] = useState<File | null>(null);
  const [testPhone, setTestPhone] = useState(testRecipients[0] ?? "");
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [mediaUrl, setMediaUrl] = useState("");
  const editable = template.status === "DRAFT" || template.status === "REJECTED";
  return (
    <>
      {can.write && editable ? (
        <>
          <Button variant="outline" asChild>
            <Link href={`/templates/${template.id}/edit`}>
              <Pencil />
              עריכה
            </Link>
          </Button>
          <Button onClick={() => setDialog("submit")}>
            <Send />
            שליחה לאישור Meta
          </Button>
        </>
      ) : null}
      {can.test && template.status === "APPROVED" ? (
        <Button variant="outline" onClick={() => setDialog("test")}>
          <FlaskConical />
          שליחת בדיקה
        </Button>
      ) : null}
      {can.write ? (
        <ConfirmAction
          trigger={
            <Button variant="ghost" size="icon" aria-label="מחיקת תבנית">
              <Trash2 />
            </Button>
          }
          title="מחיקת תבנית"
          description="התבנית תימחק גם ב-Meta (אם נשלחה). שם התבנית לא יהיה זמין לשימוש חוזר למשך 30 יום לפי מדיניות Meta."
          destructive
          action={() => deleteTemplateAction({ id: template.id })}
          success="התבנית נמחקה"
          onDone={() => router.push("/templates")}
        />
      ) : null}

      <Dialog open={dialog === "submit"} onOpenChange={(o) => setDialog(o ? "submit" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>שליחה לאישור Meta</DialogTitle>
            <DialogDescription>הבדיקה אורכת בדרך כלל דקות עד 24 שעות. הסטטוס יתעדכן אוטומטית.</DialogDescription>
          </DialogHeader>
          {template.media ? (
            <div className="space-y-1.5">
              <Label htmlFor="ts-file">קובץ לדוגמה לכותרת ({template.media})</Label>
              <Input id="ts-file" type="file" accept={template.media === "IMAGE" ? "image/jpeg,image/png" : template.media === "VIDEO" ? "video/mp4" : "application/pdf"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          ) : null}
          <DialogFooter>
            <Button
              disabled={pending || (!!template.media && !file)}
              onClick={() => {
                const fd = new FormData();
                fd.set("id", template.id);
                if (file) fd.set("file", file);
                run(() => submitTemplateAction(fd), { success: "התבנית נשלחה לאישור", onSuccess: () => setDialog(null) });
              }}
            >
              {pending ? <Spinner /> : null}
              שליחה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "test"} onOpenChange={(o) => setDialog(o ? "test" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>שליחת בדיקה</DialogTitle>
            <DialogDescription>ניתן לשלוח רק למספרי בדיקה מורשים (הגדרות ← שליחה). זו הודעה אמיתית שתחויב לפי תעריף Meta.</DialogDescription>
          </DialogHeader>
          {testRecipients.length === 0 ? (
            <p className="text-sm text-destructive">לא הוגדרו מספרי בדיקה. הוסיפו מספר בהגדרות.</p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>מספר בדיקה</Label>
                <Select value={testPhone} onValueChange={setTestPhone}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {testRecipients.map((p) => (
                      <SelectItem key={p} value={p}>
                        <span className="ltr">{p}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {template.slots.map((s) => (
                <div key={s.key} className="space-y-1.5">
                  <Label>{s.label}</Label>
                  <Input value={samples[s.key] ?? ""} onChange={(e) => setSamples({ ...samples, [s.key]: e.target.value })} />
                </div>
              ))}
              {template.media ? (
                <div className="space-y-1.5">
                  <Label>כתובת קובץ מדיה (https)</Label>
                  <Input dir="ltr" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} />
                </div>
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={pending || !testPhone}
              onClick={() =>
                run(() => testTemplateAction({ templateId: template.id, phone: testPhone, sampleValues: samples, headerMediaUrl: mediaUrl || undefined }), {
                  success: (r) => (r.status === "SUBMITTED" ? "הבדיקה נשלחה — התקבלה ע״י Meta" : `סטטוס: ${r.status}${"error" in r && r.error ? ` — ${r.error}` : ""}`),
                  onSuccess: () => setDialog(null),
                })
              }
            >
              {pending ? <Spinner /> : null}
              שליחה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
