"use client";

import { usePathname, useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBreadcrumbStore } from "@/stores/breadcrumbs";
import { useUserStore } from "@/stores/user";
import { getBreadcrumbs } from "@/lib/utils";
import { Breadcrumb } from "../shared";
import { http } from "@/lib/client";

export const Header = () => {
  const pathname = usePathname();
  const router = useRouter();
  const labels = useBreadcrumbStore((s) => s.labels);
  const breadcrumbs = getBreadcrumbs(pathname, labels);
  const { user, signout } = useUserStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const onSignout = async () => {
    // Forget the session locally even if the server can't be reached.
    await http.post("/api/auth/signout").catch(() => {});
    signout();
    router.replace("/signin");
  };

  return (
    <header className="h-14 w-full border-b bg-white px-4">
      <div className="flex h-full w-full items-center justify-between">
        <div className="flex items-center gap-x-4">
          <Breadcrumb items={breadcrumbs} homeHref="/admin/overview" />
        </div>
        {user && (
          <Popover onOpenChange={setMenuOpen} open={menuOpen}>
            <PopoverTrigger className="flex items-center gap-x-2 rounded-md px-2 py-1 hover:bg-gray-100">
              <span className="bg-primary grid size-7 place-items-center rounded-full text-xs font-semibold text-white">
                {user.name.charAt(0).toUpperCase()}
              </span>
              <span className="text-left">
                <span className="block text-sm leading-tight font-medium">{user.name}</span>
                <span className="text-muted-foreground block text-xs leading-tight capitalize">
                  {user.type === "superadmin" ? "Superadmin" : user.role}
                </span>
              </span>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 gap-1 p-1">
              <p className="text-muted-foreground truncate px-2 py-1.5 text-xs">{user.email}</p>
              <Link
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-100"
                href="/admin/profile"
                onClick={() => setMenuOpen(false)}
              >
                <Settings className="size-4" /> Your settings
              </Link>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-red-500 hover:bg-red-100/90"
                onClick={onSignout}
                type="button"
              >
                <LogOut className="size-4" /> Sign out
              </button>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </header>
  );
};
