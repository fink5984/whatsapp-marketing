"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Ban, Clock, Send, Target } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { MESSAGE_STATUS_LABELS, Pill, StatusBadge } from "@/components/app/badges";
import { useAction } from "@/hooks/use-action";
import { formatPhoneDisplay } from "@/lib/phone";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createLeadFromConversationAction, sendReplyAction, updateConversationAction } from "./actions";

const STATUSES = [
  ["OPEN", "פתוחה"],
  ["NEEDS_AGENT", "ממתין לנציג"],
  ["INTERESTED", "מתעניין"],
  ["NOT_INTERESTED", "לא מעוניין"],
  ["HANDLED", "טופל"],
] as const;

type Msg = { id: string; direction: "in" | "out"; at: string; text: string | null; type: string; isUnsubscribe: boolean; status: string | null; label: string | null };

export function ConversationPanel({
  convo,
  timeline,
  windowOpen,
  windowClosesAt,
  members,
  canWrite,
  tz,
  backHref,
}: {
  convo: { id: string; status: string; assigneeId: string | null; notes: string | null; contact: { id: string; name: string | null; phone: string; suppressed: boolean; consent: string }; phone: string | null };
  timeline: Msg[];
  windowOpen: boolean;
  windowClosesAt: string | null;
  members: { id: string; name: string }[];
  canWrite: boolean;
  tz: string;
  backHref: string;
}) {
  const { run, pending } = useAction();
  const [reply, setReply] = useState("");
  const [notes, setNotes] = useState(convo.notes ?? "");
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-col gap-3 border-b py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" asChild className="lg:hidden">
            <Link href={backHref} aria-label="חזרה לרשימה">
              <ArrowRight />
            </Link>
          </Button>
          <div>
            <Link href={`/contacts/${convo.contact.id}`} className="font-semibold hover:underline">
              {convo.contact.name || "ללא שם"}
            </Link>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="ltr tabular">{formatPhoneDisplay(convo.contact.phone)}</span>
              {convo.contact.suppressed ? <Pill tone="danger">ביקש/ה הסרה</Pill> : convo.contact.consent === "GRANTED" ? <Pill tone="success">הסכמה מתועדת</Pill> : <Pill tone="muted">ללא הסכמה לשיווק</Pill>}
            </div>
          </div>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Select value={convo.status} onValueChange={(v) => run(() => updateConversationAction({ id: convo.id, status: v as never }), { success: "הסטטוס עודכן" })}>
              <SelectTrigger size="sm" className="w-36" aria-label="סטטוס שיחה">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={convo.assigneeId ?? "__none"} onValueChange={(v) => run(() => updateConversationAction({ id: convo.id, assigneeId: v === "__none" ? null : v }), { success: "השיוך עודכן" })}>
              <SelectTrigger size="sm" className="w-36" aria-label="שיוך לנציג">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">ללא שיוך</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => createLeadFromConversationAction({ conversationId: convo.id }), { success: "ליד נוצר" })}>
              <Target />
              יצירת ליד
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="max-h-[55svh] min-h-64 space-y-2 overflow-y-auto bg-wa-bg/60 p-4">
        {timeline.map((m) => (
          <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[80%] rounded-xl px-3 py-2 text-sm shadow-sm", m.direction === "out" ? "rounded-se-sm bg-wa-bubble-out" : "rounded-ss-sm bg-wa-bubble")}>
              {m.label ? <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">{m.label}</div> : null}
              {m.isUnsubscribe ? (
                <div className="mb-1 flex items-center gap-1 text-xs font-medium text-destructive">
                  <Ban className="size-3" />
                  בקשת הסרה — בוצעה אוטומטית
                </div>
              ) : null}
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
              <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
                {m.status ? <span>{MESSAGE_STATUS_LABELS[m.status] ?? m.status}</span> : null}
                <time suppressHydrationWarning title={fmtDateTime(m.at, tz)}>{fmtRelative(m.at)}</time>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
      {canWrite ? (
        <div className="space-y-3 border-t p-4">
          {windowOpen ? (
            <>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5" />
                חלון השירות פתוח עד {windowClosesAt ? fmtDateTime(windowClosesAt, tz) : ""}. תשובות שירות בלבד — לא תוכן שיווקי.
              </div>
              <div className="flex gap-2">
                <Textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="כתיבת תשובה…" aria-label="תשובה" className="min-h-10" />
                <Button disabled={pending || !reply.trim()} onClick={() => run(() => sendReplyAction({ id: convo.id, text: reply }), { success: "התשובה נשלחה", onSuccess: () => setReply("") })} className="self-end">
                  {pending ? <Spinner /> : <Send />}
                  שליחה
                </Button>
              </div>
            </>
          ) : (
            <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              חלון השירות של 24 שעות סגור. לפי כללי WhatsApp ניתן לפנות שוב רק בתבנית מאושרת — ובתוכן שיווקי רק לנמען עם הסכמה תקפה.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="cv-notes" className="text-xs">
              הערות פנימיות
            </Label>
            <Textarea
              id="cv-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== (convo.notes ?? "") && run(() => updateConversationAction({ id: convo.id, notes }), { success: "ההערה נשמרה" })}
              placeholder="גלויות לצוות בלבד"
            />
          </div>
          <div className="flex justify-end">
            <StatusBadge status={convo.status} label={STATUSES.find(([v]) => v === convo.status)?.[1]} />
          </div>
        </div>
      ) : null}
    </Card>
  );
}
