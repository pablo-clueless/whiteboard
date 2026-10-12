"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "cn";

import { normalizePathname } from "@/lib/utils";
import { ROUTES } from "@/config/routes";

export const Sidebar = () => {
  const pathname = usePathname();

  return (
    <aside className="h-full w-64 border-r bg-white">
      <div className="flex h-14 w-full items-center border-b px-4">
        <p className="text-ink relative inline-flex items-center gap-1 text-2xl font-black tracking-tight">
          tack
        </p>
      </div>
      <div className="flex h-[calc(100%-56px)] w-full flex-col justify-between py-4">
        <div className="space-y-6 px-4">
          {ROUTES.map((group) => {
            return (
              <div className="space-y-1" key={group.name}>
                <p className="text-muted-foreground text-[10px] uppercase">{group.name}</p>
                <div className="space-y-2">
                  {group.routes.map((route) => {
                    const isActive = pathname === normalizePathname(route.href);

                    return (
                      <Link
                        className={cn(
                          "flex items-center gap-x-2 rounded px-3 py-2 text-sm",
                          isActive ? "bg-primary text-white" : "hover:bg-gray-200",
                        )}
                        href={route.href}
                        key={route.label}
                      >
                        <route.icon className="size-4" />
                        <span>{route.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="h-11 border-t px-4"></div>
      </div>
    </aside>
  );
};
