"use client";

import { ClipboardList } from "lucide-react";

import { DataTable, Statistics } from "@/components/shared";
import { logColumns } from "@/config/columns/log";

const Page = () => {
  return (
    <div className="space-y-6 overflow-y-auto">
      <Statistics
        items={[
          { icon: ClipboardList, label: "Total Logs", value: "0", description: "+0% from last month" },
          { icon: ClipboardList, label: "Today's Logs", value: "0", description: "+0% from last month" },
          { icon: ClipboardList, label: "This Week", value: "0", description: "+0% from last month" },
          { icon: ClipboardList, label: "This Month", value: "0", description: "+0% from last month" },
        ]}
        isLoading={true}
      />
      <DataTable
        columns={logColumns}
        data={[]}
        total={0}
        filters={[{ key: "action", label: "Action", options: [], type: "checkbox" }]}
        onFilter={() => {}}
      />
    </div>
  );
};

export default Page;
