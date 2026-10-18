import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { requireAppContext } from "@/server/auth/current";
import { getCampaign } from "@/server/services/campaigns";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { spOne, type SP } from "@/lib/search-params";
import { loadWizardData } from "../../wizard-data";
import { CampaignWizard, type CampaignDraft } from "../../campaign-wizard";

export const metadata = { title: "הגדרת קמפיין" };

export default async function CampaignSetupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireAppContext("campaigns:write");
  const { id } = await params;
  const sp = await searchParams;
  const c = await getCampaign(ctx, id);
  if (c.status !== "DRAFT") redirect(`/campaigns/${id}`);
  const data = await loadWizardData(ctx);
  const step = Math.min(3, Math.max(0, Number(spOne(sp, "step") ?? 0) || 0));
  const draft: CampaignDraft = {
    id: c.id,
    name: c.name,
    description: c.description,
    tags: c.tags,
    accountId: c.accountId,
    phoneNumberId: c.phoneNumberId,
    templateId: c.templateId,
    audienceFilter: (c.audienceFilter ?? {}) as CampaignDraft["audienceFilter"],
    variableMapping: (c.variableMapping ?? {}) as CampaignDraft["variableMapping"],
    headerMediaUrl: c.headerMediaUrl,
    trackedLinkId: c.trackedLinkId,
    scheduledAt: c.scheduledAt?.toISOString() ?? null,
    maxRecipients: c.maxRecipients,
    messagesPerSecond: c.messagesPerSecond,
    respectSendingWindow: c.respectSendingWindow,
  };
  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
        <Link href="/campaigns">
          <ArrowRight />
          קמפיינים
        </Link>
      </Button>
      <PageHeader title={c.name} description="טיוטה — השינויים נשמרים בכל מעבר שלב." />
      <CampaignWizard data={data} draft={draft} initialStep={step} />
    </>
  );
}
