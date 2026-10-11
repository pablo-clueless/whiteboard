import { Bell, LayoutDashboard, Settings, Users, type LucideIcon } from "lucide-react";

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
    ],
  },
  {
    name: "configurations",
    routes: [
      { label: "Notifications", href: "/admin/notifications", icon: Bell },
      { label: "Settings", href: "/admin/settings", icon: Settings },
    ],
  },
];
