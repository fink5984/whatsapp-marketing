import { Bot, KeyRound, Trash2, Webhook } from "lucide-react";
import { requireAppContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { listRules, TRIGGER_LABELS, ACTION_LABELS, actionsSchema, conditionsSchema } from "@/server/services/automations";
import { listApiKeys } from "@/server/services/api-keys";
import { OUTGOING_EVENT_LABELS, OUTGOING_EVENTS } from "@/server/services/outgoing-webhooks";
import { listTags } from "@/server/services/contacts";
import { listMembers } from "@/server/services/organizations";
import { API_SCOPE_LABELS, API_SCOPES } from "@/server/rbac";
import { appUrl } from "@/server/env";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Pill, StatusBadge } from "@/components/app/badges";
import { ConfirmAction } from "@/components/app/confirm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { daysAgo, fmtNumber, fmtRelative } from "@/lib/format";
import { deleteRuleAction, deleteWebhookAction, revokeApiKeyAction } from "./actions";
import { ApiKeyDialog, RuleDialog, RuleToggle, WebhookDialog } from "./automation-dialogs";

export const metadata = { title: "אוטומציות" };

const STATUS_LABELS: Record<string, string> = { OPEN: "פתוחה", HANDLED: "טופל", INTERESTED: "מתעניין", NOT_INTERESTED: "לא מעוניין", NEEDS_AGENT: "ממתין לנציג" };

