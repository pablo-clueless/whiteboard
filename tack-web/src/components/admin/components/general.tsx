"use client";

import { TabPanel } from "@/components/shared";
import { TabProps } from "@/types/app";

export const General = ({ tab }: TabProps) => {
  return (
    <TabPanel tab={tab} value="general">
      <div>General</div>
    </TabPanel>
  );
};
