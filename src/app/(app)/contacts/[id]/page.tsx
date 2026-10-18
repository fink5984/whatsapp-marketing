import Link from "next/link";
import { ArrowRight, Ban, MessageSquare, MousePointerClick, Send, ShieldCheck, ShieldX, Target } from "lucide-react";
import { requireAppContext } from "@/server/auth/current";
import { getContactDetail, listTags } from "@/server/services/contacts";
import { CONSENT_SOURCE_LABELS, CONSENT_STATUS_LABELS } from "@/server/services/consents";
import { SUPPRESSION_REASON_LABELS } from "@/server/services/suppression";
import { getSettings } from "@/server/services/settings";
import { META_ERROR_LABELS } from "@/server/meta/errors";
import { LEAD_STATUS_LABELS } from "@/server/services/leads";
import { PageHeader } from "@/components/app/page-header";
import { MESSAGE_STATUS_LABELS, Pill, StatusBadge } from "@/components/app/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatPhoneDisplay } from "@/lib/phone";
import { ELIGIBILITY_INFO, eligibilityOf } from "@/lib/consent";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { ContactActions } from "./contact-actions";

export const metadata = { title: "איש קשר" };

type Event = { at: Date; icon: typeof Send; title: string; detail?: string; tone?: "danger" | "success" | "warning" };

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAppContext("contacts:read");
  const { id } = await params;
  const [{ contact, outbound, inbound, clicks, suppressions, leads }, tags, settings] = await Promise.all([getContactDetail(ctx, id), listTags(ctx), getSettings(ctx.orgId)]);
  const tz = settings.timezone;
  const activeSuppression = suppressions.find((s) => !s.liftedAt);

  const events: Event[] = [
    ...outbound.map((m) => ({
      at: m.submittedAt ?? m.createdAt,
      icon: Send,
      title: `${m.kind === "CAMPAIGN" ? `קמפיין: ${m.campaign?.name ?? "—"}` : m.kind === "TEST" ? "הודעת בדיקה" : m.kind === "UNSUBSCRIBE_CONFIRMATION" ? "אישור הסרה" : "תשובת נציג"} — ${MESSAGE_STATUS_LABELS[m.status]}`,
      detail: m.errorCode ? (META_ERROR_LABELS[m.errorCode] ?? m.errorDetail ?? m.errorCode) : m.templateName ? `תבנית ${m.templateName}` : undefined,
      tone: m.status === "FAILED" ? ("danger" as const) : undefined,
    })),
    ...inbound.map((m) => ({ at: m.receivedAt, icon: m.isUnsubscribe ? Ban : MessageSquare, title: m.isUnsubscribe ? "בקשת הסרה התקבלה" : "הודעה נכנסת", detail: m.text ?? undefined, tone: m.isUnsubscribe ? ("warning" as const) : undefined })),
    ...clicks.map((c) => ({ at: c.clickedAt, icon: MousePointerClick, title: `הקלקה על "${c.link.name}"` })),
    ...contact.consents.map((c) => ({
      at: c.createdAt,
      icon: c.status === "GRANTED" ? ShieldCheck : ShieldX,
      title: c.status === "GRANTED" ? `הסכמה תועדה (${CONSENT_SOURCE_LABELS[c.source]})` : "הסכמה בוטלה",
      detail: c.proofText,
      tone: c.status === "GRANTED" ? ("success" as const) : ("danger" as const),
    })),
    ...leads.map((l) => ({ at: l.createdAt, icon: Target, title: `ליד נוצר — ${LEAD_STATUS_LABELS[l.status]}`, detail: l.source })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const latestGrant = contact.consents.find((c) => c.status === "GRANTED");

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
        <Link href="/contacts">
          <ArrowRight />
          אנשי קשר
        </Link>
      </Button>
      <PageHeader
        title={contact.name || "ללא שם"}
        description={<span className="ltr tabular">{formatPhoneDisplay(contact.phoneE164)}</span>}
        actions={
          <ContactActions
            contact={{ id: contact.id, name: contact.name, source: contact.source, notes: contact.notes, tagIds: contact.tags.map((t) => t.tagId), consent: contact.consentStatus, suppressed: contact.isSuppressed }}
            tags={tags.map((t) => ({ id: t.id, name: t.name }))}
            can={{
              write: ctx.can("contacts:write"),
              consent: ctx.can("consents:write"),
              suppress: ctx.can("suppression:write"),
              lift: ctx.can("suppression:lift"),
              del: ctx.can("contacts:delete"),
            }}
          />
        }
      >
        <div className="flex flex-wrap gap-2 pt-1">
          {contact.isSuppressed ? <StatusBadge status="REVOKED" label="ביקש/ה הסרה — חסום לשיווק" /> : <StatusBadge status={contact.consentStatus === "UNKNOWN" ? "NOT_STARTED" : contact.consentStatus} label={CONSENT_STATUS_LABELS[contact.consentStatus]} />}
          {contact.tags.map((t) => (
            <Pill key={t.tagId} tone="muted">
              {t.tag.name}
            </Pill>
          ))}
        </div>
      </PageHeader>

      {activeSuppression ? (
        <Alert variant="destructive" className="mb-6">
          <Ban />
          <AlertTitle>איש הקשר ברשימת ההסרה</AlertTitle>
          <AlertDescription>
            {SUPPRESSION_REASON_LABELS[activeSuppression.reason]} · {fmtDateTime(activeSuppression.createdAt, tz)}. לא יישלחו הודעות שיווקיות מאף מספר של העסק. חידוש אפשרי רק עם הסכמה חדשה, מפורשת ומתועדת.
          </AlertDescription>
        </Alert>
      ) : contact.consentStatus !== "GRANTED" ? (
        <Alert className="mb-6 border-warning/40">
          <ShieldX />
          <AlertTitle>{ELIGIBILITY_INFO[eligibilityOf(contact)].label} — לא יקבל/תקבל קמפיינים</AlertTitle>
          <AlertDescription>{ELIGIBILITY_INFO[eligibilityOf(contact)].explain}</AlertDescription>
        </Alert>
      ) : (
        <Alert className="mb-6 border-success/40">
          <ShieldCheck className="text-success" />
          <AlertTitle>כשיר/ה לשליחה</AlertTitle>
          <AlertDescription>יש הסכמה רשומה ואין בקשת הסרה. בכל שליחה המערכת בודקת זאת מחדש.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>פרטים</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Dt label="מקור">{contact.source ?? "—"}</Dt>
                <Dt label="נוסף">{fmtDateTime(contact.createdAt, tz)}</Dt>
                <Dt label="הודעות שנשלחו">{fmtNumber(contact.sentCount)}</Dt>
                <Dt label="נמסרו">{fmtNumber(contact.deliveredCount)}</Dt>
                <Dt label="נקראו (כשמדווח)">{fmtNumber(contact.readCount)}</Dt>
                <Dt label="הקלקות">{fmtNumber(contact.clickCount)}</Dt>
                <Dt label="שליחה אחרונה">{fmtDateTime(contact.lastSentAt, tz)}</Dt>
                <Dt label="הודעה נכנסת אחרונה">{fmtDateTime(contact.lastInboundAt, tz)}</Dt>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">קבוצות</dt>
                  <dd>{contact.audienceMembers.length ? contact.audienceMembers.map((a) => a.audience.name).join(", ") : "—"}</dd>
                </div>
                {contact.notes ? (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">הערות</dt>
                    <dd className="whitespace-pre-wrap">{contact.notes}</dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>הסכמה לשיווק</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {latestGrant && contact.consentStatus === "GRANTED" ? (
                <dl className="space-y-2">
                  <Dt label="מקור">{CONSENT_SOURCE_LABELS[latestGrant.source]}</Dt>
                  <Dt label="תאריך ההסכמה">{fmtDateTime(latestGrant.capturedAt, tz)}</Dt>
                  <Dt label="היקף">
                    {latestGrant.channel === "WHATSAPP" ? "WhatsApp" : latestGrant.channel} · {latestGrant.purpose === "MARKETING" ? "שיווק" : latestGrant.purpose} · {latestGrant.businessName}
                  </Dt>
                  <Dt label="נוסח / אסמכתה">
                    <span className="whitespace-pre-wrap">{latestGrant.proofText}</span>
                  </Dt>
                  {latestGrant.proofReference ? <Dt label="הפניה">{latestGrant.proofReference}</Dt> : null}
                </dl>
              ) : (
                <p className="text-muted-foreground">{contact.consentStatus === "REVOKED" ? "ההסכמה בוטלה." : "לא תועדה הסכמה."}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <Tabs defaultValue="activity" className="gap-0">
            <CardHeader className="pb-3">
              <TabsList>
                <TabsTrigger value="activity">היסטוריית פעילות</TabsTrigger>
                <TabsTrigger value="consents">יומן הסכמות והסרות</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent>
              <TabsContent value="activity">
                {events.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">אין פעילות מתועדת עדיין</p>
                ) : (
                  <ol className="relative space-y-4 border-s ps-6">
                    {events.map((e, i) => (
                      <li key={i} className="relative">
                        <span
                          className={`absolute -start-[33px] flex size-6 items-center justify-center rounded-full border bg-card ${e.tone === "danger" ? "text-destructive" : e.tone === "success" ? "text-success" : e.tone === "warning" ? "text-warning" : "text-muted-foreground"}`}
                        >
                          <e.icon className="size-3.5" />
                        </span>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-medium">{e.title}</span>
                          <time className="text-xs text-muted-foreground">{fmtDateTime(e.at, tz)}</time>
                        </div>
                        {e.detail ? <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{e.detail}</p> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </TabsContent>
              <TabsContent value="consents">
                <ul className="divide-y text-sm">
                  {[
                    ...contact.consents.map((c) => ({
                      at: c.createdAt,
                      label: c.status === "GRANTED" ? "הסכמה" : "ביטול הסכמה",
                      tone: c.status,
                      text: `${CONSENT_SOURCE_LABELS[c.source]} · ${c.proofText}`,
                    })),
                    ...suppressions.map((s) => ({
                      at: s.createdAt,
                      label: s.liftedAt ? `הסרה (בוטלה ${fmtDateTime(s.liftedAt, tz)})` : "הסרה פעילה",
                      tone: "REVOKED",
                      text: SUPPRESSION_REASON_LABELS[s.reason] + (s.detail ? ` · ${s.detail}` : ""),
                    })),
                  ]
                    .sort((a, b) => b.at.getTime() - a.at.getTime())
                    .map((r, i) => (
                      <li key={i} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:gap-4">
                        <time className="w-32 shrink-0 text-xs text-muted-foreground">{fmtDateTime(r.at, tz)}</time>
                        <StatusBadge status={r.tone} label={r.label} />
                        <span className="text-muted-foreground">{r.text}</span>
                      </li>
                    ))}
                </ul>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </div>
    </>
  );
}

function Dt({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
