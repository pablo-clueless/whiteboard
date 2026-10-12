"use client";

import { Activity, Flag, MonitorCog, Presentation, ShieldKeyhole } from "lucide-react";
import React, { useState } from "react";

import { Option, TabProps } from "@/types/app";
import { TabList } from "@/components/shared";
import {
  BoardConfiguration,
  FeatureFlags,
  General,
  Security,
  SystemHealth,
} from "@/components/admin/components";

type ExtendOption = Option & {
  component: (props: TabProps) => React.JSX.Element;
};

const TABS: ExtendOption[] = [
  {
    label: "Platform",
    value: "general",
    description: "Application name, logo, and basic configuration.",
    component: General,
    icon: MonitorCog,
  },
  {
    label: "Security",
    value: "security",
    description: "Password policies, two-factor authentication, and session settings.",
    component: Security,
    icon: ShieldKeyhole,
  },
  {
    label: "Board Configuration",
    value: "board-configuration",
    description: "Board configuration settings.",
    component: BoardConfiguration,
    icon: Presentation,
  },
  {
    label: "Feature Flags",
    value: "feature-flags",
    description: "Feature flags settings.",
    component: FeatureFlags,
    icon: Flag,
  },
  {
    label: "System Health",
    value: "system-health",
    description: "System health metrics.",
    component: SystemHealth,
    icon: Activity,
  },
];

const Page = () => {
  const [tab, setTab] = useState(TABS[0].value);

  return (
    <div className="space-y-6">
      <TabList onValueChange={setTab} options={TABS} value={tab} />
      {TABS.map(({ component: Component, value }) => (
        <Component key={value} tab={tab} />
      ))}
    </div>
  );
};

export default Page;
