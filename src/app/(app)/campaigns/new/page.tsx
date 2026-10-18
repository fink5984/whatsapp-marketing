import Link from "next/link";
import { ArrowRight, Settings2, Smartphone } from "lucide-react";
import { requireAppContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { getSettings } from "@/server/services/settings";
import { listAudiences } from "@/server/services/audiences";
import { distinctSources, listTags } from "@/server/services/contacts";
import { quickNeeds } from "@/server/services/quick-campaign";
import { evaluateCompliance } from "@/server/services/compliance";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { analyzeTemplate, type TemplateComponent } from "@/lib/templates";
import { QuickSend } from "./quick-send";

export const metadata = { title: "קמפיין חדש" };

export default async function NewCampaignPage() {
  const ctx = await requireAppContext("campaigns:write");
  const [phones, templates, audiences, tags, settings, compliance, eligibleTotal, sources, campaigns] = await Promise.all([
    db.whatsappPhoneNumber.findMany({ where: { organizationId: ctx.orgId }, include: { account: { select: { id: true, name: true, status: true } } }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
    db.messageTemplate.findMany({ where: { organizationId: ctx.orgId, status: "APPROVED", category: { in: ["MARKETING", "UTILITY"] } }, orderBy: { name: "asc" } }),
    listAudiences(ctx),
    listTags(ctx),
    getSettings(ctx.orgId),
    evaluateCompliance(ctx.orgId),
    db.contact.count({ where: { organizationId: ctx.orgId, consentStatus: "GRANTED", isSuppressed: false } }),
    distinctSources(ctx),
    db.campaign.findMany({ where: { organizationId: ctx.orgId, status: { not: "DRAFT" } }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
        <Link href="/campaigns">
          <ArrowRight />
          קמפיינים
        </Link>
      </Button>
      <PageHeader
        title="קמפיין חדש"
        description="בחרו מספר, תבנית וקהל — והמערכת תדאג לשאר: משתנים, קישור מעקב, בדיקות טכניות, הסרות והסכמות."
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/campaigns/advanced">
              <Settings2 />
              אשף מפורט
            </Link>
          </Button>
        }
      />
      {phones.length === 0 ? (
        <EmptyState icon={Smartphone} title="יש לחבר חשבון WhatsApp תחילה" description="לאחר החיבור ובדיקת התקינות, המספרים והתבניות ייטענו אוטומטית.">
          <Button asChild>
            <Link href="/accounts">חיבור חשבון</Link>
          </Button>
        </EmptyState>
      ) : (
        <QuickSend
          canLaunch={ctx.can("campaigns:launch")}
          complianceOk={compliance.ok}
          eligibleTotal={eligibleTotal}
          businessName={settings.displayName || ctx.org.name}
          phones={phones.map((p) => ({ id: p.id, accountId: p.accountId, label: `${p.displayPhoneNumber ?? p.phoneNumberId}${p.verifiedName ? ` · ${p.verifiedName}` : ""}`, connected: p.status === "CONNECTED" && p.account.status === "CONNECTED", quality: p.qualityRating }))}
          templates={templates.map((t) => {
            const components = t.components as unknown as TemplateComponent[];
            const a = analyzeTemplate(components, settings.unsubscribeKeywords);
            return { id: t.id, accountId: t.accountId, name: t.name, category: t.category, language: t.language, components, needs: quickNeeds(components), optOut: t.category !== "MARKETING" || a.hasUnsubscribeFooter || a.hasUnsubscribeButton };
          })}
          audiences={audiences.map((a) => ({ id: a.id, name: a.name, size: a.size }))}
          tags={tags.map((t) => ({ id: t.id, name: t.name }))}
          sources={sources}
          campaigns={campaigns}
        />
      )}
    </>
  );
}
