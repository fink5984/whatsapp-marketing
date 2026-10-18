import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import type { CampaignStatus } from "@/generated/prisma/enums";
import { requireAppContext } from "@/server/auth/current";
import { CAMPAIGN_STATUS_LABELS, listCampaigns } from "@/server/services/campaigns";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { FilterSelect, SearchInput, TableToolbar } from "@/components/app/table-controls";
import { Pager } from "@/components/app/table-nav";
import { StatusBadge } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime, fmtNumber, fmtPercent } from "@/lib/format";
import { spOne, spPage, type SP } from "@/lib/search-params";

export const metadata = { title: "קמפיינים" };
const PAGE_SIZE = 25;

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireAppContext("campaigns:read");
  const sp = await searchParams;
  const page = spPage(sp);
  const status = spOne(sp, "status") as CampaignStatus | undefined;
  const { total, rows } = await listCampaigns(ctx, { status: status && status in CAMPAIGN_STATUS_LABELS ? status : undefined, q: spOne(sp, "q"), page, pageSize: PAGE_SIZE });
  return (
    <>
      <PageHeader
        title="קמפיינים"
        description="כל קמפיין נשלח רק לנמענים עם הסכמה תקפה, ונבדק מול רשימת ההסרה גם בהפעלה וגם רגע לפני כל הודעה."
        actions={
          ctx.can("campaigns:write") ? (
            <Button asChild>
              <Link href="/campaigns/new">
                <Plus />
                קמפיין חדש
              </Link>
            </Button>
          ) : null
        }
      />
      <TableToolbar>
        <SearchInput placeholder="חיפוש קמפיין" />
        <FilterSelect param="status" placeholder="סטטוס" options={Object.entries(CAMPAIGN_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
      </TableToolbar>
      {rows.length === 0 ? (
        <EmptyState icon={Megaphone} title="אין קמפיינים" description="צרו קמפיין ראשון: בחירת תבנית מאושרת, קהל, הגדרות שליחה ואישור.">
          {ctx.can("campaigns:write") ? (
            <Button asChild>
              <Link href="/campaigns/new">קמפיין חדש</Link>
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>קמפיין</TableHead>
                <TableHead>סטטוס</TableHead>
                <TableHead className="min-w-40">התקדמות</TableHead>
                <TableHead className="text-end">נמענים</TableHead>
                <TableHead className="hidden text-end md:table-cell">נמסרו</TableHead>
                <TableHead className="hidden text-end md:table-cell">נקראו</TableHead>
                <TableHead className="hidden text-end lg:table-cell">נכשלו</TableHead>
                <TableHead className="hidden lg:table-cell">תבנית</TableHead>
                <TableHead className="hidden sm:table-cell">מועד</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => {
                const s = c.stats;
                const done = s.total - s.QUEUED - s.SENDING;
                const delivered = s.DELIVERED + s.READ;
                const accepted = s.SUBMITTED + s.SENT + delivered + s.FAILED;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <Link href={c.status === "DRAFT" ? `/campaigns/${c.id}/setup` : `/campaigns/${c.id}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} label={CAMPAIGN_STATUS_LABELS[c.status]} />
                    </TableCell>
                    <TableCell>
                      {c.status === "DRAFT" ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Progress value={s.total ? (done / s.total) * 100 : 0} className="h-1.5" />
                          <span className="tabular w-10 text-xs text-muted-foreground">{fmtPercent(s.total ? done / s.total : 0, 0)}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-end">{fmtNumber(c.eligibleCount || null)}</TableCell>
                    <TableCell className="tabular hidden text-end md:table-cell">
                      {fmtNumber(delivered)} <span className="text-xs text-muted-foreground">({fmtPercent(accepted ? delivered / accepted : null, 0)})</span>
                    </TableCell>
                    <TableCell className="tabular hidden text-end md:table-cell">{fmtNumber(s.READ)}</TableCell>
                    <TableCell className="tabular hidden text-end lg:table-cell">{fmtNumber(s.FAILED)}</TableCell>
                    <TableCell className="ltr hidden text-sm text-muted-foreground lg:table-cell">{c.template?.name ?? "—"}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{fmtDateTime(c.scheduledAt ?? c.launchedAt ?? c.createdAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Pager path="/campaigns" sp={sp} page={page} pageSize={PAGE_SIZE} total={total} />
        </Card>
      )}
    </>
  );
}
