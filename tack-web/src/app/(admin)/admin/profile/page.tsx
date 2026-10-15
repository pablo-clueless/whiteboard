"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, Fingerprint, Palette, User } from "lucide-react";
import React, { Suspense, useEffect } from "react";

import { Account, Appearance, Notifications, SelfSecurity } from "@/components/admin/components";
import { useSettingsDirty } from "@/components/admin/components/use-settings";
import { Option, TabProps } from "@/types/app";
import { useConfirm } from "@/components/admin";
import { TabList } from "@/components/shared";

type ExtendOption = Option & {
  component: (props: TabProps) => React.JSX.Element;
};

const TABS: ExtendOption[] = [
  {
    label: "Account",
    value: "account",
    description: "Your name and email.",
    component: Account,
    icon: User,
  },
  {
    label: "Security",
    value: "security",
    description: "Password, two-factor sign-in and where you're signed in.",
    component: SelfSecurity,
    icon: Fingerprint,
  },
  {
    label: "Notifications",
    value: "notifications",
    description: "Emails Tack sends you.",
    component: Notifications,
    icon: Bell,
  },
  {
    label: "Appearance",
    value: "appearance",
    description: "Your name and colour on boards.",
    component: Appearance,
    icon: Palette,
  },
];

const ProfilePage = () => {
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
    <ProfilePage />
  </Suspense>
);

export default Page;
