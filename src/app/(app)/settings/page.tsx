import Link from "next/link";
import { requireAppContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { getSettings, type SendingWindow } from "@/server/services/settings";
import { evaluateCompliance, FINANCIAL_INDUSTRY } from "@/server/services/compliance";
import { listMembers } from "@/server/services/organizations";
import { AUDIT_ACTION_LABELS } from "@/server/audit";
import { ROLE_LABELS } from "@/server/rbac";
import { PageHeader } from "@/components/app/page-header";
import { PendingExternal, StatusBadge } from "@/components/app/badges";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager } from "@/components/app/table-nav";
import { fmtDateTime } from "@/lib/format";
import { spOne, spPage, type SP } from "@/lib/search-params";
import { AlertsForm, BusinessForm, CostsForm, RetentionForm, SendingForm, UnsubscribeForm } from "./settings-forms";
import { CompliancePanel } from "./compliance-panel";
import { MembersPanel } from "./members-panel";

export const metadata = { title: "הגדרות" };
const TABS = ["business", "sending", "unsubscribe", "compliance", "users", "costs", "retention", "alerts", "audit"] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireAppContext("settings:read");
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(spOne(sp, "tab") ?? "") ? spOne(sp, "tab")! : "business";
  const canWrite = ctx.can("settings:write");
  const [settings, org, accounts, compliance, members] = await Promise.all([
    getSettings(ctx.orgId),
    db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } }),
    db.whatsappAccount.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true } }),
    evaluateCompliance(ctx.orgId),
    listMembers(ctx),
  ]);
  const auditPage = spPage(sp);
  const [auditTotal, auditRows] =
    tab === "audit" && ctx.can("audit:read")
      ? await Promise.all([
          db.auditLog.count({ where: { organizationId: ctx.orgId } }),
          db.auditLog.findMany({ where: { organizationId: ctx.orgId }, include: { actorUser: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip: (auditPage - 1) * 50, take: 50 }),
        ])
      : [0, []];
  const rates = (settings.costRates ?? {}) as Record<string, number>;

  return (
    <>
      <PageHeader title="הגדרות" description={`${org.name} · ${ROLE_LABELS[ctx.role]}`} />
      <Tabs value={tab}>
        <TabsList className="mb-4 h-auto flex-wrap">
          {[
            ["business", "פרטי העסק"],
            ["sending", "שליחה"],
            ["unsubscribe", "הסרה"],
            ["compliance", compliance.ok ? "תאימות ✓" : "תאימות ⚠"],
            ["users", "משתמשים והרשאות"],
            ["costs", "עלויות"],
            ["retention", "שמירת מידע"],
            ["alerts", "התראות"],
            ...(ctx.can("audit:read") ? [["audit", "יומן ביקורת"]] : []),
          ].map(([v, l]) => (
            <TabsTrigger key={v} value={v} asChild>
              <Link href={`/settings?tab=${v}`} scroll={false}>
                {l}
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="business">
          <BusinessForm
            canWrite={canWrite}
            accounts={accounts}
            initial={{
              orgName: org.name,
              industry: org.industry,
              displayName: settings.displayName ?? "",
              legalName: settings.legalName ?? "",
              businessIdNumber: settings.businessIdNumber ?? "",
              contactPhone: settings.contactPhone ?? "",
              contactEmail: settings.contactEmail ?? "",
              websiteUrl: settings.websiteUrl ?? "",
              privacyPolicyUrl: settings.privacyPolicyUrl ?? "",
              logoUrl: settings.logoUrl ?? "",
              timezone: settings.timezone,
              defaultWhatsappAccountId: settings.defaultWhatsappAccountId,
            }}
            financialValue={FINANCIAL_INDUSTRY}
          />
        </TabsContent>
        <TabsContent value="sending">
          <SendingForm
            canWrite={canWrite}
            initial={{
              sendingWindow: settings.sendingWindow as SendingWindow,
              safetyRollingCap: settings.safetyRollingCap,
              defaultMessagesPerSecond: settings.defaultMessagesPerSecond,
              testRecipients: settings.testRecipients,
              allowedRedirectDomains: settings.allowedRedirectDomains,
              perContactClickTracking: settings.perContactClickTracking,
            }}
          />
        </TabsContent>
        <TabsContent value="unsubscribe">
          <UnsubscribeForm
            canWrite={canWrite}
            isOwner={ctx.can("org:owner")}
            initial={{
              unsubscribeFooterText: settings.unsubscribeFooterText,
              unsubscribeKeywords: settings.unsubscribeKeywords,
              sendUnsubscribeConfirmation: settings.sendUnsubscribeConfirmation,
              unsubscribeConfirmationText: settings.unsubscribeConfirmationText,
              requireAdvertisingLabel: settings.requireAdvertisingLabel,
            }}
          />
        </TabsContent>
        <TabsContent value="compliance">
          <CompliancePanel
            ok={compliance.ok}
            canWrite={ctx.can("compliance:write")}
            defaultReviewer={ctx.user.name}
            rules={compliance.rules.map((r) => ({
              code: r.rule.code,
              title: r.rule.title,
              kind: r.rule.kind,
              required: r.rule.required,
              basis: r.rule.basis,
              requirement: r.rule.requirement,
              minEvidence: r.rule.minEvidenceLength ?? 20,
              status: r.status,
              detail: r.detail,
              evidence: r.check?.evidence ?? "",
              reviewedAt: r.check?.reviewedAt?.toISOString() ?? null,
              expiresAt: r.check?.expiresAt?.toISOString() ?? null,
            }))}
          />
        </TabsContent>
        <TabsContent value="users">
          <MembersPanel
            canManage={ctx.can("users:manage")}
            isOwner={ctx.can("org:owner")}
            selfId={ctx.user.id}
            members={members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email, role: m.role, lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null }))}
          />
        </TabsContent>
        <TabsContent value="costs">
          <CostsForm canWrite={canWrite} initial={{ costCurrency: settings.costCurrency, marketing: rates.MARKETING ?? null, utility: rates.UTILITY ?? null }} />
        </TabsContent>
        <TabsContent value="retention">
          <RetentionForm
            canWrite={canWrite}
            initial={{ retentionInboundDays: settings.retentionInboundDays, retentionClicksDays: settings.retentionClicksDays, retentionWebhookRawDays: settings.retentionWebhookRawDays, retentionAuditDays: settings.retentionAuditDays }}
          />
        </TabsContent>
        <TabsContent value="alerts">
          <AlertsForm canWrite={canWrite} initial={{ alertEmails: settings.alertEmails, alertOnQualityDrop: settings.alertOnQualityDrop, alertOnSendErrors: settings.alertOnSendErrors }} pending={<PendingExternal>שליחת דוא״ל: ממתין להגדרת ספק דוא״ל</PendingExternal>} />
        </TabsContent>
        <TabsContent value="audit">
          <Card className="gap-0 py-0">
            <CardHeader className="py-4">
              <CardTitle>יומן ביקורת</CardTitle>
              <CardDescription>פעולות רגישות: התחברויות, הסכמות, הסרות, קמפיינים, חשבונות, הרשאות והגדרות. הגישה מוגבלת למנהלים.</CardDescription>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>מועד</TableHead>
                  <TableHead>פעולה</TableHead>
                  <TableHead>מבצע</TableHead>
                  <TableHead className="hidden md:table-cell">ישות</TableHead>
                  <TableHead className="hidden lg:table-cell">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(auditRows as Awaited<ReturnType<typeof db.auditLog.findMany<{ include: { actorUser: { select: { name: true } } } }>>>).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDateTime(a.createdAt, settings.timezone)}</TableCell>
                    <TableCell>
                      <StatusBadge status={a.action.includes("failed") ? "FAILED" : "NEUTRAL"} label={AUDIT_ACTION_LABELS[a.action] ?? a.action} />
                    </TableCell>
                    <TableCell className="text-sm">{a.actorUser?.name ?? (a.actorType === "api_key" ? "מפתח API" : a.actorType === "system" ? "מערכת" : "—")}</TableCell>
                    <TableCell className="ltr hidden text-xs text-muted-foreground md:table-cell">{a.entityType ? `${a.entityType}:${a.entityId ?? ""}` : "—"}</TableCell>
                    <TableCell className="ltr hidden text-xs text-muted-foreground lg:table-cell">{a.ip ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pager path="/settings" sp={sp} page={auditPage} pageSize={50} total={auditTotal as number} />
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
