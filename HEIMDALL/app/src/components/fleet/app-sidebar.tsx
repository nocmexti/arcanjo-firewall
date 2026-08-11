import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Server,
  Ruler,
  ShieldAlert,
  ArrowUpCircle,
  Archive,
  Cpu,
  ScrollText,
  Settings,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const groups = [
  {
    label: "Operations",
    items: [
      { title: "Dashboard", url: "/", icon: LayoutDashboard, exact: true },
      { title: "Devices", url: "/dispositivos", icon: Server },
      { title: "Agents", url: "/agentes", icon: Cpu },
      { title: "Backups", url: "/backups", icon: Archive },
    ],
  },
  {
    label: "Standardization",
    items: [
      { title: "Baselines", url: "/baselines", icon: Ruler },
      { title: "Compliance", url: "/conformidade", icon: ShieldAlert },
      { title: "Deploy", url: "/atualizacoes", icon: ArrowUpCircle },
    ],
  },
  {
    label: "Governance",
    items: [
      { title: "Audit", url: "/auditoria", icon: ScrollText },
      { title: "Settings", url: "/configuracoes", icon: Settings },
    ],
  },
] as const;

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <img src="/logo.png" alt="HEIMDALL" className="size-8 shrink-0 rounded-sm object-cover" />
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">HEIMDALL</p>
              <p className="truncate text-[11px] text-muted-foreground">multi-site security</p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active =
                    "exact" in item && item.exact
                      ? pathname === item.url
                      : pathname.startsWith(item.url);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link to={item.url} className="flex items-center gap-2">
                          <item.icon className="size-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
