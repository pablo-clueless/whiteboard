"use client";

import { usePathname, useRouter } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUserStore } from "@/stores/user";
import { getBreadcrumbs } from "@/lib/utils";
import { http } from "@/lib/client";
import { Breadcrumb } from "../shared";
import { useAdminConfig } from "./auth-gate";
import { TwoFactorDialog } from "./two-factor";
import { isAdmin } from "@/lib/permissions";

export const Header = () => {
  const pathname = usePathname();
  const router = useRouter();
  const breadcrumbs = getBreadcrumbs(pathname);
  const { user, signout } = useUserStore();
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const required = Boolean(useAdminConfig().data?.twoFactorRequired && isAdmin(user));

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
          <Breadcrumb items={breadcrumbs} />
        </div>
        {user && (
          <Popover>
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
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-100"
                onClick={() => setTwoFactorOpen(true)}
                type="button"
              >
                <ShieldCheck className="size-4" /> Two-factor sign-in
                <span className="text-muted-foreground ml-auto text-xs">
                  {user.twoFactorEnabled ? "On" : "Off"}
                </span>
              </button>
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
        <TwoFactorDialog onOpenChange={setTwoFactorOpen} open={twoFactorOpen} required={required} />
      </div>
    </header>
  );
};
