"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, MoreHorizontal, Pencil, RotateCcw, ShieldCheck, ShieldX, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmAction } from "@/components/app/confirm";
import { useAction } from "@/hooks/use-action";
import { deleteContactAction, grantConsentAction, resubscribeAction, revokeConsentAction, suppressContactAction, updateContactAction } from "../actions";

type Props = {
  contact: { id: string; name: string | null; source: string | null; notes: string | null; tagIds: string[]; consent: "UNKNOWN" | "GRANTED" | "REVOKED"; suppressed: boolean };
  tags: { id: string; name: string }[];
  can: { write: boolean; consent: boolean; suppress: boolean; lift: boolean; del: boolean };
};

const CONSENT_SOURCES = [
  ["WEB_FORM", "טופס הרשמה (אתר / דף נחיתה)"],
  ["EXISTING_CUSTOMER", "לקוח קיים (סעיף 30א(ג))"],
  ["PAPER_FORM", "טופס חתום"],
  ["VERBAL_RECORDED", "הסכמה בשיחה מוקלטת"],
  ["INBOUND_MESSAGE", "פנייה יזומה של הלקוח"],
  ["OTHER_DOCUMENTED", "אחר (מתועד)"],
] as const;

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function ContactActions({ contact, tags, can }: Props) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [dialog, setDialog] = useState<null | "edit" | "consent" | "resubscribe">(null);
  const [edit, setEdit] = useState({ name: contact.name ?? "", source: contact.source ?? "", notes: contact.notes ?? "", tagIds: contact.tagIds });
  const [consent, setConsent] = useState({ source: "WEB_FORM", proofText: "", proofReference: "", capturedAt: nowLocal() });
  const [keepBlock, setKeepBlock] = useState(true);
  const [confirm, setConfirm] = useState<null | "revoke" | "suppress" | "delete">(null);

  const consentForm = (resub: boolean) => (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>מקור ההסכמה</Label>
        <Select value={consent.source} onValueChange={(v) => setConsent({ ...consent, source: v })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONSENT_SOURCES.filter(([v]) => !resub || ["WEB_FORM", "PAPER_FORM", "VERBAL_RECORDED", "INBOUND_MESSAGE"].includes(v)).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="c-proof">{resub ? "תיאור ההסכמה החדשה *" : "הערה (לא חובה)"}</Label>
        <Textarea id="c-proof" rows={3} value={consent.proofText} onChange={(e) => setConsent({ ...consent, proofText: e.target.value })} placeholder='לדוגמה: "אני מאשר/ת קבלת הודעות שיווקיות מלינדר פיננסים ב-WhatsApp" — סומן בטופס באתר' />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="c-ref">מזהה אסמכתה (אופציונלי)</Label>
          <Input id="c-ref" value={consent.proofReference} onChange={(e) => setConsent({ ...consent, proofReference: e.target.value })} placeholder="מס׳ טופס / קישור להקלטה" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-at">מועד מתן ההסכמה *</Label>
          <Input id="c-at" type="datetime-local" dir="ltr" value={consent.capturedAt} onChange={(e) => setConsent({ ...consent, capturedAt: e.target.value })} />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {can.consent && !contact.suppressed && contact.consent !== "GRANTED" ? (
        <Button onClick={() => setDialog("consent")}>
          <ShieldCheck />
          רישום הסכמה
        </Button>
      ) : null}
      {can.lift && contact.suppressed ? (
        <Button variant="outline" onClick={() => setDialog("resubscribe")}>
          <RotateCcw />
          חידוש הרשמה
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="פעולות נוספות">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {can.write ? (
            <DropdownMenuItem onSelect={() => setDialog("edit")}>
              <Pencil />
              עריכת פרטים
            </DropdownMenuItem>
          ) : null}
          {can.consent && contact.consent === "GRANTED" && !contact.suppressed ? (
            <DropdownMenuItem onSelect={() => setConfirm("revoke")}>
              <ShieldX />
              ביטול הסכמה
            </DropdownMenuItem>
          ) : null}
          {can.suppress && !contact.suppressed ? (
            <DropdownMenuItem onSelect={() => setConfirm("suppress")}>
              <Ban />
              הוספה לרשימת הסרה
            </DropdownMenuItem>
          ) : null}
          {can.del ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
                <Trash2 />
                מחיקת איש קשר
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmAction
        open={confirm === "revoke"}
        onOpenChange={(o) => setConfirm(o ? "revoke" : null)}
        title="ביטול הסכמה"
        description="איש הקשר לא יהיה כשיר לקמפיינים עד לתיעוד הסכמה חדשה."
        action={() => revokeConsentAction({ contactId: contact.id, reason: "ביטול ידני" })}
        success="ההסכמה בוטלה"
      />
      <ConfirmAction
        open={confirm === "suppress"}
        onOpenChange={(o) => setConfirm(o ? "suppress" : null)}
        title="הוספה לרשימת הסרה"
        description="המספר ייחסם לשיווק בכל מספרי השליחה של העסק, הודעות בתור יבוטלו, והחסימה תישמר גם בייבוא עתידי."
        confirmLabel="הוספה להסרה"
        destructive
        action={() => suppressContactAction({ contactId: contact.id, detail: "הסרה ידנית לבקשת הנמען" })}
        success="נוסף לרשימת ההסרה"
      />
      <ConfirmAction
        open={confirm === "delete"}
        onOpenChange={(o) => setConfirm(o ? "delete" : null)}
        title="מחיקת איש קשר"
        description={
          <>
            <p>הפרטים האישיים, ההודעות הנכנסות והיסטוריית השיחה יימחקו. נתוני קמפיינים יישמרו באופן אנונימי.</p>
            <label className="flex items-start gap-2 pt-2 text-foreground">
              <Checkbox checked={keepBlock} onCheckedChange={(v) => setKeepBlock(!!v)} className="mt-0.5" />
              <span>לשמור חסימה מינימלית (גיבוב מוצפן של המספר בלבד) כדי למנוע פנייה חוזרת. מומלץ כשהמחיקה היא לבקשת הנמען.</span>
            </label>
          </>
        }
        confirmLabel="מחיקה לצמיתות"
        destructive
        typeToConfirm="מחק"
        action={() => deleteContactAction({ id: contact.id, keepDoNotContact: keepBlock })}
        success="איש הקשר נמחק"
        onDone={() => router.push("/contacts")}
      />

      <Dialog open={dialog === "edit"} onOpenChange={(o) => setDialog(o ? "edit" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>עריכת פרטים</DialogTitle>
            <DialogDescription>מספר הטלפון, ההסכמה וההסרה אינם ניתנים לעריכה כאן.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="e-name">שם</Label>
                <Input id="e-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-src">מקור</Label>
                <Input id="e-src" value={edit.source} onChange={(e) => setEdit({ ...edit, source: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="e-notes">הערות</Label>
              <Textarea id="e-notes" rows={3} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </div>
            {tags.length ? (
              <div className="space-y-1.5">
                <Label>תגיות</Label>
                <div className="flex flex-wrap gap-3">
                  {tags.map((t) => (
                    <label key={t.id} className="flex items-center gap-1.5 text-sm">
                      <Checkbox checked={edit.tagIds.includes(t.id)} onCheckedChange={(v) => setEdit({ ...edit, tagIds: v ? [...edit.tagIds, t.id] : edit.tagIds.filter((x) => x !== t.id) })} />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button disabled={pending} onClick={() => run(() => updateContactAction({ id: contact.id, ...edit }), { success: "נשמר", onSuccess: () => setDialog(null) })}>
              {pending ? <Spinner /> : null}
              שמירה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "consent"} onOpenChange={(o) => setDialog(o ? "consent" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>רישום הסכמה לקבלת הודעות שיווקיות</DialogTitle>
            <DialogDescription>בחרו את מקור ההסכמה. אחרי הרישום איש הקשר יהיה כשיר לקמפיינים.</DialogDescription>
          </DialogHeader>
          {consentForm(false)}
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                run(() => grantConsentAction({ contactId: contact.id, source: consent.source as never, proofText: consent.proofText, proofReference: consent.proofReference || undefined, capturedAt: new Date(consent.capturedAt) }), {
                  success: "ההסכמה נרשמה — איש הקשר כשיר לשליחה",
                  onSuccess: () => setDialog(null),
                })
              }
            >
              {pending ? <Spinner /> : null}
              רישום הסכמה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "resubscribe"} onOpenChange={(o) => setDialog(o ? "resubscribe" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>חידוש הרשמה לאחר הסרה</DialogTitle>
            <DialogDescription>
              מותר רק בעקבות הסכמה <strong>חדשה ומפורשת</strong> שניתנה <strong>אחרי</strong> בקשת ההסרה. ייבוא, סנכרון או שינוי ידני אינם מספיקים. הפעולה מתועדת ביומן הביקורת.
            </DialogDescription>
          </DialogHeader>
          {consentForm(true)}
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                run(() => resubscribeAction({ contactId: contact.id, source: consent.source as never, proofText: consent.proofText, proofReference: consent.proofReference || undefined, capturedAt: new Date(consent.capturedAt) }), {
                  success: "ההרשמה חודשה",
                  onSuccess: () => setDialog(null),
                })
              }
            >
              {pending ? <Spinner /> : null}
              חידוש הרשמה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
