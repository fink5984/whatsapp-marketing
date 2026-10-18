"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronsUpDown, KeyRound, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { changePasswordAction, logoutAction, switchOrgAction } from "@/app/(app)/shell-actions";

export function UserMenu({
  user,
  roleLabel,
  orgs,
  activeOrgId,
}: {
  user: { name: string; email: string };
  roleLabel: string;
  orgs: { orgId: string; orgName: string }[];
  activeOrgId: string;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "" });
  const initials = user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("");
  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg bg-primary/10 text-primary">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-start text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{roleLabel}</span>
                </div>
                <ChevronsUpDown className="ms-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60" side="top" align="end">
              <DropdownMenuLabel className="font-normal">
                <div className="text-sm font-medium">{user.name}</div>
                <div className="ltr truncate text-xs text-muted-foreground">{user.email}</div>
              </DropdownMenuLabel>
              {orgs.length > 1 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs text-muted-foreground">החלפת עסק</DropdownMenuLabel>
                    {orgs.map((o) => (
                      <DropdownMenuItem
                        key={o.orgId}
                        disabled={pending}
                        onSelect={() => o.orgId !== activeOrgId && run(() => switchOrgAction(o.orgId), { onSuccess: () => router.push("/") })}
                      >
                        <Building2 />
                        <span className="flex-1 truncate">{o.orgName}</span>
                        {o.orgId === activeOrgId ? <Check className="size-4" /> : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setPwOpen(true)}>
                <KeyRound />
                שינוי סיסמה
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => void logoutAction()}>
                <LogOut />
                התנתקות
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>שינוי סיסמה</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pw-current">סיסמה נוכחית</Label>
              <Input id="pw-current" type="password" dir="ltr" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-next">סיסמה חדשה</Label>
              <Input id="pw-next" type="password" dir="ltr" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
              <p className="text-xs text-muted-foreground">לפחות 10 תווים, כולל אותיות ומספרים. לאחר השינוי תתבקשו להתחבר מחדש בכל המכשירים.</p>
            </div>
          </div>
          <DialogFooter>
            <Button disabled={pending} onClick={() => run(() => changePasswordAction(pw))}>
              {pending ? <Spinner /> : null}
              עדכון סיסמה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
