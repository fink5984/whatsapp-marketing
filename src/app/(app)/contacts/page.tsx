import Link from "next/link";
import { Contact, Download, Upload } from "lucide-react";
import { requireAppContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { listContacts, listTags, distinctSources, type ContactSort } from "@/server/services/contacts";
import { filterFromSearchParams } from "@/server/services/contact-filter";
import { listAudiences } from "@/server/services/audiences";
import { CONSENT_STATUS_LABELS } from "@/server/services/consents";
import { PageHeader } from "@/components/app/page-header";
import { FilterSelect, SearchInput, TableToolbar } from "@/components/app/table-controls";
import { Pager } from "@/components/app/table-nav";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { spOne, spPage, type SP } from "@/lib/search-params";
import { ContactsTable } from "./contacts-table";
import { NewContactDialog } from "./new-contact-dialog";

export const metadata = { title: "אנשי קשר" };
const PAGE_SIZE = 50;
const SORTS: ContactSort[] = ["createdAt", "name", "lastSentAt", "sentCount", "clickCount"];

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireAppContext("contacts:read");
  const sp = await searchParams;
  const page = spPage(sp);
  const filter = filterFromSearchParams(sp);
  const sortParam = spOne(sp, "sort") as ContactSort | undefined;
  const sort = sortParam && SORTS.includes(sortParam) ? sortParam : "createdAt";
  const dir = spOne(sp, "dir") === "asc" ? "asc" : "desc";
  const [{ total, rows }, tags, audiences, sources, counts] = await Promise.all([
    listContacts(ctx, filter, { page, pageSize: PAGE_SIZE, sort, dir }),
    listTags(ctx),
    listAudiences(ctx),
    distinctSources(ctx),
    Promise.all([
      db.contact.count({ where: { organizationId: ctx.orgId, consentStatus: "GRANTED", isSuppressed: false } }),
      db.contact.count({ where: { organizationId: ctx.orgId, consentStatus: "UNKNOWN", isSuppressed: false } }),
      db.contact.count({ where: { organizationId: ctx.orgId, OR: [{ isSuppressed: true }, { consentStatus: "REVOKED" }] } }),
    ]),
  ]);
  const hasFilters = Object.keys(filter).length > 0;
  const exportQuery = new URLSearchParams(Object.entries(sp).filter(([k, v]) => typeof v === "string" && !["page", "sort", "dir"].includes(k)) as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="אנשי קשר"
        description="קמפיינים נשלחים רק לאנשי קשר עם הסכמה רשומה שלא ביקשו הסרה. מספר פעיל ב-WhatsApp לבדו אינו הסכמה."
        actions={
          <>
            {ctx.can("contacts:export") ? (
              <Button variant="outline" asChild>
                <a href={`/contacts/export${exportQuery ? `?${exportQuery}` : ""}`}>
                  <Download />
                  ייצוא CSV
                </a>
              </Button>
            ) : null}
            {ctx.can("contacts:write") ? (
              <>
                <Button variant="outline" asChild>
                  <Link href="/contacts/import">
                    <Upload />
                    ייבוא
                  </Link>
                </Button>
                <NewContactDialog tags={tags.map((t) => ({ id: t.id, name: t.name }))} />
              </>
            ) : null}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-3 gap-2 sm:max-w-2xl">
        {[
          { href: "/contacts?consent=GRANTED&suppressed=0", n: counts[0], label: "כשירים לשליחה", cls: "text-success" },
          { href: "/contacts?consent=UNKNOWN&suppressed=0", n: counts[1], label: "אין הסכמה רשומה", cls: "text-[color-mix(in_oklch,var(--warning),black_35%)]" },
          { href: "/contacts?suppressed=1", n: counts[2], label: "הוסרו / ביטלו", cls: "text-destructive" },
        ].map((x) => (
          <Link key={x.label} href={x.href} className="rounded-lg border bg-card px-3 py-2 transition-colors hover:border-primary/40">
            <div className={`tabular text-lg font-semibold ${x.cls}`}>{x.n.toLocaleString("he-IL")}</div>
            <div className="text-xs text-muted-foreground">{x.label}</div>
          </Link>
        ))}
      </div>
      <TableToolbar>
        <SearchInput placeholder="חיפוש לפי שם, טלפון או הערה" />
        <FilterSelect param="consent" placeholder="הסכמה" options={Object.entries(CONSENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
        <FilterSelect
          param="suppressed"
          placeholder="הסרה"
          options={[
            { value: "0", label: "לא הוסרו" },
            { value: "1", label: "ביקשו הסרה" },
          ]}
        />
        {tags.length ? <FilterSelect param="tags" placeholder="תגית" options={tags.map((t) => ({ value: t.id, label: t.name }))} /> : null}
        {audiences.length ? <FilterSelect param="audiences" placeholder="קבוצה" options={audiences.map((a) => ({ value: a.id, label: a.name }))} /> : null}
        {sources.length ? <FilterSelect param="sources" placeholder="מקור" options={sources.map((s) => ({ value: s, label: s }))} /> : null}
        <FilterSelect
          param="activity"
          placeholder="פעילות"
          options={[
            { value: "never_sent", label: "טרם נשלח" },
            { value: "sent", label: "קיבלו הודעה" },
            { value: "read", label: "קראו" },
            { value: "clicked", label: "הקליקו" },
            { value: "replied", label: "הגיבו" },
            { value: "not_replied", label: "לא הגיבו" },
          ]}
        />
      </TableToolbar>
      {rows.length === 0 ? (
        <EmptyState icon={Contact} title={hasFilters ? "לא נמצאו אנשי קשר" : "עדיין אין אנשי קשר"} description={hasFilters ? "נסו לשנות את הסינון או החיפוש." : "ייבאו רשימה מקובץ CSV/Excel או מ-Google Sheets, או הוסיפו איש קשר ידנית."}>
          {!hasFilters && ctx.can("contacts:write") ? (
            <Button asChild>
              <Link href="/contacts/import">ייבוא אנשי קשר</Link>
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <Card className="gap-0 py-0">
          <ContactsTable
            sp={sp}
            canWrite={ctx.can("contacts:write")}
            tags={tags.map((t) => ({ id: t.id, name: t.name }))}
            audiences={audiences.filter((a) => a.kind === "STATIC").map((a) => ({ id: a.id, name: a.name }))}
            rows={rows.map((c) => ({
              id: c.id,
              phone: c.phoneE164,
              name: c.name,
              source: c.source,
              consent: c.consentStatus,
              suppressed: c.isSuppressed,
              tags: c.tags.map((t) => t.tag.name),
              sentCount: c.sentCount,
              readCount: c.readCount,
              clickCount: c.clickCount,
              lastSentAt: c.lastSentAt?.toISOString() ?? null,
              createdAt: c.createdAt.toISOString(),
            }))}
          />
          <Pager path="/contacts" sp={sp} page={page} pageSize={PAGE_SIZE} total={total} />
        </Card>
      )}
    </>
  );
}
