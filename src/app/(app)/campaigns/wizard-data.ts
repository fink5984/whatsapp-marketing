import "server-only";
import { db } from "@/server/db";
import type { AppContext } from "@/server/auth/current";
import { getSettings } from "@/server/services/settings";
import { listAudiences } from "@/server/services/audiences";
import { distinctSources, listTags } from "@/server/services/contacts";
import { trackedUrl } from "@/server/services/links";
import { trackingBaseUrl } from "@/server/env";
import { templateSlots, mediaHeaderFormat, type TemplateComponent } from "@/lib/templates";
import type { WizardData } from "./campaign-wizard";

/** Everything the wizard needs, scoped to the active org and serialized for the client. */
export async function loadWizardData(ctx: AppContext): Promise<WizardData> {
  const [accounts, templates, audiences, tags, sources, campaigns, links, settings] = await Promise.all([
    db.whatsappAccount.findMany({ where: { organizationId: ctx.orgId }, include: { phoneNumbers: true }, orderBy: { createdAt: "asc" } }),
    db.messageTemplate.findMany({ where: { organizationId: ctx.orgId, status: "APPROVED", category: { in: ["MARKETING", "UTILITY"] } }, orderBy: { name: "asc" } }),
    listAudiences(ctx),
    listTags(ctx),
    distinctSources(ctx),
    db.campaign.findMany({ where: { organizationId: ctx.orgId, status: { not: "DRAFT" } }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.trackedLink.findMany({ where: { organizationId: ctx.orgId, isActive: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    getSettings(ctx.orgId),
  ]);
  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      phones: a.phoneNumbers.map((p) => ({ id: p.id, display: p.displayPhoneNumber ?? p.phoneNumberId, status: p.status, quality: p.qualityRating, isDefault: p.isDefault })),
    })),
    templates: templates.map((t) => {
      const components = t.components as unknown as TemplateComponent[];
      return {
        id: t.id,
        accountId: t.accountId,
        name: t.name,
        language: t.language,
        category: t.category,
        components,
        slots: templateSlots(components).map((s) => ({ key: s.key, label: s.label, component: s.component, name: s.name })),
        media: mediaHeaderFormat(components),
        compliant: t.category !== "MARKETING" || ((t.hasUnsubscribeFooter || t.hasUnsubscribeButton) && (t.hasAdvertisingLabel || !settings.requireAdvertisingLabel)),
      };
    }),
    audiences: audiences.map((a) => ({ id: a.id, name: a.name, size: a.size, kind: a.kind })),
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    sources,
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name })),
    links: links.map((l) => ({ id: l.id, name: l.name, url: trackedUrl(l.token), destination: l.destinationUrl })),
    trackingBase: trackingBaseUrl(),
    testRecipients: settings.testRecipients,
    businessName: settings.displayName || ctx.org.name,
    timezone: settings.timezone,
    canLaunch: ctx.can("campaigns:launch"),
  };
}
