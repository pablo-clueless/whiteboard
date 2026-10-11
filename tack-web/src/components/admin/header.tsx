"use client";

import { usePathname } from "next/navigation";

import { getBreadcrumbs } from "@/lib/utils";
import { Breadcrumb } from "../shared";

export const Header = () => {
  const pathname = usePathname();
  const breadcrumbs = getBreadcrumbs(pathname);

  return (
    <header className="h-14 w-full border-b bg-white px-4">
      <div className="flex h-full w-full items-center justify-between">
        <div className="flex items-center gap-x-4">
          <Breadcrumb items={breadcrumbs} />
        </div>
        <div className=""></div>
      </div>
    </header>
  );
};
