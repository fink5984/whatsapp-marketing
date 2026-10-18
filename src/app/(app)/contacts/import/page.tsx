import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAppContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { listAudiences } from "@/server/services/audiences";
import { serviceAccountEmail, sheetsConfigured } from "@/server/services/sheets";
import { appUrl } from "@/server/env";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { ImportWizard } from "./import-wizard";
import { SheetSources } from "./sheet-sources";

export const metadata = { title: "ייבוא אנשי קשר" };

export default async function ImportPage() {
  const ctx = await requireAppContext("contacts:write");
  const [audiences, imports, sources] = await Promise.all([
    listAudiences(ctx),
    db.contactImport.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.googleSheetSource.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "asc" } }),
  ]);
  const staticAudiences = audiences.filter((a) => a.kind === "STATIC").map((a) => ({ id: a.id, name: a.name }));
  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ms-2 mb-2">
        <Link href="/contacts">
          <ArrowRight />
          אנשי קשר
        </Link>
      </Button>
      <PageHeader
        title="ייבוא אנשי קשר"
        description="מספרים מנורמלים אוטומטית, כפילויות מאוחדות, ומספרים שביקשו הסרה נשארים חסומים. ייבוא לעולם אינו משנה הסכמה קיימת או מבטל הסרה."
      />
      <Tabs defaultValue="file">
        <TabsList className="mb-4">
          <TabsTrigger value="file">קובץ CSV / Excel</TabsTrigger>
          <TabsTrigger value="sheets">Google Sheets</TabsTrigger>
          <TabsTrigger value="api">n8n / API</TabsTrigger>
        </TabsList>
        <TabsContent value="file">
          <ImportWizard audiences={staticAudiences} canConsent={ctx.can("consents:write")} />
        </TabsContent>
        <TabsContent value="sheets">
          <SheetSources
            configured={sheetsConfigured()}
            serviceEmail={serviceAccountEmail()}
            audiences={staticAudiences}
            sources={sources.map((s) => ({
              id: s.id,
              name: s.name,
              spreadsheetId: s.spreadsheetId,
              range: s.range,
              lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
              lastSyncStatus: s.lastSyncStatus,
              lastSyncMessage: s.lastSyncMessage,
              syncIntervalMin: s.syncIntervalMin,
            }))}
          />
        </TabsContent>
        <TabsContent value="api">
          <Card>
            <CardHeader>
              <CardTitle>ייבוא דרך n8n או כל מערכת חיצונית</CardTitle>
              <CardDescription>צרו מפתח API עם הרשאת &quot;יצירה ועדכון אנשי קשר&quot; בעמוד האוטומציות, ושלחו בקשה מ-n8n (HTTP Request node).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <pre className="ltr overflow-x-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">{`POST ${appUrl()}/api/v1/contacts/import
Authorization: Bearer wcm_xxxxxxxx_...
Content-Type: application/json

{
  "source": "n8n - טופס אתר",
  "tags": ["אתר"],
  "contacts": [
    { "phone": "050-1234567", "name": "דנה כהן",
      "consent": { "proofText": "סימנה הסכמה בטופס באתר", "capturedAt": "2026-10-01T10:00:00Z", "source": "WEB_FORM" } }
  ]
}`}</pre>
              <p className="text-muted-foreground">הסכמה נרשמת רק כשמצורפת אסמכתה, ולעולם לא עבור מספר שביקש הסרה. ראו את תיעוד ה-API המלא בעמוד האוטומציות.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {imports.length ? (
        <Card className="mt-6 gap-0 py-0">
          <CardHeader className="py-4">
            <CardTitle className="text-base">ייבואים אחרונים</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>מועד</TableHead>
                <TableHead>מקור</TableHead>
                <TableHead className="text-end">שורות</TableHead>
                <TableHead className="text-end">נוספו</TableHead>
                <TableHead className="text-end">עודכנו</TableHead>
                <TableHead className="text-end">שגויים</TableHead>
                <TableHead className="text-end">נשארו חסומים</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{fmtDateTime(i.createdAt)}</TableCell>
                  <TableCell className="max-w-48 truncate">{i.fileName ?? i.source}</TableCell>
                  <TableCell className="tabular text-end">{fmtNumber(i.totalRows)}</TableCell>
                  <TableCell className="tabular text-end">{fmtNumber(i.created)}</TableCell>
                  <TableCell className="tabular text-end">{fmtNumber(i.updated)}</TableCell>
                  <TableCell className="tabular text-end">{fmtNumber(i.invalid)}</TableCell>
                  <TableCell className="tabular text-end">{fmtNumber(i.suppressedKept)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}
