"use client";

import { useState } from "react";
import { CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Pill, StatusBadge } from "@/components/app/badges";
import { useAction } from "@/hooks/use-action";
import { fmtDate } from "@/lib/format";
import { complianceReviewAction, confirmComplianceAction } from "./actions";

type Rule = {
  code: string;
  title: string;
  kind: "auto" | "attestation";
  required: boolean;
  basis: string;
  requirement: string;
  minEvidence: number;
  status: "PASSED" | "FAILED" | "NOT_STARTED" | "EXPIRED";
  detail: string;
  evidence: string;
  reviewedAt: string | null;
  expiresAt: string | null;
};

const STATUS_LABEL = { PASSED: "עבר", FAILED: "לא עבר", NOT_STARTED: "טרם נבדק", EXPIRED: "פג תוקף" };

export function CompliancePanel({ rules, ok, canWrite, defaultReviewer }: { rules: Rule[]; ok: boolean; canWrite: boolean; defaultReviewer: string }) {
  return (
    <div className="space-y-4">
      {ok ? (
        <Alert className="border-success/40">
          <ShieldCheck className="text-success" />
          <AlertTitle>הגדרת התאימות הושלמה</AlertTitle>
          <AlertDescription>אין צורך לאשר שוב בכל קמפיין. תזכורות לסקירה תקופתית מופיעות כאן ואינן חוסמות שליחה.</AlertDescription>
        </Alert>
      ) : canWrite ? (
        <OneTimeSetup rules={rules.filter((r) => r.kind === "attestation" && r.required && r.status !== "PASSED")} />
      ) : (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>נדרשת הגדרת תאימות חד-פעמית</AlertTitle>
          <AlertDescription>מנהל מערכת או בעלים צריכים להשלים אותה פעם אחת לפני הקמפיין הראשון.</AlertDescription>
        </Alert>
      )}
      <p className="text-xs text-muted-foreground">
        הכלים כאן הם בקרה תפעולית ואינם ייעוץ משפטי. אישור תבנית ע״י Meta אינו הוכחה שכל הצעה או שימוש מותרים — מומלץ לבצע סקירה משפטית לתוכן פיננסי.
      </p>
      {rules.map((r) => (
        <RuleCard key={r.code} rule={r} canWrite={canWrite} defaultReviewer={defaultReviewer} />
      ))}
    </div>
  );
}

function RuleCard({ rule, canWrite, defaultReviewer }: { rule: Rule; canWrite: boolean; defaultReviewer: string }) {
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState(rule.evidence);
  const [reviewer, setReviewer] = useState(defaultReviewer);
  const { run, pending } = useAction();
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {rule.status === "PASSED" ? <CheckCircle2 className="size-4 text-success" /> : <ShieldAlert className={rule.required ? "size-4 text-destructive" : "size-4 text-warning"} />}
              {rule.title}
              <Pill tone="muted">{rule.kind === "auto" ? "בדיקה אוטומטית" : "אישור חד-פעמי"}</Pill>
              {!rule.required ? <Pill tone="muted">המלצה — לא חוסם</Pill> : null}
            </CardTitle>
            <CardDescription>{rule.basis}</CardDescription>
          </div>
          <StatusBadge status={rule.status} label={STATUS_LABEL[rule.status]} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          <span className="font-medium">דרישה: </span>
          {rule.requirement}
        </p>
        <p className="text-muted-foreground">
          {rule.detail}
          {rule.reviewedAt ? ` · נבדק ${fmtDate(rule.reviewedAt)}` : ""}
          {rule.expiresAt ? ` · בתוקף עד ${fmtDate(rule.expiresAt)}` : ""}
        </p>
        {rule.kind === "auto" && rule.status !== "PASSED" ? <p className="text-muted-foreground">יש להשלים את הנתונים בלשונית &quot;פרטי העסק&quot; או &quot;הסרה&quot;.</p> : null}
        {rule.kind === "attestation" && open ? (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-1.5">
              <Label htmlFor={`ev-${rule.code}`}>הערות (לא חובה)</Label>
              <Textarea id={`ev-${rule.code}`} rows={4} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
            </div>
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor={`rv-${rule.code}`}>שם הבודק/ת</Label>
              <Input id={`rv-${rule.code}`} value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
            </div>
          </div>
        ) : null}
      </CardContent>
      {rule.kind === "attestation" && canWrite ? (
        <CardFooter className="gap-2">
          {!open ? (
            <Button variant="outline" onClick={() => setOpen(true)}>
              {rule.status === "PASSED" ? "עדכון סקירה" : "ביצוע סקירה"}
            </Button>
          ) : (
            <>
              <Button disabled={pending} onClick={() => run(() => complianceReviewAction({ ruleCode: rule.code, passed: true, evidence, reviewerName: reviewer }), { success: "הסקירה נרשמה", onSuccess: () => setOpen(false) })}>
                {pending ? <Spinner /> : null}
                אישור — הדרישה מתקיימת
              </Button>
              <Button variant="destructive" disabled={pending} onClick={() => run(() => complianceReviewAction({ ruleCode: rule.code, passed: false, evidence, reviewerName: reviewer }), { success: "נרשם: הדרישה אינה מתקיימת", onSuccess: () => setOpen(false) })}>
                הדרישה אינה מתקיימת
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                ביטול
              </Button>
            </>
          )}
        </CardFooter>
      ) : null}
    </Card>
  );
}

function OneTimeSetup({ rules }: { rules: Rule[] }) {
  const [notes, setNotes] = useState("");
  const { run, pending } = useAction();
  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          הגדרת תאימות חד-פעמית
        </CardTitle>
        <CardDescription>אישור אחד שמאפשר לשלוח קמפיינים — לא יידרש שוב בכל קמפיין. הוא נרשם ביומן הביקורת עם שמך והתאריך.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="font-medium">באישור אני מצהיר/ה ש:</p>
        <ul className="list-disc space-y-1.5 ps-5 text-muted-foreground">
          {rules.map((r) => (
            <li key={r.code}>
              <span className="font-medium text-foreground">{r.title}:</span> {r.requirement}
            </li>
          ))}
        </ul>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הערות (לא חובה) — למשל סוג ומספר רישיון, היכן נשמרים הטפסים" aria-label="הערות" />
      </CardContent>
      <CardFooter>
        <Button disabled={pending} onClick={() => run(() => confirmComplianceAction({ notes }), { success: "הגדרת התאימות הושלמה — אפשר לשלוח קמפיינים" })}>
          {pending ? <Spinner /> : <ShieldCheck />}
          אישור והשלמה
        </Button>
      </CardFooter>
    </Card>
  );
}
