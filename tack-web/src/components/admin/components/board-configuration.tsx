"use client";

import { TabPanel } from "@/components/shared";
import { TabProps } from "@/types/app";

export const BoardConfiguration = ({ tab }: TabProps) => {
  return (
    <TabPanel tab={tab} value="board-configuration">
      <div className="rounded bg-white p-4">Board Configuration</div>
    </TabPanel>
  );
};
