import Link from "next/link";
import { Ban, Inbox as InboxIcon, Target } from "lucide-react";
import type { ConversationStatus, LeadStatus } from "@/generated/prisma/enums";
import { requireAppContext } from "@/server/auth/current";
import { CONVERSATION_STATUS_LABELS, getConversation, listConversations } from "@/server/services/inbox";
import { LEAD_STATUS_LABELS, listLeads } from "@/server/services/leads";
import { listMembers } from "@/server/services/organizations";
import { getSettings } from "@/server/services/settings";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { FilterSelect, SearchInput, TableToolbar } from "@/components/app/table-controls";
import { Pager } from "@/components/app/table-nav";
import { StatusBadge } from "@/components/app/badges";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPhoneDisplay } from "@/lib/phone";
import { fmtDateTime, fmtNumber, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { spOne, spPage, withParams, type SP } from "@/lib/search-params";
import { ConversationPanel } from "./conversation-panel";
import { LeadStatusSelect } from "./lead-controls";

export const metadata = { title: "הודעות נכנסות" };
const PAGE_SIZE = 30;

export default async function InboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireAppContext("inbox:read");
  const sp = await searchParams;
  const tab = spOne(sp, "tab") === "leads" ? "leads" : "conversations";
  const page = spPage(sp);
  const settings = await getSettings(ctx.orgId);

  return (
    <>
      <PageHeader title="הודעות נכנסות" description="תגובות לקמפיינים והודעות יזומות מלקוחות. מענה חופשי אפשרי רק בתוך חלון השירות של 24 שעות מההודעה האחרונה של הלקוח." />
      <Tabs value={tab} className="mb-4">
        <TabsList>
          <TabsTrigger value="conversations" asChild>
            <Link href="/inbox">שיחות</Link>
          </TabsTrigger>
          <TabsTrigger value="leads" asChild>
            <Link href="/inbox?tab=leads">לידים</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "leads" ? <Leads sp={sp} page={page} tz={settings.timezone} canWrite={ctx.can("inbox:write")} ctx={ctx} /> : <Conversations sp={sp} page={page} tz={settings.timezone} ctx={ctx} />}
    </>
  );
}

