"use client";

import { TabPanel } from "@/components/shared";
import { TabProps } from "@/types/app";

export const FeatureFlags = ({ tab }: TabProps) => {
  return (
    <TabPanel tab={tab} value="feature-flags">
      <div>Feature Flags</div>
    </TabPanel>
  );
};
