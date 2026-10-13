import React from "react";

import { QueryProvider } from "@/components/providers/query-provider";
import { AuthGate, Header, Sidebar } from "@/components/admin";

interface Props {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: Props) {
  return (
    <QueryProvider>
      <AuthGate>
        <div className="flex h-screen w-screen overflow-hidden">
          <Sidebar />
          <div className="h-full flex-1">
            <Header />
            <div className="h-[calc(100%-56px)] w-full overflow-y-auto p-4">{children}</div>
          </div>
        </div>
      </AuthGate>
    </QueryProvider>
  );
}
