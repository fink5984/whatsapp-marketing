import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Ban, Download, Eye, MailCheck, MessageCircleReply, MousePointerClick, Send, Target, TriangleAlert, Users, Wallet } from "lucide-react";
import { requireAppContext } from "@/server/auth/current";
import { CAMPAIGN_STATUS_LABELS, EXCLUSION_LABELS, getCampaign } from "@/server/services/campaigns";
import { campaignRecipients, campaignReport } from "@/server/services/analytics";
import { linkStats } from "@/server/services/links";
import { getSettings } from "@/server/services/settings";
import { META_ERROR_LABELS } from "@/server/meta/errors";
import { PageHeader } from "@/components/app/page-header";
import { MESSAGE_STATUS_LABELS, StatusBadge } from "@/components/app/badges";
import { StatCard } from "@/components/app/stat-card";
import { FilterSelect, SearchInput, TableToolbar } from "@/components/app/table-controls";
import { Pager } from "@/components/app/table-nav";
import { TimeLineChart } from "@/components/app/charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPhoneDisplay } from "@/lib/phone";
import { fmtDateTime, fmtMoney, fmtNumber, fmtPercent } from "@/lib/format";
import { spOne, spPage, type SP } from "@/lib/search-params";
import { CampaignControls, AutoRefresh } from "./campaign-controls";

