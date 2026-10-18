import Link from "next/link";
import {
  Ban,
  CheckCircle2,
  Circle,
  Clock,
  Contact,
  Eye,
  MailCheck,
  Megaphone,
  MessageCircleReply,
  MousePointerClick,
  Send,
  ShieldCheck,
  Target,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { requireAppContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { overview, dailySeries, campaignComparison } from "@/server/services/analytics";
import { evaluateCompliance } from "@/server/services/compliance";
import { CAMPAIGN_STATUS_LABELS } from "@/server/services/campaigns";
import { PageHeader, Section } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { StatusBadge } from "@/components/app/badges";
import { TimeLineChart, CategoryBarChart } from "@/components/app/charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtMoney, fmtNumber, fmtPercent, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "סקירה כללית" };

export default async function DashboardPage() {
  const ctx = await requireAppContext("reports:read");
  const [ov, series, comparison, compliance, accounts, templatesApproved, contacts, campaignsCount] = await Promise.all([
    overview(ctx, 30),
    dailySeries(ctx, 30),
    campaignComparison(ctx, 8),
    evaluateCompliance(ctx.orgId),
    db.whatsappAccount.findMany({ where: { organizationId: ctx.orgId }, select: { status: true } }),
    db.messageTemplate.count({ where: { organizationId: ctx.orgId, status: "APPROVED" } }),
    db.contact.count({ where: { organizationId: ctx.orgId } }),
    db.campaign.count({ where: { organizationId: ctx.orgId, status: { not: "DRAFT" } } }),
  ]);
  const m = ov.metrics;
  const steps = [
    { done: accounts.some((a) => a.status === "CONNECTED"), label: "חיבור חשבון WhatsApp Business", href: "/accounts" },
    { done: templatesApproved > 0, label: "סנכרון או יצירת תבנית מאושרת", href: "/templates" },
    { done: compliance.ok, label: "הגדרת תאימות חד-פעמית", href: "/settings?tab=compliance" },
    { done: contacts > 0, label: "ייבוא אנשי קשר עם מקור הסכמה", href: "/contacts/import" },
    { done: campaignsCount > 0, label: "שליחת קמפיין ראשון", href: "/campaigns/new" },
  ];
  const setupDone = steps.every((s) => s.done);
  const hasActivity = series.some((p) => p.sent || p.delivered || p.clicks);
  const delivered = m.delivered.value ?? 0;
  const sent = m.sent.value ?? 0;

  return (
    <>
      <PageHeader
        title={`שלום, ${ctx.user.name.split(" ")[0]}`}
        description="נתוני 30 הימים האחרונים. כל מדד מסומן לפי רמת הדיוק שלו: מדויק, חלקי או הערכה."
        actions={
          ctx.can("campaigns:write") ? (
            <Button asChild>
              <Link href="/campaigns/new">
                <Megaphone />
                קמפיין חדש
              </Link>
            </Button>
          ) : null
        }
      />

      {!setupDone ? (
        <Card className="mb-6 border-primary/30 bg-accent/40">
          <CardHeader>
            <CardTitle>הגדרת המערכת</CardTitle>
            <CardDescription>
              {steps.filter((s) => s.done).length} מתוך {steps.length} שלבים הושלמו. שליחת קמפיינים תתאפשר רק לאחר השלמת החיבור והתאימות.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {steps.map((s, i) => (
                <li key={s.label}>
                  <Link
                    href={s.href}
                    className={cn("flex h-full items-start gap-2 rounded-lg border bg-card p-3 text-sm transition-colors hover:border-primary/40", s.done && "opacity-70")}
                  >
                    {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                    <span>
                      <span className="text-muted-foreground">{i + 1}. </span>
                      {s.label}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      {!compliance.ok && setupDone ? (
        <Card className="mb-6 border-warning/40">
          <CardContent className="flex items-center gap-3 py-4 text-sm">
            <TriangleAlert className="size-5 text-warning" />
            סטטוס התאימות של העסק אינו תקין — הפעלת קמפיינים חסומה.
            <Button variant="link" asChild className="px-0">
              <Link href="/settings?tab=compliance">לבדיקות התאימות</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        <StatCard label="סך אנשי קשר" value={fmtNumber(m.totalContacts.value)} icon={Contact} quality="exact" />
        <StatCard label="כשירים לשיווק" value={fmtNumber(m.eligibleContacts.value)} icon={ShieldCheck} quality="exact" hint={m.eligibleContacts.hint} tone="primary" />
        <StatCard label="קמפיינים פעילים" value={fmtNumber(m.activeCampaigns.value)} icon={Megaphone} quality="exact" />
        <StatCard label="הודעות ממתינות" value={fmtNumber(m.pending.value)} icon={Clock} quality="exact" />
        <StatCard label="התקבלו ע״י Meta" value={fmtNumber(m.sent.value)} icon={Send} quality="exact" hint={m.sent.hint} />
        <StatCard label="נמסרו" value={fmtNumber(m.delivered.value)} icon={MailCheck} quality="partial" hint={m.delivered.hint} sub={sent ? `${fmtPercent(delivered / sent)} מההודעות` : undefined} />
        <StatCard label="נקראו" value={fmtNumber(m.read.value)} icon={Eye} quality="partial" hint={m.read.hint} sub={delivered ? `${fmtPercent((m.read.value ?? 0) / delivered)} מהנמסרות` : undefined} />
        <StatCard label="נכשלו" value={fmtNumber(m.failed.value)} icon={TriangleAlert} quality="exact" tone={(m.failed.value ?? 0) > 0 ? "danger" : "default"} />
        <StatCard label="קליקים" value={fmtNumber(m.clicks.value)} icon={MousePointerClick} quality="exact" hint={m.clicks.hint} sub={`${fmtNumber(m.uniqueClicks.value)} ייחודיים (הערכה)`} />
        <StatCard label="הסרות" value={fmtNumber(m.unsubscribes.value)} icon={Ban} quality="exact" tone={(m.unsubscribes.value ?? 0) > 0 ? "warning" : "default"} />
        <StatCard label="תגובות" value={fmtNumber(m.replies.value)} icon={MessageCircleReply} quality="exact" />
        <StatCard label="לידים" value={fmtNumber(m.leads.value)} icon={Target} quality="exact" tone="primary" />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <StatCard label="עלות משוערת" value={fmtMoney(m.estimatedCost.value, ov.currency)} icon={Wallet} quality="estimate" hint={m.estimatedCost.hint} />
        <StatCard label="עלות לפי סטטוס חיוב מ-Meta" value={fmtMoney(m.billableCost.value, ov.currency)} icon={Wallet} quality="estimate" hint={m.billableCost.hint} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>שליחות לפי ימים</CardTitle>
            <CardDescription>התקבלו ע״י Meta, נמסרו ונקראו (לפי חותמת הזמן של כל אירוע)</CardDescription>
          </CardHeader>
          <CardContent>
            {hasActivity ? (
              <TimeLineChart
                data={series}
                xKey="day"
                series={[
                  { key: "sent", label: "התקבלו", color: 2 },
                  { key: "delivered", label: "נמסרו", color: 1 },
                  { key: "read", label: "נקראו", color: 3 },
                ]}
              />
            ) : (
              <NoData />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>הקלקות והסרות</CardTitle>
            <CardDescription>קליקים אנושיים מול בקשות הסרה ליום</CardDescription>
          </CardHeader>
          <CardContent>
            {series.some((p) => p.clicks || p.unsubscribes) ? (
              <CategoryBarChart
                data={series.slice(-14)}
                xKey="day"
                series={[
                  { key: "clicks", label: "קליקים", color: 1 },
                  { key: "unsubscribes", label: "הסרות", color: 5 },
                ]}
              />
            ) : (
              <NoData />
            )}
          </CardContent>
        </Card>
      </div>

      <Section title="קמפיינים אחרונים" className="mt-6" actions={<Button variant="link" asChild className="px-0"><Link href="/campaigns">לכל הקמפיינים</Link></Button>}>
        <Card className="py-0">
          {comparison.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">עדיין לא הופעלו קמפיינים.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>קמפיין</TableHead>
                  <TableHead>סטטוס</TableHead>
                  <TableHead className="text-end">נמענים</TableHead>
                  <TableHead className="text-end">אחוז מסירה</TableHead>
                  <TableHead className="text-end">אחוז קריאה</TableHead>
                  <TableHead className="text-end">קליקים</TableHead>
                  <TableHead className="text-end">לידים</TableHead>
                  <TableHead className="text-end">הסרות</TableHead>
                  <TableHead>הופעל</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparison.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <Link href={`/campaigns/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} label={CAMPAIGN_STATUS_LABELS[c.status]} />
                    </TableCell>
                    <TableCell className="tabular text-end">{fmtNumber(c.eligibleCount)}</TableCell>
                    <TableCell className="tabular text-end">{fmtPercent(c.deliveryRate)}</TableCell>
                    <TableCell className="tabular text-end">{fmtPercent(c.readRate)}</TableCell>
                    <TableCell className="tabular text-end">{fmtNumber(c.clicks)}</TableCell>
                    <TableCell className="tabular text-end">{fmtNumber(c.leads)}</TableCell>
                    <TableCell className="tabular text-end">{fmtNumber(c.unsubscribes)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtRelative(c.launchedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </Section>
    </>
  );
}

function NoData() {
  return <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">אין עדיין נתונים לתקופה זו</div>;
}
