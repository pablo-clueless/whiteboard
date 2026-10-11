"use client";

import { TabPanel } from "@/components/shared";
import { TabProps } from "@/types/app";

export const Notifications = ({ tab }: TabProps) => {
  return (
    <TabPanel tab={tab} value="notifications">
      <div>Notifications</div>
    </TabPanel>
  );
};
