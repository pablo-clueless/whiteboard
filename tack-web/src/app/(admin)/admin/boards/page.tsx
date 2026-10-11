"use client";

import { LayoutGrid, Users } from "lucide-react";

import { DataTable, Statistics } from "@/components/shared";
import { boardColumns } from "@/config/columns/board";

const Page = () => {
  return (
    <div className="space-y-6 overflow-y-auto">
      <Statistics
        items={[
          {
            icon: LayoutGrid,
            label: "Total Boards",
            value: "0",
            description: "+0% from last month",
          },
          {
            icon: LayoutGrid,
            label: "Active Boards",
            value: "0",
            description: "+0% from last month",
          },
          { icon: Users, label: "Collaborators", value: "0", description: "+0% from last month" },
          {
            icon: LayoutGrid,
            label: "Archived Boards",
            value: "0",
            description: "+0% from last month",
          },
        ]}
        isLoading={true}
      />
      <DataTable
        columns={boardColumns}
        data={[]}
        total={0}
        filters={[{ key: "status", label: "Status", options: [], type: "checkbox" }]}
        onFilter={() => {}}
      />
    </div>
  );
};

export default Page;
