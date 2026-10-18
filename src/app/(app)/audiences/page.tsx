import Link from "next/link";
import { Tags, Trash2, UsersRound } from "lucide-react";
import { requireAppContext } from "@/server/auth/current";
import { listAudiences } from "@/server/services/audiences";
import { distinctSources, listTags } from "@/server/services/contacts";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Pill } from "@/components/app/badges";
import { ConfirmAction } from "@/components/app/confirm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtNumber, fmtRelative } from "@/lib/format";
import { deleteAudienceAction } from "./actions";
import { deleteTagAction } from "../contacts/actions";
import { AudienceDialog } from "./audience-dialog";
import { TagForm } from "./tag-form";

export const metadata = { title: "קבוצות וקהלים" };

export default async function AudiencesPage() {
  const ctx = await requireAppContext("contacts:read");
  const [audiences, tags, sources] = await Promise.all([listAudiences(ctx), listTags(ctx), distinctSources(ctx)]);
  const canWrite = ctx.can("audiences:write");
  const tagOpts = tags.map((t) => ({ id: t.id, name: t.name }));
  return (
    <>
      <PageHeader
        title="קבוצות וקהלים"
        description="קבוצה סטטית מכילה אנשי קשר שנבחרו ידנית. קהל דינמי מחושב מחדש לפי כללים בכל שימוש. כשירות לשליחה נבדקת בנפרד בעת יצירת הקמפיין."
        actions={canWrite ? <AudienceDialog tags={tagOpts} sources={sources} /> : null}
      />
      <Tabs defaultValue="audiences">
        <TabsList className="mb-4">
          <TabsTrigger value="audiences">קבוצות וקהלים ({audiences.length})</TabsTrigger>
          <TabsTrigger value="tags">תגיות ({tags.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="audiences">
          {audiences.length === 0 ? (
            <EmptyState icon={UsersRound} title="אין עדיין קבוצות" description="צרו קבוצה סטטית לייבוא רשימות, או קהל דינמי לפי תגיות, מקור ופעילות." />
          ) : (
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>שם</TableHead>
                    <TableHead>סוג</TableHead>
                    <TableHead className="text-end">אנשי קשר</TableHead>
                    <TableHead className="hidden md:table-cell">תיאור</TableHead>
                    <TableHead className="hidden sm:table-cell">עודכן</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audiences.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">
                        <Link href={`/contacts?audiences=${a.id}`} className="hover:underline">
                          {a.name}
                        </Link>
                      </TableCell>
                      <TableCell>{a.kind === "DYNAMIC" ? <Pill tone="info">דינמי</Pill> : <Pill tone="muted">סטטי</Pill>}</TableCell>
                      <TableCell className="tabular text-end">{fmtNumber(a.size)}</TableCell>
                      <TableCell className="hidden max-w-72 truncate text-muted-foreground md:table-cell">{a.description ?? "—"}</TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">{fmtRelative(a.updatedAt)}</TableCell>
                      <TableCell>
                        {canWrite ? (
                          <div className="flex justify-end gap-1">
                            <AudienceDialog tags={tagOpts} sources={sources} audience={{ id: a.id, name: a.name, description: a.description, kind: a.kind as "STATIC" | "DYNAMIC", filter: (a.filter ?? {}) as Record<string, unknown> }} />
                            <ConfirmAction
                              trigger={
                                <Button size="icon-sm" variant="ghost" aria-label="מחיקה">
                                  <Trash2 />
                                </Button>
                              }
                              title={`מחיקת "${a.name}"`}
                              description="הקבוצה תימחק. אנשי הקשר עצמם לא יימחקו."
                              destructive
                              action={deleteAudienceAction.bind(null, { id: a.id })}
                              success="הקבוצה נמחקה"
                            />
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="tags">
          {canWrite ? <TagForm /> : null}
          {tags.length === 0 ? (
            <EmptyState icon={Tags} title="אין תגיות" description="תגיות מאפשרות סינון ופילוח מהיר של אנשי קשר." />
          ) : (
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>תגית</TableHead>
                    <TableHead className="text-end">אנשי קשר</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tags.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Link href={`/contacts?tags=${t.id}`} className="hover:underline">
                          <Pill tone="muted">{t.name}</Pill>
                        </Link>
                      </TableCell>
                      <TableCell className="tabular text-end">{fmtNumber(t._count.contacts)}</TableCell>
                      <TableCell>
                        {canWrite ? (
                          <ConfirmAction
                            trigger={
                              <Button size="icon-sm" variant="ghost" aria-label="מחיקת תגית">
                                <Trash2 />
                              </Button>
                            }
                            title={`מחיקת התגית "${t.name}"`}
                            description="התגית תוסר מכל אנשי הקשר."
                            destructive
                            action={deleteTagAction.bind(null, { id: t.id })}
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
      </Tabs>
    </>
  );
}