export const metadata = { title: "דוח קמפיין" };
const PAGE_SIZE = 50;

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireAppContext("campaigns:read");
  const { id } = await params;
  const sp = await searchParams;
  const c = await getCampaign(ctx, id);
  if (c.status === "DRAFT") redirect(`/campaigns/${id}/setup`);
  const page = spPage(sp);
  const [report, recipients, links, settings] = await Promise.all([
    campaignReport(ctx, id),
    campaignRecipients(ctx, id, { status: spOne(sp, "status"), q: spOne(sp, "q"), page, pageSize: PAGE_SIZE }),
    linkStats(ctx, undefined).then((all) => all.filter((l) => l.id === c.trackedLinkId || l.campaignId === id)),
    getSettings(ctx.orgId),
  ]);
  const tz = settings.timezone;
  const s = report.stats ?? { QUEUED: 0, SENDING: 0, SUBMITTED: 0, SENT: 0, DELIVERED: 0, READ: 0, FAILED: 0, SKIPPED: 0, CANCELLED: 0, UNCERTAIN: 0, total: 0 };
  const accepted = s.SUBMITTED + s.SENT + s.DELIVERED + s.READ + s.FAILED;
  const delivered = s.DELIVERED + s.READ;
  const pendingCount = s.QUEUED + s.SENDING;
  const processed = s.total - pendingCount;
  const clicks = links.reduce((sum, l) => sum + l.total, 0);
  const uniqueClicks = links.reduce((sum, l) => sum + l.unique, 0);
  const live = ["RUNNING", "QUEUED", "SCHEDULED"].includes(c.status);

  return (
    <>
      {live ? <AutoRefresh seconds={10} /> : null}
      <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
        <Link href="/campaigns">
          <ArrowRight />
          קמפיינים
        </Link>
      </Button>
      <PageHeader
        title={c.name}
        description={c.description ?? undefined}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/campaigns/${id}/export`}>
                <Download />
                ייצוא נמענים
              </a>
            </Button>
            <CampaignControls id={id} status={c.status} uncertain={report.uncertainRequeueable} canLaunch={ctx.can("campaigns:launch")} canWrite={ctx.can("campaigns:write")} />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-sm text-muted-foreground">
          <StatusBadge status={c.status} label={CAMPAIGN_STATUS_LABELS[c.status]} />
          <span>
            תבנית: <span className="ltr">{c.template?.name}</span>
          </span>
          <span>
            שולח: <span className="ltr">{c.phoneNumber?.displayPhoneNumber}</span>
          </span>
          {c.scheduledAt ? <span>מתוזמן: {fmtDateTime(c.scheduledAt, tz)}</span> : null}
          {c.launchedAt ? <span>הופעל: {fmtDateTime(c.launchedAt, tz)}</span> : null}
          {c.completedAt ? <span>הסתיים: {fmtDateTime(c.completedAt, tz)}</span> : null}
        </div>
      </PageHeader>

      {c.status === "PAUSED" && c.pausedReason ? (
        <Alert className="mb-6 border-warning/40">
          <TriangleAlert />
          <AlertTitle>הקמפיין מושהה</AlertTitle>
          <AlertDescription>{c.pausedReason}</AlertDescription>
        </Alert>
      ) : null}
      {s.UNCERTAIN > 0 ? (
        <Alert className="mb-6 border-warning/40">
          <TriangleAlert />
          <AlertTitle>{fmtNumber(s.UNCERTAIN)} הודעות במצב &quot;לא ודאי&quot;</AlertTitle>
          <AlertDescription>
            לא התקבל אישור מ-Meta (תקלת רשת או נפילת שרת). ייתכן שההודעות נשלחו בפועל, ולכן הן לא נשלחות שוב אוטומטית. אם יגיע אישור מסירה הן יתעדכנו מעצמן. שליחה חוזרת ידנית אפשרית לאחר 30 דקות ועלולה לגרום לכפילות.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-6">
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">התקדמות</span>
            <span className="tabular text-muted-foreground">
              {fmtNumber(processed)} / {fmtNumber(s.total)} עובדו · {fmtNumber(pendingCount)} בתור
            </span>
          </div>
          <Progress value={s.total ? (processed / s.total) * 100 : 0} className="h-2" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-8">
        <StatCard label="נמענים כשירים" value={fmtNumber(c.eligibleCount)} icon={Users} quality="exact" sub={`${fmtNumber(c.excludedCount)} נפסלו`} />
        <StatCard label="התקבלו ע״י Meta" value={fmtNumber(accepted)} icon={Send} quality="exact" hint="אישור API שהבקשה התקבלה — אינו מסירה" />
        <StatCard label="נמסרו" value={fmtNumber(delivered)} icon={MailCheck} quality="partial" sub={fmtPercent(accepted ? delivered / accepted : null)} />
        <StatCard label="נקראו" value={fmtNumber(s.READ)} icon={Eye} quality="partial" hint="לא כל הנמענים מדווחים קריאה" sub={fmtPercent(delivered ? s.READ / delivered : null)} />
        <StatCard label="נכשלו" value={fmtNumber(s.FAILED)} icon={TriangleAlert} quality="exact" tone={s.FAILED ? "danger" : "default"} />
        <StatCard label="קליקים" value={fmtNumber(clicks)} icon={MousePointerClick} quality="exact" sub={`${fmtNumber(uniqueClicks)} ייחודיים`} />
        <StatCard label="תגובות / לידים" value={`${fmtNumber(report.replies)} / ${fmtNumber(report.leads)}`} icon={MessageCircleReply} quality="exact" />
        <StatCard label="הסרות מהקמפיין" value={fmtNumber(report.unsubscribes)} icon={Ban} quality="exact" tone={report.unsubscribes ? "warning" : "default"} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>התקדמות לפי שעה</CardTitle>
          </CardHeader>
          <CardContent>
            {report.hourly.length ? (
              <TimeLineChart
                data={report.hourly}
                xKey="hour"
                series={[
                  { key: "sent", label: "התקבלו", color: 2 },
                  { key: "delivered", label: "נמסרו", color: 1 },
                  { key: "read", label: "נקראו", color: 3 },
                ]}
              />
            ) : (
              <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{c.status === "SCHEDULED" ? "הקמפיין טרם התחיל" : "אין עדיין נתונים"}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>פירוט סטטוסים</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {(["QUEUED", "SUBMITTED", "SENT", "DELIVERED", "READ", "FAILED", "SKIPPED", "CANCELLED", "UNCERTAIN"] as const).map((k) => (
                <li key={k} className="flex items-center justify-between">
                  <StatusBadge status={k} label={MESSAGE_STATUS_LABELS[k]} />
                  <span className="tabular font-medium">{fmtNumber(s[k])}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 border-t pt-4 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Wallet className="size-4" />
                עלות
              </div>
              <dl className="mt-2 space-y-1">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">משוערת בהפעלה (הערכה)</dt>
                  <dd className="tabular">{fmtMoney(report.cost.estimated, report.cost.currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">לפי סימון חיוב מ-Meta (הערכה)</dt>
                  <dd className="tabular">
                    {fmtMoney(report.cost.billableCost, report.cost.currency)} <span className="text-xs text-muted-foreground">({fmtNumber(report.cost.billableMessages)} הודעות)</span>
                  </dd>
                </div>
              </dl>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>סיבות כישלון ודילוג</CardTitle>
          </CardHeader>
          <CardContent>
            {report.failures.length ? (
              <ul className="space-y-2 text-sm">
                {report.failures.map((f) => (
                  <li key={f.code} className="flex items-start justify-between gap-3">
                    <span>
                      <span className="ltr text-xs text-muted-foreground">{f.code}</span> {META_ERROR_LABELS[f.code] ?? ""}
                    </span>
                    <span className="tabular font-medium">{fmtNumber(f.count)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">אין כישלונות</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>נפסלו בעת ההפעלה</CardTitle>
          </CardHeader>
          <CardContent>
            {report.exclusions.length ? (
              <ul className="space-y-2 text-sm">
                {report.exclusions.map((e) => (
                  <li key={e.reason} className="flex justify-between">
                    <span>{EXCLUSION_LABELS[e.reason] ?? e.reason}</span>
                    <span className="tabular font-medium">{fmtNumber(e.count)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">אף נמען לא נפסל</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>קישורים וקליקים</CardTitle>
            <CardDescription>ללא בוטים ותצוגות מקדימות</CardDescription>
          </CardHeader>
          <CardContent>
            {links.length ? (
              <ul className="space-y-3 text-sm">
                {links.map((l) => (
                  <li key={l.id}>
                    <div className="flex justify-between font-medium">
                      <span>{l.name}</span>
                      <span className="tabular">
                        {fmtNumber(l.total)} <span className="text-xs font-normal text-muted-foreground">({fmtNumber(l.unique)} ייחודיים)</span>
                      </span>
                    </div>
                    <div className="ltr truncate text-xs text-muted-foreground">{l.destinationUrl}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">לא הוגדר קישור מעקב לקמפיין זה</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 gap-0 py-0">
        <CardHeader className="py-4">
          <CardTitle>נמענים</CardTitle>
        </CardHeader>
        <div className="px-4">
          <TableToolbar>
            <SearchInput placeholder="חיפוש לפי שם או טלפון" />
            <FilterSelect param="status" placeholder="סטטוס" options={[...Object.entries(MESSAGE_STATUS_LABELS).map(([value, label]) => ({ value, label })), { value: "EXCLUDED", label: "נפסלו" }]} />
          </TableToolbar>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>נמען</TableHead>
              <TableHead>טלפון</TableHead>
              <TableHead>סטטוס</TableHead>
              <TableHead className="hidden md:table-cell">נשלח</TableHead>
              <TableHead className="hidden md:table-cell">נמסר</TableHead>
              <TableHead className="hidden lg:table-cell">נקרא</TableHead>
              <TableHead className="hidden lg:table-cell">פירוט</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recipients.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  {r.contact ? (
                    <Link href={`/contacts/${r.contact.id}`} className="hover:underline">
                      {r.contact.name || "ללא שם"}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">נמחק</span>
                  )}
                </TableCell>
                <TableCell className="ltr tabular text-sm">{r.phoneE164 ? formatPhoneDisplay(r.phoneE164) : "—"}</TableCell>
                <TableCell>
                  {r.eligibility === "EXCLUDED" ? <StatusBadge status="SKIPPED" label="נפסל" /> : r.message ? <StatusBadge status={r.message.status} label={MESSAGE_STATUS_LABELS[r.message.status]} /> : "—"}
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{fmtDateTime(r.message?.submittedAt, tz)}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{fmtDateTime(r.message?.deliveredAt, tz)}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{r.message?.readAt ? fmtDateTime(r.message.readAt, tz) : r.message?.deliveredAt ? "לא ידוע" : "—"}</TableCell>
                <TableCell className="hidden max-w-64 truncate text-sm text-muted-foreground lg:table-cell">
                  {r.eligibility === "EXCLUDED" ? (EXCLUSION_LABELS[r.exclusionReason ?? ""] ?? r.exclusionReason) : r.message?.errorCode ? (META_ERROR_LABELS[r.message.errorCode] ?? r.message.errorDetail ?? r.message.errorCode) : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager path={`/campaigns/${id}`} sp={sp} page={page} pageSize={PAGE_SIZE} total={recipients.total} />
      </Card>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Target className="size-3.5" />
        &quot;נקרא — לא ידוע&quot;: ההודעה נמסרה אך הנמען אינו משתף אישורי קריאה.
      </p>
    </>
  );
}
