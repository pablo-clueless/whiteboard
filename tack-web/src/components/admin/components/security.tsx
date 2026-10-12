"use client";

import { TabPanel } from "@/components/shared";
import { TabProps } from "@/types/app";

export const Security = ({ tab }: TabProps) => {
  return (
    <TabPanel tab={tab} value="security">
      <div className="rounded bg-white p-4">Security</div>
    </TabPanel>
  );
};
