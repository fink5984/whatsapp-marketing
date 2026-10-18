import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import type { TemplateStatus } from "@/generated/prisma/enums";
import { requireAppContext } from "@/server/auth/current";
import { listTemplates, TEMPLATE_CATEGORY_LABELS, TEMPLATE_STATUS_LABELS } from "@/server/services/templates";
import { listAccounts } from "@/server/services/accounts";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { FilterSelect, SearchInput, TableToolbar } from "@/components/app/table-controls";
import { Pill, StatusBadge } from "@/components/app/badges";
import { ActionButton } from "@/components/app/confirm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtRelative } from "@/lib/format";
import { spOne, type SP } from "@/lib/search-params";
import { syncTemplatesAction } from "../accounts/actions";

export const metadata = { title: "תבניות הודעה" };

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireAppContext("templates:read");
  const sp = await searchParams;
  const status = spOne(sp, "status") as TemplateStatus | undefined;
  const [templates, accounts] = await Promise.all([
    listTemplates(ctx, { status: status && status in TEMPLATE_STATUS_LABELS ? status : undefined, q: spOne(sp, "q") }),
    listAccounts(ctx),
  ]);
  const canWrite = ctx.can("templates:write");
  return (
    <>
      <PageHeader
        title="תבניות הודעה"
        description="פנייה יזומה ב-WhatsApp אפשרית רק בתבנית שאושרה ע״י Meta. אישור טכני של תבנית אינו מהווה אישור שכל הצעה או שימוש מותרים."
        actions={
          canWrite && accounts.length ? (
            <>
              {accounts.map((a) => (
                <ActionButton key={a.id} variant="outline" action={syncTemplatesAction.bind(null, { accountId: a.id })} success="התבניות סונכרנו מ-Meta">
                  סנכרון{accounts.length > 1 ? ` — ${a.name}` : " מ-Meta"}
                </ActionButton>
              ))}
              <Button asChild>
                <Link href="/templates/new">
                  <Plus />
                  תבנית חדשה
                </Link>
              </Button>
            </>
          ) : null
        }
      />
      <TableToolbar>
        <SearchInput placeholder="חיפוש לפי שם תבנית" />
        <FilterSelect param="status" placeholder="סטטוס" options={Object.entries(TEMPLATE_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
      </TableToolbar>
      {templates.length === 0 ? (
        <EmptyState icon={FileText} title="אין תבניות" description={accounts.length ? "סנכרנו תבניות קיימות מ-Meta או צרו תבנית חדשה." : "יש לחבר חשבון WhatsApp תחילה."}>
          {!accounts.length ? (
            <Button asChild>
              <Link href="/accounts">חיבור חשבון</Link>
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>שם</TableHead>
                <TableHead>קטגוריה</TableHead>
                <TableHead>שפה</TableHead>
                <TableHead>סטטוס</TableHead>
                <TableHead className="hidden md:table-cell">תאימות</TableHead>
                <TableHead className="hidden lg:table-cell">חשבון</TableHead>
                <TableHead className="hidden sm:table-cell">עודכן</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    <Link href={`/templates/${t.id}`} className="ltr hover:underline">
                      {t.name}
                    </Link>
                  </TableCell>
                  <TableCell>{TEMPLATE_CATEGORY_LABELS[t.category]}</TableCell>
                  <TableCell className="ltr">{t.language}</TableCell>
                  <TableCell>
                    <StatusBadge status={t.status} label={TEMPLATE_STATUS_LABELS[t.status]} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {t.category === "MARKETING" ? (
                        <>
                          {t.hasUnsubscribeFooter || t.hasUnsubscribeButton ? <Pill tone="success">הסרה ✓</Pill> : <Pill tone="danger">ללא הסרה</Pill>}
                          {t.hasAdvertisingLabel ? <Pill tone="success">&quot;פרסומת&quot; ✓</Pill> : <Pill tone="warning">ללא &quot;פרסומת&quot;</Pill>}
                        </>
                      ) : (
                        <Pill tone="muted">—</Pill>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">{t.account.name}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{fmtRelative(t.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
