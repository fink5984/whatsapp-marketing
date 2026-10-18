import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { requireAppContext } from "@/server/auth/current";
import { getTemplate } from "@/server/services/templates";
import { listAccounts } from "@/server/services/accounts";
import { getSettings } from "@/server/services/settings";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import type { TemplateComponent } from "@/lib/templates";
import { TemplateEditor } from "../../template-editor";

export const metadata = { title: "עריכת תבנית" };

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAppContext("templates:write");
  const { id } = await params;
  const [t, accounts, settings] = await Promise.all([getTemplate(ctx, id), listAccounts(ctx), getSettings(ctx.orgId)]);
  if (t.status !== "DRAFT" && t.status !== "REJECTED") redirect(`/templates/${id}`);
  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
        <Link href={`/templates/${id}`}>
          <ArrowRight />
          {t.name}
        </Link>
      </Button>
      <PageHeader title={`עריכת ${t.name}`} />
      <TemplateEditor
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        unsubscribeText={settings.unsubscribeFooterText}
        businessName={settings.displayName || ctx.org.name}
        initial={{ id: t.id, accountId: t.accountId, name: t.name, language: t.language, category: t.category === "UTILITY" ? "UTILITY" : "MARKETING", components: t.components as unknown as TemplateComponent[] }}
      />
    </>
  );
}
