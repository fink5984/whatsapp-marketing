import Link from "next/link";
import { ArrowRight, Smartphone } from "lucide-react";
import { requireAppContext } from "@/server/auth/current";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { loadWizardData } from "../wizard-data";
import { CampaignWizard } from "../campaign-wizard";

export const metadata = { title: "קמפיין — אשף מפורט" };

export default async function NewCampaignPage() {
  const ctx = await requireAppContext("campaigns:write");
  const data = await loadWizardData(ctx);
  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
        <Link href="/campaigns">
          <ArrowRight />
          קמפיינים
        </Link>
      </Button>
      <PageHeader title="קמפיין חדש — אשף מפורט" description="שליטה מלאה במשתנים, קהל ותזמון. לשליחה מהירה חזרו לעמוד &quot;קמפיין חדש&quot;." />
      {data.accounts.length === 0 ? (
        <EmptyState icon={Smartphone} title="יש לחבר חשבון WhatsApp תחילה">
          <Button asChild>
            <Link href="/accounts">חיבור חשבון</Link>
          </Button>
        </EmptyState>
      ) : (
        <CampaignWizard data={data} />
      )}
    </>
  );
}
