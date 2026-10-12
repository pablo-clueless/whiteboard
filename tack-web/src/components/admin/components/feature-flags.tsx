"use client";

import { TabPanel } from "@/components/shared";
import { TabProps } from "@/types/app";

export const FeatureFlags = ({ tab }: TabProps) => {
  return (
    <TabPanel tab={tab} value="feature-flags">
      <div className="rounded bg-white p-4">Feature Flags</div>
    </TabPanel>
  );
};
