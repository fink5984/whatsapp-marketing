import Link from "next/link";
import { requireAppContext } from "@/server/auth/current";
import { campaignComparison, dailySeries, overview } from "@/server/services/analytics";
import { CAMPAIGN_STATUS_LABELS } from "@/server/services/campaigns";
import { PageHeader } from "@/components/app/page-header";
import { QualityTag, StatusBadge } from "@/components/app/badges";
import { StatCard } from "@/components/app/stat-card";
import { CategoryBarChart, TimeLineChart } from "@/components/app/charts";
import { FilterSelect } from "@/components/app/table-controls";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtMoney, fmtNumber, fmtPercent } from "@/lib/format";
import { spOne, type SP } from "@/lib/search-params";

export const metadata = { title: "דוחות ואנליטיקה" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireAppContext("reports:read");
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(spOne(sp, "days"))) ? Number(spOne(sp, "days")) : 30;
  const [ov, series, comparison] = await Promise.all([overview(ctx, days), dailySeries(ctx, days), campaignComparison(ctx, 15)]);
  const m = ov.metrics;
  const withRates = series.map((p) => ({ ...p, deliveryRate: p.sent ? Math.round((p.delivered / p.sent) * 1000) / 10 : null, readRate: p.delivered ? Math.round((p.read / p.delivered) * 1000) / 10 : null }));
  const empty = <div className="flex h-[260px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">אין נתונים לתקופה</div>;
  const hasMsgs = series.some((p) => p.sent || p.delivered);

  return (
    <>
      <PageHeader
        title="דוחות ואנליטיקה"
        description="מדויק = נספר במערכת. חלקי = תלוי בדיווח Meta (קריאה אינה מדווחת לכל נמען). הערכה = חישוב (עלות, קליקים ייחודיים)."
        actions={
          <FilterSelect
            param="days"
            placeholder="תקופה"
            allLabel="30 יום"
            options={[
              { value: "7", label: "7 ימים" },
              { value: "90", label: "90 ימים" },
            ]}
          />
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <QualityTag quality="exact" /> נספר ישירות
        </span>
        <span className="flex items-center gap-1.5">
          <QualityTag quality="partial" /> תלוי בדיווח Meta
        </span>
        <span className="flex items-center gap-1.5">
          <QualityTag quality="estimate" /> חישוב משוער
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="התקבלו ע״י Meta" value={fmtNumber(m.sent.value)} quality="exact" hint={m.sent.hint} />
        <StatCard label="יחס מסירה" value={fmtPercent(m.sent.value ? (m.delivered.value ?? 0) / m.sent.value : null)} quality="partial" sub={`${fmtNumber(m.delivered.value)} נמסרו`} />
        <StatCard label="יחס קריאה" value={fmtPercent(m.delivered.value ? (m.read.value ?? 0) / m.delivered.value : null)} quality="partial" sub={`${fmtNumber(m.read.value)} נקראו`} hint={m.read.hint} />
        <StatCard label="עלות משוערת" value={fmtMoney(m.estimatedCost.value, ov.currency)} quality="estimate" hint={m.estimatedCost.hint} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>שליחות לפי ימים</CardTitle>
          </CardHeader>
          <CardContent>
            {hasMsgs ? (
              <TimeLineChart
                data={series}
                xKey="day"
                series={[
                  { key: "sent", label: "התקבלו", color: 2 },
                  { key: "delivered", label: "נמסרו", color: 1 },
                  { key: "read", label: "נקראו", color: 3 },
                  { key: "failed", label: "נכשלו", color: 5 },
                ]}
              />
            ) : (
              empty
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>יחסי מסירה וקריאה (%)</CardTitle>
            <CardDescription>לפי יום האירוע — נתון חלקי</CardDescription>
          </CardHeader>
          <CardContent>
            {hasMsgs ? (
              <TimeLineChart
                data={withRates}
                xKey="day"
                valueFormat="percent"
                series={[
                  { key: "deliveryRate", label: "יחס מסירה", color: 1 },
                  { key: "readRate", label: "יחס קריאה", color: 3 },
                ]}
              />
            ) : (
              empty
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>הקלקות לפי קמפיין</CardTitle>
          </CardHeader>
          <CardContent>
            {comparison.some((c) => c.clicks) ? (
              <CategoryBarChart
                horizontal
                height={Math.max(200, comparison.length * 36)}
                data={comparison.map((c) => ({ name: c.name, clicks: c.clicks, leads: c.leads }))}
                xKey="name"
                series={[
                  { key: "clicks", label: "קליקים", color: 1 },
                  { key: "leads", label: "לידים", color: 2 },
                ]}
              />
            ) : (
              empty
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>בקשות הסרה</CardTitle>
          </CardHeader>
          <CardContent>{series.some((p) => p.unsubscribes) ? <CategoryBarChart data={series} xKey="day" series={[{ key: "unsubscribes", label: "הסרות", color: 5 }]} /> : empty}</CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              עלויות לאורך זמן <QualityTag quality="estimate" />
            </CardTitle>
            <CardDescription>הודעות תבנית × התעריף שהוגדר בהגדרות. החשבונית של Meta היא המקור הקובע.</CardDescription>
          </CardHeader>
          <CardContent>
            {series.some((p) => p.cost) ? <TimeLineChart area data={series} xKey="day" valueFormat={{ currency: ov.currency }} series={[{ key: "cost", label: "עלות משוערת", color: 2 }]} /> : <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">{m.estimatedCost.value === null ? "לא הוגדרו תעריפים (הגדרות ← עלויות)" : "אין נתונים לתקופה"}</div>}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 gap-0 py-0">
        <CardHeader className="py-4">
          <CardTitle>השוואת קמפיינים</CardTitle>
        </CardHeader>
        {comparison.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">אין קמפיינים להשוואה</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>קמפיין</TableHead>
                  <TableHead>סטטוס</TableHead>
                  <TableHead className="text-end">התקבלו</TableHead>
                  <TableHead className="text-end">מסירה</TableHead>
                  <TableHead className="text-end">קריאה</TableHead>
                  <TableHead className="text-end">נכשלו</TableHead>
                  <TableHead className="text-end">קליקים</TableHead>
                  <TableHead className="text-end">תגובות</TableHead>
                  <TableHead className="text-end">לידים</TableHead>
                  <TableHead className="text-end">הסרות</TableHead>
                  <TableHead className="text-end">עלות משוערת</TableHead>
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
                    <TableCell className="tabular text-end">{fmtNumber(c.accepted)}</TableCell>
                    <TableCell className="tabular text-end">{fmtPercent(c.deliveryRate)}</TableCell>
                    <TableCell className="tabular text-end">{fmtPercent(c.readRate)}</TableCell>
                    <TableCell className="tabular text-end">{fmtNumber(c.failed)}</TableCell>
                    <TableCell className="tabular text-end">{fmtNumber(c.clicks)}</TableCell>
                    <TableCell className="tabular text-end">{fmtNumber(c.replies)}</TableCell>
                    <TableCell className="tabular text-end">{fmtNumber(c.leads)}</TableCell>
                    <TableCell className="tabular text-end">{fmtNumber(c.unsubscribes)}</TableCell>
                    <TableCell className="tabular text-end">{fmtMoney(c.estimatedCost, c.costCurrency ?? ov.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
