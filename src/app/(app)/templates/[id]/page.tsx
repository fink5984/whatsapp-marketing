import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";
import { requireAppContext } from "@/server/auth/current";
import { getTemplate, TEMPLATE_CATEGORY_LABELS, TEMPLATE_STATUS_LABELS } from "@/server/services/templates";
import { getSettings } from "@/server/services/settings";
import { PageHeader } from "@/components/app/page-header";
import { Pill, StatusBadge } from "@/components/app/badges";
import { WhatsAppPreview } from "@/components/app/whatsapp-preview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/format";
import { mediaHeaderFormat, templateSlots, validateTemplate, type TemplateComponent } from "@/lib/templates";
import { TemplateActions } from "./template-actions";

export const metadata = { title: "תבנית" };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAppContext("templates:read");
  const { id } = await params;
  const [t, settings] = await Promise.all([getTemplate(ctx, id), getSettings(ctx.orgId)]);
  const components = t.components as unknown as TemplateComponent[];
  const slots = templateSlots(components);
  const issues = validateTemplate({ name: t.name, category: t.category, components });
  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
        <Link href="/templates">
          <ArrowRight />
          תבניות
        </Link>
      </Button>
      <PageHeader
        title={t.name}
        actions={
          <TemplateActions
            template={{ id: t.id, status: t.status, media: mediaHeaderFormat(components), slots: slots.map((s) => ({ key: s.key, label: s.label })) }}
            testRecipients={settings.testRecipients}
            can={{ write: ctx.can("templates:write"), test: ctx.can("campaigns:write") }}
          />
        }
      >
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <StatusBadge status={t.status} label={TEMPLATE_STATUS_LABELS[t.status]} />
          <Pill tone="muted">{TEMPLATE_CATEGORY_LABELS[t.category]}</Pill>
          <Pill tone="muted">
            <span className="ltr">{t.language}</span>
          </Pill>
          {t.qualityScore ? <Pill tone="info">איכות: {t.qualityScore}</Pill> : null}
        </div>
      </PageHeader>

      {t.status === "REJECTED" ? (
        <Alert variant="destructive" className="mb-6">
          <Info />
          <AlertTitle>התבנית נדחתה ע״י Meta</AlertTitle>
          <AlertDescription>סיבה: {t.rejectedReason ?? "לא נמסרה סיבה"}. ניתן לערוך ולשלוח מחדש.</AlertDescription>
        </Alert>
      ) : t.status === "PENDING" ? (
        <Alert className="mb-6">
          <Info />
          <AlertTitle>ממתינה לאישור Meta</AlertTitle>
          <AlertDescription>הסטטוס יתעדכן אוטומטית דרך Webhook, או בסנכרון ידני. לא ניתן להשתמש בתבנית בקמפיין לפני אישור.</AlertDescription>
        </Alert>
      ) : t.status === "PAUSED" || t.status === "DISABLED" ? (
        <Alert variant="destructive" className="mb-6">
          <Info />
          <AlertTitle>התבנית {TEMPLATE_STATUS_LABELS[t.status]}</AlertTitle>
          <AlertDescription>Meta השהתה/השביתה את התבנית, בדרך כלל עקב משוב שלילי מנמענים. קמפיינים המשתמשים בה יושהו.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <WhatsAppPreview components={components} values={Object.fromEntries(slots.map((s) => [s.name, `{{${s.name}}}`]))} businessName={settings.displayName || ctx.org.name} />
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>פרטים</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">חשבון</dt>
                  <dd className="font-medium">{t.account.name}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">מזהה Meta</dt>
                  <dd className="ltr font-medium">{t.metaTemplateId ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">סונכרן לאחרונה</dt>
                  <dd className="font-medium">{fmtDateTime(t.lastSyncedAt, settings.timezone)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">משתנים</dt>
                  <dd className="font-medium">{slots.length ? slots.map((s) => s.label).join(", ") : "ללא"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">אפשרות הסרה</dt>
                  <dd className="font-medium">{t.hasUnsubscribeButton ? "כפתור הסרה" : t.hasUnsubscribeFooter ? "שורת הסרה" : <span className="text-destructive">חסרה</span>}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">המילה &quot;פרסומת&quot;</dt>
                  <dd className="font-medium">{t.hasAdvertisingLabel ? "קיימת" : "חסרה"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          {issues.length ? (
            <Card>
              <CardHeader>
                <CardTitle>הערות תאימות</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
                  {issues.map((i, k) => (
                    <li key={k} className={i.level === "error" ? "text-destructive" : undefined}>
                      {i.message}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
