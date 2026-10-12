"use client";

import { TabPanel } from "@/components/shared";
import { TabProps } from "@/types/app";

export const General = ({ tab }: TabProps) => {
  return (
    <TabPanel tab={tab} value="general">
      <div className="rounded bg-white p-4">Platform</div>
    </TabPanel>
  );
};
