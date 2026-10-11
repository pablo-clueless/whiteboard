"use client";

import { Users } from "lucide-react";

import { Statistics } from "@/components/shared";

const Page = () => {
  return (
    <div className="space-y-6 overflow-y-auto">
      <Statistics
        items={[
          {
            icon: Users,
            label: "No Label",
            value: "0",
            description: "+20% from last month",
          },
          {
            icon: Users,
            label: "No Label",
            value: "0",
            description: "+20% from last month",
          },
          {
            icon: Users,
            label: "No Label",
            value: "0",
            description: "+20% from last month",
          },
          {
            icon: Users,
            label: "No Label",
            value: "0",
            description: "+20% from last month",
          },
        ]}
        isLoading={true}
      />
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium"></p>
          <div className="w-full"></div>
        </div>
        <div className="space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium"></p>
          <div className="w-full"></div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div className="space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium"></p>
          <div className="w-full"></div>
        </div>
        <div className="col-span-2 space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium"></p>
          <div className="w-full"></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium"></p>
          <div className="w-full"></div>
        </div>
        <div className="space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium"></p>
          <div className="w-full"></div>
        </div>
      </div>
    </div>
  );
};

export default Page;
