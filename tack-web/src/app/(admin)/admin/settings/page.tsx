"use client";

import React, { useState } from "react";
import { cn } from "cn";

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
    label: "General",
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
      <div className="bg-primary/10 flex items-center rounded-md p-1">
        {TABS.map(({ label, value }) => (
          <button
            className={cn(
              "flex flex-1 items-center justify-center py-2 text-sm font-medium",
              tab === value ? "text-primary rounded-md bg-white" : "",
            )}
            key={value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {TABS.map(({ component: Component, value }) => (
        <Component key={value} tab={tab} />
      ))}
    </div>
  );
};

export default Page;
