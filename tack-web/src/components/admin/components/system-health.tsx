"use client";

import { TabPanel } from "@/components/shared";
import { TabProps } from "@/types/app";

export const SystemHealth = ({ tab }: TabProps) => {
  return (
    <TabPanel tab={tab} value="system-health">
      <div className="rounded bg-white p-4">SystemHealth</div>
    </TabPanel>
  );
};
