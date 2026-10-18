"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Ban,
  Bot,
  Contact,
  FileText,
  Inbox,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Settings,
  Smartphone,
  UsersRound,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

const NAV = [
  {
    label: "ראשי",
    items: [
      { href: "/", label: "סקירה כללית", icon: LayoutDashboard },
      { href: "/campaigns", label: "קמפיינים", icon: Megaphone },
      { href: "/contacts", label: "אנשי קשר", icon: Contact },
      { href: "/audiences", label: "קבוצות וקהלים", icon: UsersRound },
      { href: "/templates", label: "תבניות הודעה", icon: FileText },
      { href: "/inbox", label: "הודעות נכנסות", icon: Inbox, badgeKey: "inbox" as const },
    ],
  },
  {
    label: "בקרה",
    items: [
      { href: "/suppressions", label: "הסרות וחסימות", icon: Ban },
      { href: "/reports", label: "דוחות ואנליטיקה", icon: BarChart3 },
    ],
  },
  {
    label: "ניהול",
    items: [
      { href: "/accounts", label: "חשבונות WhatsApp", icon: Smartphone },
      { href: "/automations", label: "אוטומציות", icon: Bot },
      { href: "/settings", label: "הגדרות", icon: Settings },
    ],
  },
];

export function AppSidebar({ orgName, unread, footer }: { orgName: string; unread: number; footer: React.ReactNode }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <Sidebar side="right" collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-1 py-1.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <MessagesSquare className="size-4.5" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-sm font-semibold">Campaign Manager</div>
            <div className="truncate text-xs text-muted-foreground">{orgName}</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.label}>
                      <Link href={item.href} onClick={() => setOpenMobile(false)}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {"badgeKey" in item && item.badgeKey === "inbox" && unread > 0 ? (
                      <SidebarMenuBadge className="bg-primary text-primary-foreground">{unread > 99 ? "99+" : unread}</SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>{footer}</SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
