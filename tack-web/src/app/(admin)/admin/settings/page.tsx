"use client";

import { Activity, Flag, MonitorCog, Presentation, ShieldKeyhole } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { Suspense, useEffect } from "react";

import { Option, TabProps } from "@/types/app";
import { TabList } from "@/components/shared";
import { useConfirm } from "@/components/admin";
import { useSettingsDirty } from "@/components/admin/components/use-settings";
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

const SettingsPage = () => {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const requested = params.get("tab");
  const tab = TABS.find((t) => t.value === requested)?.value ?? TABS[0].value;
  const dirty = useSettingsDirty((s) => Object.values(s.dirty).some(Boolean));
  const { dialog, confirm } = useConfirm();

  // Reloading or closing the tab with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const go = (value: string) => router.replace(`${pathname}?tab=${value}`, { scroll: false });

  // Hidden tabs unmount, so switching would drop a draft without a word.
  const setTab = (value: string) => {
    if (value === tab) return;
    if (!dirty) return go(value);
    confirm({
      title: "Discard unsaved changes?",
      description: "Changes on this tab haven't been saved. Switching tabs throws them away.",
      confirmLabel: "Discard",
      destructive: true,
      onConfirm: () => go(value),
    });
  };

  return (
    <div className="space-y-6">
      <TabList onValueChange={setTab} options={TABS} value={tab} />
      {TABS.map(({ component: Component, value }) => (
        <Component key={value} tab={tab} />
      ))}
      {dialog}
    </div>
  );
};

/** useSearchParams needs a Suspense boundary. */
const Page = () => (
  <Suspense>
    <SettingsPage />
  </Suspense>
);

export default Page;
