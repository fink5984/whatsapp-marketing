import { Smartphone, Webhook } from "lucide-react";
import { requireAppContext } from "@/server/auth/current";
import { listAccounts, webhookUrlsFor } from "@/server/services/accounts";
import { decryptOptional, maskSecret } from "@/server/crypto";
import { env } from "@/server/env";
import { parseMessagingLimit } from "@/server/meta/client";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { PendingExternal, PhoneQualityBadge, Pill, StatusBadge } from "@/components/app/badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtNumber, fmtRelative } from "@/lib/format";
import { AccountDialog } from "./account-dialog";
import { AccountToolbar, CopyField, PhoneOptions } from "./account-client";

export const metadata = { title: "חשבונות WhatsApp" };

const STATUS_LABEL = { PENDING_SETUP: "ממתין להגדרה", CONNECTED: "מחובר", ERROR: "שגיאה", DISCONNECTED: "מנותק" };

export default async function AccountsPage() {
  const ctx = await requireAppContext("accounts:read");
  const accounts = await listAccounts(ctx);
  const canWrite = ctx.can("accounts:write");
  const e = env();
  return (
    <>
      <PageHeader
        title="חשבונות WhatsApp"
        description="חיבור ידני של חשבון WhatsApp Business קיים דרך Meta Cloud API הרשמי. אסימוני גישה וסודות נשמרים מוצפנים (AES-256-GCM) ואינם מוצגים לאחר השמירה."
        actions={canWrite ? <AccountDialog /> : null}
      />

      {accounts.length === 0 ? (
        <EmptyState icon={Smartphone} title="לא חובר חשבון WhatsApp" description="נדרשים: WhatsApp Business Account ID, אסימון גישה קבוע (System User), ו-App Secret לאימות Webhooks. מדריך מלא ב-docs/meta-setup.md.">
          {canWrite ? <AccountDialog /> : null}
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {accounts.map((a) => {
            const urls = webhookUrlsFor(a);
            const verifyToken = decryptOptional(a.webhookVerifyTokenEnc);
            return (
              <Card key={a.id}>
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        {a.name}
                        <StatusBadge status={a.status} label={STATUS_LABEL[a.status]} />
                        <Pill tone="muted">{a.connectionMethod === "MANUAL" ? "חיבור ידני" : "Embedded Signup"}</Pill>
                      </CardTitle>
                      <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
                        <span>
                          WABA ID: <span className="ltr tabular">{a.wabaId}</span>
                        </span>
                        <span>אסימון: {a.accessTokenEnc ? <span className="ltr">{maskSecret(decryptOptional(a.accessTokenEnc))}</span> : <span className="text-destructive">חסר</span>}</span>
                        <span>App Secret: {a.appSecretEnc ? "הוגדר" : e.META_APP_SECRET ? "משותף (פלטפורמה)" : <span className="text-destructive">חסר</span>}</span>
                        <span>{fmtNumber(a._count.templates)} תבניות</span>
                      </CardDescription>
                      {a.statusMessage ? <p className="text-sm text-destructive">{a.statusMessage}</p> : null}
                    </div>
                    {canWrite ? <AccountToolbar account={{ id: a.id, name: a.name, wabaId: a.wabaId, metaAppId: a.metaAppId }} /> : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>מספר</TableHead>
                          <TableHead>שם מאומת</TableHead>
                          <TableHead>סטטוס</TableHead>
                          <TableHead>איכות</TableHead>
                          <TableHead>מגבלת שליחה (24 ש׳ מתגלגלות)</TableHead>
                          <TableHead>Phone Number ID</TableHead>
                          <TableHead>קצב (הודעות/שנייה)</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {a.phoneNumbers.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                              המספרים ייטענו אוטומטית מ-Meta בעת &quot;בדיקת תקינות&quot;.
                            </TableCell>
                          </TableRow>
                        ) : (
                          a.phoneNumbers.map((p) => {
                            const limit = parseMessagingLimit(p.messagingLimitTier);
                            return (
                              <TableRow key={p.id}>
                                <TableCell className="ltr tabular font-medium">{p.displayPhoneNumber ?? "—"}</TableCell>
                                <TableCell>{p.verifiedName ?? "—"}</TableCell>
                                <TableCell>
                                  <StatusBadge status={p.status} label={STATUS_LABEL[p.status]} />
                                </TableCell>
                                <TableCell>
                                  <PhoneQualityBadge rating={p.qualityRating} />
                                </TableCell>
                                <TableCell>{limit === null ? <span className="text-muted-foreground">לא ידוע</span> : limit === Infinity ? "ללא הגבלה" : `${fmtNumber(limit)} נמענים`}</TableCell>
                                <TableCell className="ltr tabular text-xs text-muted-foreground">{p.phoneNumberId}</TableCell>
                                <TableCell>{canWrite ? <PhoneOptions phone={{ id: p.id, isDefault: p.isDefault, mps: p.messagesPerSecond }} /> : (p.messagesPerSecond ?? "ברירת מחדל")}</TableCell>
                                <TableCell>{p.isDefault ? <Pill tone="primary">ברירת מחדל</Pill> : null}</TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="rounded-xl border bg-muted/30 p-4">
                    <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                      <Webhook className="size-4" />
                      הגדרת Webhook ב-Meta
                    </h3>
                    <p className="mb-3 text-sm text-muted-foreground">
                      ב-Meta for Developers ← האפליקציה ← WhatsApp ← Configuration: הזינו את הכתובת וה-Verify Token, ורשמו את השדות messages, message_template_status_update, phone_number_quality_update, account_update.
                    </p>
                    <div className="grid gap-3 lg:grid-cols-2">
                      <CopyField label="Callback URL (ייעודי לחשבון זה)" value={urls.perAccount} />
                      {canWrite ? <CopyField label="Verify Token" value={verifyToken ?? ""} secret /> : null}
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {a.lastWebhookAt ? `אירוע Webhook אחרון התקבל ${fmtRelative(a.lastWebhookAt)}.` : "טרם התקבל אירוע Webhook מחשבון זה."} חתימת X-Hub-Signature-256 נבדקת בכל בקשה באמצעות ה-App Secret.
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="mt-6 border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            חיבור עצמי של עסקים (Embedded Signup) <PendingExternal />
          </CardTitle>
          <CardDescription>
            מבנה הנתונים תומך בחיבור עצמי של לקוחות (שדה connectionMethod, אסימון לכל חשבון, ניתוב Webhooks לפי Phone Number ID). הפעלה מחייבת אפליקציית Meta במעמד Tech Provider, אישור App Review להרשאות whatsapp_business_management ו-whatsapp_business_messaging, ו-Business Verification.
          </CardDescription>
        </CardHeader>
      </Card>
    </>
  );
}