export default async function AutomationsPage() {
  const ctx = await requireAppContext("automations:read");
  const canWrite = ctx.can("automations:write");
  const canKeys = ctx.can("apikeys:manage");
  const [rules, keys, endpoints, tags, members, deliveries] = await Promise.all([
    listRules(ctx),
    canKeys ? listApiKeys(ctx) : Promise.resolve([]),
    db.webhookEndpoint.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "asc" } }),
    listTags(ctx),
    listMembers(ctx),
    db.webhookDelivery.groupBy({ by: ["endpointId", "status"], where: { organizationId: ctx.orgId, createdAt: { gte: daysAgo(7) } }, _count: { _all: true } }),
  ]);
  const tagMap = new Map(tags.map((t) => [t.id, t.name]));
  const memberMap = new Map(members.map((m) => [m.user.id, m.user.name]));
  const describeAction = (a: ReturnType<typeof actionsSchema.parse>[number]) =>
    a.type === "TAG_CONTACT" ? `תגית "${tagMap.get(a.tagId) ?? "?"}"` : a.type === "SET_CONVERSATION_STATUS" ? `סטטוס: ${STATUS_LABELS[a.status]}` : a.type === "ASSIGN" ? `שיוך ל${memberMap.get(a.userId) ?? "?"}` : ACTION_LABELS[a.type];

  return (
    <>
      <PageHeader title="אוטומציות ואינטגרציות" description="כללים לטיפול אוטומטי בהודעות נכנסות, מפתחות API ו-Webhooks יוצאים לחיבור n8n. המערכת עובדת עצמאית — n8n הוא תוספת, לא תלות." />
      <Tabs defaultValue="rules">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="rules">כללים ({rules.length})</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks יוצאים ({endpoints.length})</TabsTrigger>
          {canKeys ? <TabsTrigger value="keys">מפתחות API ({keys.filter((k) => !k.revokedAt).length})</TabsTrigger> : null}
          <TabsTrigger value="docs">תיעוד API</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-4">
          <Alert>
            <Bot />
            <AlertDescription>
              בקשות הסרה (&quot;הסר&quot;, כפתור הסרה) מטופלות תמיד אוטומטית ואינן ניתנות לכיבוי. כללים יכולים לתייג, ליצור לידים, לעדכן סטטוס ולשייך — אך לעולם לא לשלוח הודעות שיווקיות.
            </AlertDescription>
          </Alert>
          {canWrite ? (
            <div className="flex justify-end">
              <RuleDialog tags={tags.map((t) => ({ id: t.id, name: t.name }))} members={members.map((m) => ({ id: m.user.id, name: m.user.name }))} />
            </div>
          ) : null}
          {rules.length === 0 ? (
            <EmptyState icon={Bot} title="אין כללים" />
          ) : (
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>פעיל</TableHead>
                    <TableHead>שם</TableHead>
                    <TableHead>טריגר</TableHead>
                    <TableHead className="hidden md:table-cell">מילות מפתח</TableHead>
                    <TableHead>פעולות</TableHead>
                    <TableHead className="hidden text-end sm:table-cell">הופעל</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((r) => {
                    const cond = conditionsSchema.safeParse(r.conditions);
                    const acts = actionsSchema.safeParse(r.actions);
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <RuleToggle id={r.id} isActive={r.isActive} disabled={!canWrite} />
                        </TableCell>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-sm">{TRIGGER_LABELS[r.trigger as keyof typeof TRIGGER_LABELS] ?? r.trigger}</TableCell>
                        <TableCell className="hidden max-w-60 md:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {cond.success
                              ? cond.data.keywords.slice(0, 5).map((k) => (
                                  <Pill key={k} tone="muted">
                                    {k}
                                  </Pill>
                                ))
                              : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{acts.success ? acts.data.map(describeAction).join(" · ") : "—"}</TableCell>
                        <TableCell className="tabular hidden text-end text-sm text-muted-foreground sm:table-cell">
                          {fmtNumber(r.fireCount)}
                          {r.lastFiredAt ? <span className="block text-xs">{fmtRelative(r.lastFiredAt)}</span> : null}
                        </TableCell>
                        <TableCell>
                          {canWrite ? (
                            <div className="flex justify-end gap-1">
                              <RuleDialog
                                tags={tags.map((t) => ({ id: t.id, name: t.name }))}
                                members={members.map((m) => ({ id: m.user.id, name: m.user.name }))}
                                rule={{ id: r.id, name: r.name, trigger: r.trigger, isActive: r.isActive, conditions: cond.success ? cond.data : { keywords: [], match: "contains" }, actions: acts.success ? acts.data : [] }}
                              />
                              <ConfirmAction
                                trigger={
                                  <Button size="icon-sm" variant="ghost" aria-label="מחיקה">
                                    <Trash2 />
                                  </Button>
                                }
                                title={`מחיקת הכלל "${r.name}"`}
                                description="הכלל יימחק לצמיתות."
                                destructive
                                action={deleteRuleAction.bind(null, { id: r.id })}
                              />
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="webhooks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>שליחת אירועים ל-n8n</CardTitle>
              <CardDescription>
                כל אירוע נשלח כ-POST JSON עם חתימה בכותרת <code className="ltr">X-WCM-Signature: t=…,v1=…</code> (HMAC-SHA256 של <code className="ltr">{"`${t}.${body}`"}</code> עם הסוד). כשל → ניסיונות חוזרים עם השהיה גוברת, עד 8 פעמים.
              </CardDescription>
            </CardHeader>
            {canWrite ? (
              <CardContent>
                <WebhookDialog events={OUTGOING_EVENTS.map((e) => ({ value: e, label: OUTGOING_EVENT_LABELS[e] }))} />
              </CardContent>
            ) : null}
          </Card>
          {endpoints.length === 0 ? (
            <EmptyState icon={Webhook} title="אין Webhooks יוצאים" description="לדוגמה: שליחת כל בקשת הסרה ל-n8n כדי לעדכן גם את Google Sheets." />
          ) : (
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>שם</TableHead>
                    <TableHead>כתובת</TableHead>
                    <TableHead>אירועים</TableHead>
                    <TableHead>7 ימים אחרונים</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {endpoints.map((e) => {
                    const ok = deliveries.find((d) => d.endpointId === e.id && d.status === "SUCCEEDED")?._count._all ?? 0;
                    const bad = deliveries.filter((d) => d.endpointId === e.id && (d.status === "FAILED" || d.status === "DEAD")).reduce((s, d) => s + d._count._all, 0);
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.name}</TableCell>
                        <TableCell className="ltr max-w-64 truncate text-xs">{e.url}</TableCell>
                        <TableCell>
                          <div className="flex max-w-80 flex-wrap gap-1">
                            {e.events.map((ev) => (
                              <Pill key={ev} tone="muted">
                                {OUTGOING_EVENT_LABELS[ev as keyof typeof OUTGOING_EVENT_LABELS] ?? ev}
                              </Pill>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="text-success">{fmtNumber(ok)} הצליחו</span>
                          {bad ? <span className="block text-destructive">{fmtNumber(bad)} נכשלו</span> : null}
                        </TableCell>
                        <TableCell>
                          {canWrite ? (
                            <ConfirmAction
                              trigger={
                                <Button size="icon-sm" variant="ghost" aria-label="מחיקה">
                                  <Trash2 />
                                </Button>
                              }
                              title="מחיקת Webhook"
                              description="לא יישלחו עוד אירועים לכתובת זו."
                              destructive
                              action={deleteWebhookAction.bind(null, { id: e.id })}
                            />
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {canKeys ? (
          <TabsContent value="keys" className="space-y-4">
            <div className="flex justify-end">
              <ApiKeyDialog scopes={API_SCOPES.map((s) => ({ value: s, label: API_SCOPE_LABELS[s] }))} />
            </div>
            {keys.length === 0 ? (
              <EmptyState icon={KeyRound} title="אין מפתחות API" description="צרו מפתח עבור n8n עם ההרשאות המינימליות הנדרשות." />
            ) : (
              <Card className="py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>שם</TableHead>
                      <TableHead>מזהה</TableHead>
                      <TableHead>הרשאות</TableHead>
                      <TableHead>שימוש אחרון</TableHead>
                      <TableHead>מצב</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {keys.map((k) => (
                      <TableRow key={k.id}>
                        <TableCell className="font-medium">{k.name}</TableCell>
                        <TableCell className="ltr font-mono text-xs">wcm_{k.prefix}_…</TableCell>
                        <TableCell>
                          <div className="flex max-w-96 flex-wrap gap-1">
                            {k.scopes.map((s) => (
                              <Pill key={s} tone="muted">
                                {API_SCOPE_LABELS[s as keyof typeof API_SCOPE_LABELS] ?? s}
                              </Pill>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{k.lastUsedAt ? fmtRelative(k.lastUsedAt) : "מעולם לא"}</TableCell>
                        <TableCell>
                          {k.revokedAt ? <StatusBadge status="CANCELLED" label="בוטל" /> : k.expiresAt && k.expiresAt < new Date() ? <StatusBadge status="EXPIRED" label="פג תוקף" /> : <StatusBadge status="PASSED" label="פעיל" />}
                        </TableCell>
                        <TableCell>
                          {!k.revokedAt ? (
                            <ConfirmAction
                              trigger={
                                <Button size="icon-sm" variant="ghost" aria-label="ביטול מפתח">
                                  <Trash2 />
                                </Button>
                              }
                              title={`ביטול המפתח "${k.name}"`}
                              description="אינטגרציות המשתמשות במפתח זה יפסיקו לעבוד מיד."
                              destructive
                              confirmLabel="ביטול המפתח"
                              action={revokeApiKeyAction.bind(null, { id: k.id })}
                            />
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>
        ) : null}

        <TabsContent value="docs">
          <Card>
            <CardHeader>
              <CardTitle>REST API v1</CardTitle>
              <CardDescription>
                בסיס: <span className="ltr font-mono">{appUrl()}/api/v1</span> · אימות: <span className="ltr font-mono">Authorization: Bearer wcm_…</span> · עד 600 בקשות לדקה למפתח · תשובות: <span className="ltr font-mono">{"{ data }"}</span> או <span className="ltr font-mono">{"{ error: { code, message } }"}</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>הרשאה</TableHead>
                      <TableHead>תיאור</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      ["GET /contacts?phone=", "contacts:read", "איתור איש קשר לפי טלפון, או דפדוף (updatedSince, cursor)"],
                      ["POST /contacts", "contacts:write", "יצירה/עדכון איש קשר. הסכמה נרשמת רק עם consent.proofText"],
                      ["PATCH /contacts/:id", "contacts:write", "עדכון שם, מקור, הערות ושדות. לא ניתן לשנות הסכמה/הסרה"],
                      ["POST /contacts/import", "contacts:write", "ייבוא עד 5,000 אנשי קשר בבקשה"],
                      ["GET /consent?phone=", "consents:read", "סטטוס הסכמה, הסרה וכשירות לשיווק"],
                      ["GET /campaigns", "campaigns:read", "רשימת קמפיינים עם ספירת סטטוסים"],
                      ["GET /campaigns/:id", "campaigns:read", "דוח ביצועים מלא לקמפיין"],
                      ["GET /messages", "messages:read", "הודעות לפי campaignId / phone / updatedSince"],
                      ["POST /leads", "leads:write", "יצירת ליד (שיוך קמפיין אוטומטי לפי 7 ימים אחרונים)"],
                      ["PATCH /leads/:id", "leads:write", "עדכון סטטוס/שווי ליד"],
                      ["POST /conversions", "conversions:write", "דיווח המרה מאתר/CRM עם clickToken או טלפון. אידמפוטנטי לפי externalId"],
                      ["GET /suppressions?since=", "suppressions:read", "אירועי הסרה — לסנכרון חסימות ל-Google Sheets"],
                    ].map(([e, s, d]) => (
                      <TableRow key={e}>
                        <TableCell className="ltr whitespace-nowrap font-mono text-xs">{e}</TableCell>
                        <TableCell className="ltr font-mono text-xs">{s}</TableCell>
                        <TableCell className="text-sm">{d}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">תיעוד מלא עם דוגמאות: docs/api.md בריפוזיטורי.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