async function Conversations({ sp, page, tz, ctx }: { sp: SP; page: number; tz: string; ctx: Awaited<ReturnType<typeof requireAppContext>> }) {
  const status = spOne(sp, "status") as ConversationStatus | undefined;
  const selectedId = spOne(sp, "c");
  const [{ total, rows }, members, selected] = await Promise.all([
    listConversations(ctx, { status: status && status in CONVERSATION_STATUS_LABELS ? status : undefined, assignee: spOne(sp, "assignee"), q: spOne(sp, "q"), unread: spOne(sp, "unread") === "1", page, pageSize: PAGE_SIZE }),
    listMembers(ctx),
    selectedId ? getConversation(ctx, selectedId).catch(() => null) : Promise.resolve(null),
  ]);
  return (
    <>
      <TableToolbar>
        <SearchInput placeholder="חיפוש בשם, טלפון או תוכן" />
        <FilterSelect param="status" placeholder="סטטוס" options={Object.entries(CONVERSATION_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
        <FilterSelect
          param="assignee"
          placeholder="שיוך"
          options={[
            { value: "me", label: "משויכות אליי" },
            { value: "none", label: "לא משויכות" },
            ...members.map((m) => ({ value: m.user.id, label: m.user.name })),
          ]}
        />
        <FilterSelect param="unread" placeholder="נקראו" options={[{ value: "1", label: "לא נקראו בלבד" }]} />
      </TableToolbar>
      {rows.length === 0 && !selected ? (
        <EmptyState icon={InboxIcon} title="אין שיחות" description="הודעות שיתקבלו מלקוחות דרך WhatsApp יופיעו כאן." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,380px)_1fr]">
          <Card className={cn("gap-0 overflow-hidden py-0", selected && "hidden lg:flex")}>
            <ul className="divide-y">
              {rows.map((c) => (
                <li key={c.id}>
                  <Link href={withParams("/inbox", sp, { c: c.id, page })} className={cn("flex gap-3 px-4 py-3 transition-colors hover:bg-muted/60", selected?.convo.id === c.id && "bg-accent/60")}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-sm", c.unreadCount ? "font-semibold" : "font-medium")}>{c.contact.name || formatPhoneDisplay(c.contact.phoneE164)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{fmtRelative(c.lastMessageAt)}</span>
                      </div>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted-foreground">
                        {c.inboundMessages[0]?.isUnsubscribe ? <Ban className="size-3.5 shrink-0 text-destructive" /> : null}
                        {c.inboundMessages[0]?.text ?? ""}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <StatusBadge status={c.status} label={CONVERSATION_STATUS_LABELS[c.status]} />
                        {c.assignee ? <span className="truncate text-xs text-muted-foreground">{c.assignee.name}</span> : null}
                      </div>
                    </div>
                    {c.unreadCount ? <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">{c.unreadCount}</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
            <Pager path="/inbox" sp={sp} page={page} pageSize={PAGE_SIZE} total={total} />
          </Card>
          {selected ? (
            <ConversationPanel
              key={selected.convo.id}
              backHref={withParams("/inbox", sp, { c: null, page })}
              tz={tz}
              canWrite={ctx.can("inbox:write")}
              members={members.map((m) => ({ id: m.user.id, name: m.user.name }))}
              convo={{
                id: selected.convo.id,
                status: selected.convo.status,
                assigneeId: selected.convo.assigneeId,
                notes: selected.convo.notes,
                contact: { id: selected.convo.contact.id, name: selected.convo.contact.name, phone: selected.convo.contact.phoneE164, suppressed: selected.convo.contact.isSuppressed, consent: selected.convo.contact.consentStatus },
                phone: selected.convo.phoneNumber.displayPhoneNumber,
              }}
              windowOpen={selected.windowOpen}
              windowClosesAt={selected.windowClosesAt?.toISOString() ?? null}
              timeline={selected.timeline.map((m) => ({ ...m, at: m.at.toISOString() }))}
            />
          ) : (
            <Card className="hidden items-center justify-center text-sm text-muted-foreground lg:flex">בחרו שיחה מהרשימה</Card>
          )}
        </div>
      )}
    </>
  );
}

async function Leads({ sp, page, tz, canWrite, ctx }: { sp: SP; page: number; tz: string; canWrite: boolean; ctx: Awaited<ReturnType<typeof requireAppContext>> }) {
  const status = spOne(sp, "status") as LeadStatus | undefined;
  const { total, rows } = await listLeads(ctx, { status: status && status in LEAD_STATUS_LABELS ? status : undefined, page, pageSize: PAGE_SIZE });
  return (
    <>
      <TableToolbar>
        <FilterSelect param="status" placeholder="סטטוס ליד" options={Object.entries(LEAD_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
      </TableToolbar>
      {rows.length === 0 ? (
        <EmptyState icon={Target} title="אין לידים" description="לידים נוצרים מלחיצה על כפתור התעניינות, מתיבת ההודעות או דרך ה-API (n8n)." />
      ) : (
        <Card className="gap-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>איש קשר</TableHead>
                <TableHead>קמפיין</TableHead>
                <TableHead>מקור</TableHead>
                <TableHead>סטטוס</TableHead>
                <TableHead className="hidden md:table-cell">שווי</TableHead>
                <TableHead className="hidden sm:table-cell">נוצר</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    {l.contact ? (
                      <Link href={`/contacts/${l.contact.id}`} className="hover:underline">
                        {l.contact.name || formatPhoneDisplay(l.contact.phoneE164)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {l.campaign ? (
                      <Link href={`/campaigns/${l.campaign.id}`} className="hover:underline">
                        {l.campaign.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">לא משויך</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-muted-foreground">{l.source}</TableCell>
                  <TableCell>{canWrite ? <LeadStatusSelect id={l.id} status={l.status} /> : <StatusBadge status={l.status} label={LEAD_STATUS_LABELS[l.status]} />}</TableCell>
                  <TableCell className="tabular hidden md:table-cell">{l.value ? fmtNumber(Number(l.value)) : "—"}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{fmtDateTime(l.createdAt, tz)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager path="/inbox" sp={sp} page={page} pageSize={PAGE_SIZE} total={total} />
        </Card>
      )}
    </>
  );
}
