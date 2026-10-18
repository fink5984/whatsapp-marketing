import Link from "next/link";
import { Ban } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import type { SuppressionReason } from "@/generated/prisma/enums";
import { requireAppContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { hashPhone } from "@/server/crypto";
import { SUPPRESSION_REASON_LABELS } from "@/server/services/suppression";
import { getSettings } from "@/server/services/settings";
import { PageHeader } from "@/components/app/page-header";
import { FilterSelect, SearchInput, TableToolbar } from "@/components/app/table-controls";
import { Pager } from "@/components/app/table-nav";
import { EmptyState } from "@/components/app/empty-state";
import { Pill, StatusBadge } from "@/components/app/badges";
import { StatCard } from "@/components/app/stat-card";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { normalizePhone, formatPhoneDisplay } from "@/lib/phone";
import { daysAgo, fmtDateTime, fmtNumber } from "@/lib/format";
import { spOne, spPage, type SP } from "@/lib/search-params";
import { AddSuppressionDialog } from "./add-dialog";

export const metadata = { title: "הסרות וחסימות" };
const PAGE_SIZE = 50;

export default async function SuppressionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireAppContext("contacts:read");
  const sp = await searchParams;
  const page = spPage(sp);
  const q = spOne(sp, "q");
  const reason = spOne(sp, "reason") as SuppressionReason | undefined;
  const state = spOne(sp, "state") ?? "active";
  const settings = await getSettings(ctx.orgId);

  const where: Prisma.SuppressionEntryWhereInput = {
    organizationId: ctx.orgId,
    reason: reason && reason in SUPPRESSION_REASON_LABELS ? reason : undefined,
    liftedAt: state === "lifted" ? { not: null } : state === "all" ? undefined : null,
  };
  if (q) {
    const p = normalizePhone(q, settings.defaultCountry);
    // Exact match by hash also finds entries whose number was erased (deleted contacts).
    where.OR = p.ok ? [{ phoneHash: hashPhone(p.e164) }] : [{ phoneE164: { contains: q.replace(/\D/g, "") } }, { detail: { contains: q, mode: "insensitive" } }];
  }
  const since30 = daysAgo(30);
  const [total, rows, active, last30, byReason] = await Promise.all([
    db.suppressionEntry.count({ where }),
    db.suppressionEntry.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.suppressionEntry.count({ where: { organizationId: ctx.orgId, liftedAt: null } }),
    db.suppressionEntry.count({ where: { organizationId: ctx.orgId, createdAt: { gte: since30 } } }),
    db.suppressionEntry.groupBy({ by: ["reason"], where: { organizationId: ctx.orgId, liftedAt: null }, _count: { _all: true } }),
  ]);
  const contactIds = rows.map((r) => r.contactId).filter(Boolean) as string[];
  const contacts = new Map((await db.contact.findMany({ where: { id: { in: contactIds }, organizationId: ctx.orgId }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const autoCount = byReason.filter((r) => ["KEYWORD_REPLY", "QUICK_REPLY_BUTTON", "META_USER_STOPPED_MARKETING"].includes(r.reason)).reduce((s, r) => s + r._count._all, 0);

  return (
    <>
      <PageHeader
        title="הסרות וחסימות"
        description="רשימת ההסרה חלה על כל מספרי השליחה של העסק ונבדקת גם ביצירת הקמפיין וגם רגע לפני כל שליחה. ייבוא או סנכרון אינם מבטלים הסרה."
        actions={ctx.can("suppression:write") ? <AddSuppressionDialog /> : null}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="חסומים כרגע" value={fmtNumber(active)} icon={Ban} quality="exact" tone="danger" />
        <StatCard label="הסרות ב-30 יום" value={fmtNumber(last30)} quality="exact" />
        <StatCard label="הסרות אוטומטיות (WhatsApp)" value={fmtNumber(autoCount)} quality="exact" hint="מילת הסרה, כפתור הסרה או חסימת שיווק דרך WhatsApp" />
      </div>
      <TableToolbar>
        <SearchInput placeholder="חיפוש לפי מספר טלפון" />
        <FilterSelect param="reason" placeholder="סיבה" options={Object.entries(SUPPRESSION_REASON_LABELS).map(([value, label]) => ({ value, label }))} />
        <FilterSelect
          param="state"
          placeholder="מצב"
          allLabel="פעילות"
          options={[
            { value: "lifted", label: "חודשה הרשמה" },
            { value: "all", label: "הכל" },
          ]}
        />
      </TableToolbar>
      {rows.length === 0 ? (
        <EmptyState icon={Ban} title="אין רשומות" description={q ? "המספר אינו ברשימת ההסרה." : "בקשות הסרה יופיעו כאן אוטומטית."} />
      ) : (
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>מספר</TableHead>
                <TableHead>איש קשר</TableHead>
                <TableHead>סיבה</TableHead>
                <TableHead className="hidden md:table-cell">פירוט</TableHead>
                <TableHead>מועד</TableHead>
                <TableHead>מצב</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.phoneE164 ? <span className="ltr tabular">{formatPhoneDisplay(r.phoneE164)}</span> : <Pill tone="muted">נמחק — נשמר גיבוב בלבד</Pill>}</TableCell>
                  <TableCell>
                    {r.contactId && contacts.has(r.contactId) ? (
                      <Link href={`/contacts/${r.contactId}`} className="hover:underline">
                        {contacts.get(r.contactId) || "ללא שם"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{SUPPRESSION_REASON_LABELS[r.reason]}</TableCell>
                  <TableCell className="hidden max-w-64 truncate text-muted-foreground md:table-cell">{r.detail ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDateTime(r.createdAt, settings.timezone)}</TableCell>
                  <TableCell>{r.liftedAt ? <StatusBadge status="PASSED" label="חודשה (הסכמה חדשה)" /> : <StatusBadge status="REVOKED" label="חסום" />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager path="/suppressions" sp={sp} page={page} pageSize={PAGE_SIZE} total={total} />
        </Card>
      )}
    </>
  );
}
