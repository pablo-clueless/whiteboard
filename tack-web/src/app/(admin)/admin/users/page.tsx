"use client";

import { UserCheck, UserPlus, Users, UserStar } from "lucide-react";

import { ButtonGroup, DataTable, Statistics } from "@/components/shared";
import { userColumns } from "@/config/columns/user";
import { useValues } from "@/hooks/use-values";
import { PERIODS } from "@/config/params";

const Page = () => {
  const { onValueChange, values } = useValues({ period: PERIODS[0].value });

  return (
    <div className="space-y-6 overflow-y-auto">
      <Statistics
        items={[
          { icon: Users, label: "Total Users", value: "20", description: "+20% from last month" },
          {
            icon: UserCheck,
            label: "Monthly Active Users",
            value: "20",
            description: "+20% from last month",
          },
          {
            icon: UserStar,
            label: "Monthly Unique Users",
            value: "20",
            description: "+20% from last month",
          },
          {
            icon: UserPlus,
            label: "Monthly New Users",
            value: "20",
            description: "+20% from last month",
          },
        ]}
        isLoading={true}
      />
      <div className="flex w-full items-center justify-end">
        <ButtonGroup
          onValueChange={(value) => onValueChange("period", value)}
          options={PERIODS}
          value={values.period}
        />
      </div>
      <DataTable
        columns={userColumns}
        data={[]}
        total={20}
        filters={[{ key: "status", label: "Status", options: [], type: "checkbox" }]}
        onFilter={() => {}}
      />
    </div>
  );
};

export default Page;
