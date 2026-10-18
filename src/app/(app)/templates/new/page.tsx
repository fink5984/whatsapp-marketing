import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAppContext } from "@/server/auth/current";
import { listAccounts } from "@/server/services/accounts";
import { getSettings } from "@/server/services/settings";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Smartphone } from "lucide-react";
import { TemplateEditor } from "../template-editor";

export const metadata = { title: "תבנית חדשה" };

export default async function NewTemplatePage() {
  const ctx = await requireAppContext("templates:write");
  const [accounts, settings] = await Promise.all([listAccounts(ctx), getSettings(ctx.orgId)]);
  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
        <Link href="/templates">
          <ArrowRight />
          תבניות
        </Link>
      </Button>
      <PageHeader title="תבנית חדשה" description="תבנית שיווקית חייבת לכלול אפשרות הסרה. מומלץ לפתוח במילה &quot;פרסומת&quot; ולציין את שם העסק." />
      {accounts.length === 0 ? (
        <EmptyState icon={Smartphone} title="יש לחבר חשבון WhatsApp תחילה">
          <Button asChild>
            <Link href="/accounts">חיבור חשבון</Link>
          </Button>
        </EmptyState>
      ) : (
        <TemplateEditor accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} unsubscribeText={settings.unsubscribeFooterText} businessName={settings.displayName || ctx.org.name} />
      )}
    </>
  );
}
