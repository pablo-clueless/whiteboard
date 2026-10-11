import {
  ClipboardList,
  LayoutDashboard,
  LayoutGrid,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

interface Route {
  label: string;
  href: string;
  icon: LucideIcon;
}

interface RouteConfig {
  name: string;
  routes: Route[];
}

export const ROUTES: RouteConfig[] = [
  {
    name: "main",
    routes: [
      { label: "Overview", href: "/admin/overview", icon: LayoutDashboard },
      { label: "Users", href: "/admin/users", icon: Users },
      { label: "Boards", href: "/admin/boards", icon: LayoutGrid },
    ],
  },
  {
    name: "configurations",
    routes: [
      { label: "Audit Logs", href: "/admin/logs", icon: ClipboardList },
      { label: "Settings", href: "/admin/settings", icon: Settings },
    ],
  },
];
