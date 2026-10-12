"use client";

import React, { useState } from "react";

import { TabList } from "@/components/shared";
import { Option, TabProps } from "@/types/app";
import {
  BoardConfiguration,
  FeatureFlags,
  General,
  Notifications,
  Security,
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
  },
  {
    label: "Security",
    value: "security",
    description: "Password policies, two-factor authentication, and session settings.",
    component: Security,
  },
  {
    label: "Board Configuration",
    value: "board-configuration",
    description: "Board configuration settings.",
    component: BoardConfiguration,
  },
  {
    label: "Feature Flags",
    value: "feature-flags",
    description: "Feature flags settings.",
    component: FeatureFlags,
  },
  {
    label: "Notifications",
    value: "notifications",
    description: "Email and in-app notification preferences.",
    component: Notifications,
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
