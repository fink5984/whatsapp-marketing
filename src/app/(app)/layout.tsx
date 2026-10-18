import { cookies } from "next/headers";
import { requireAppContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { ROLE_LABELS } from "@/server/rbac";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/app/app-sidebar";
import { UserMenu } from "@/components/app/user-menu";
import { HeaderStatus } from "@/components/app/header-status";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireAppContext();
  const [unread, sidebarCookie] = await Promise.all([
    db.conversation.aggregate({ where: { organizationId: ctx.orgId, unreadCount: { gt: 0 } }, _count: { _all: true } }),
    cookies().then((c) => c.get("sidebar_state")?.value),
  ]);
  return (
    <SidebarProvider defaultOpen={sidebarCookie !== "false"}>
      <AppSidebar
        orgName={ctx.org.name}
        unread={unread._count._all}
        footer={<UserMenu user={ctx.user} roleLabel={ROLE_LABELS[ctx.role]} orgs={ctx.memberships} activeOrgId={ctx.orgId} />}
      />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur">
          <SidebarTrigger className="-ms-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="truncate text-sm font-medium text-muted-foreground">{ctx.org.name}</span>
          <div className="ms-auto">
            <HeaderStatus orgId={ctx.orgId} />
          </div>
        </header>
        <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
