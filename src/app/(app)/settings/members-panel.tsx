"use client";

import { useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmAction } from "@/components/app/confirm";
import { useAction } from "@/hooks/use-action";
import { fmtRelative } from "@/lib/format";
import { addMemberAction, removeMemberAction, updateRoleAction } from "./actions";

type Role = "OWNER" | "ADMIN" | "CAMPAIGN_MANAGER" | "VIEWER";
const ROLES: [Role, string, string][] = [
  ["OWNER", "בעלים", "כל ההרשאות, כולל ניהול בעלים"],
  ["ADMIN", "מנהל מערכת", "הגדרות, חשבונות, משתמשים, מפתחות API, חידוש הרשמה"],
  ["CAMPAIGN_MANAGER", "מנהל קמפיינים", "אנשי קשר, תבניות, קמפיינים, תיבת הודעות"],
  ["VIEWER", "צופה", "צפייה בלבד"],
];

export function MembersPanel({ members, canManage, isOwner, selfId }: { members: { userId: string; name: string; email: string; role: Role; lastLoginAt: string | null }[]; canManage: boolean; isOwner: boolean; selfId: string }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ email: "", name: "", role: "CAMPAIGN_MANAGER" as Role, password: "" });
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 py-4">
        <div>
          <CardTitle>משתמשים והרשאות</CardTitle>
          <CardDescription>ההרשאות נאכפות בכל פעולה בשרת, לא רק בממשק.</CardDescription>
        </div>
        {canManage ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus />
                הוספת משתמש
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>הוספת משתמש</DialogTitle>
                <DialogDescription>מסרו את הסיסמה הראשונית בערוץ מאובטח ובקשו להחליפה בכניסה הראשונה. אם המשתמש כבר קיים במערכת — הסיסמה לא תשתנה.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="m-name">שם</Label>
                    <Input id="m-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="m-email">דוא״ל</Label>
                    <Input id="m-email" dir="ltr" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>תפקיד</Label>
                  <Select value={f.role} onValueChange={(v) => setF({ ...f, role: v as Role })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.filter(([r]) => r !== "OWNER" || isOwner).map(([r, l, d]) => (
                        <SelectItem key={r} value={r}>
                          {l} — <span className="text-muted-foreground">{d}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="m-pw">סיסמה ראשונית</Label>
                  <Input id="m-pw" dir="ltr" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
                  <p className="text-xs text-muted-foreground">לפחות 10 תווים, אותיות ומספרים</p>
                </div>
              </div>
              <DialogFooter>
                <Button disabled={pending} onClick={() => run(() => addMemberAction(f), { success: "המשתמש נוסף", onSuccess: () => (setOpen(false), setF({ email: "", name: "", role: "CAMPAIGN_MANAGER", password: "" })) })}>
                  {pending ? <Spinner /> : null}
                  הוספה
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>שם</TableHead>
              <TableHead>דוא״ל</TableHead>
              <TableHead>תפקיד</TableHead>
              <TableHead className="hidden sm:table-cell">כניסה אחרונה</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.userId}>
                <TableCell className="font-medium">
                  {m.name}
                  {m.userId === selfId ? <span className="text-muted-foreground"> (את/ה)</span> : null}
                </TableCell>
                <TableCell className="ltr text-sm">{m.email}</TableCell>
                <TableCell>
                  {canManage && m.userId !== selfId && (m.role !== "OWNER" || isOwner) ? (
                    <Select value={m.role} onValueChange={(v) => run(() => updateRoleAction({ userId: m.userId, role: v as Role }), { success: "התפקיד עודכן" })}>
                      <SelectTrigger size="sm" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.filter(([r]) => r !== "OWNER" || isOwner).map(([r, l]) => (
                          <SelectItem key={r} value={r}>
                            {l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    ROLES.find(([r]) => r === m.role)?.[1]
                  )}
                </TableCell>
                <TableCell suppressHydrationWarning className="hidden text-sm text-muted-foreground sm:table-cell">{m.lastLoginAt ? fmtRelative(m.lastLoginAt) : "מעולם לא"}</TableCell>
                <TableCell>
                  {canManage && m.userId !== selfId && (m.role !== "OWNER" || isOwner) ? (
                    <ConfirmAction
                      trigger={
                        <Button size="icon-sm" variant="ghost" aria-label="הסרת משתמש">
                          <Trash2 />
                        </Button>
                      }
                      title={`הסרת ${m.name}`}
                      description="המשתמש יאבד גישה לעסק זה מיד."
                      destructive
                      action={() => removeMemberAction({ userId: m.userId })}
                      success="המשתמש הוסר"
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
