"use client";

import { NumberRow, RowLabel, SettingsHistory, SettingsSection } from "./section";
import type { PasswordPolicy, SecurityProps } from "@/types/system";
import { useSectionDraft, useSettings } from "./use-settings";
import { NativeSelect, ToggleRow } from "../fields";
import { TabPanel } from "@/components/shared";
import { useUserStore } from "@/stores/user";
import { TabProps } from "@/types/app";

export const Security = ({ tab }: TabProps) => {
  const { data } = useSettings();
  return (
    <TabPanel tab={tab} value="security">
      <div className="space-y-6">
        {data && <SecurityForm key={JSON.stringify(data.security)} saved={data.security} />}
        <SettingsHistory section="security" />
      </div>
    </TabPanel>
  );
};

const SecurityForm = ({ saved }: { saved: SecurityProps }) => {
  const { draft, errors, set, dirty, saving, save, reset } = useSectionDraft("security", saved);
  const retention = draft.retentionPolicy;
  const me = useUserStore((s) => s.user);
  // Turning it on sends every admin without it, this one included, to set it up first.
  const setUpNext =
    draft.twoFactorAuthentication && !saved.twoFactorAuthentication && !me?.twoFactorEnabled;

  return (
    <SettingsSection
      title="Security"
      description="Accounts, passwords and sessions."
      dirty={dirty}
      onReset={reset}
      onSave={save}
      saving={saving}
    >
      <ToggleRow
        label="Allow sign-ups"
        description="Off: only admins can add accounts."
        checked={draft.allowNewUsers}
        onCheckedChange={(v) => set("allowNewUsers", v)}
      />
      <label className="flex items-start justify-between gap-6 py-3">
        <RowLabel
          label="Password policy"
          description="For new passwords. Existing ones keep working."
          error={errors.passwordPolicy}
        />
        <NativeSelect
          className="w-64"
          onChange={(e) => set("passwordPolicy", e.target.value as PasswordPolicy)}
          options={[
            { label: "Basic: 8+ characters", value: "basic" },
            { label: "Strong: 12+, mixed case, digit, symbol", value: "strong" },
          ]}
          value={draft.passwordPolicy}
        />
      </label>
      <NumberRow
        label="Failed sign-ins before lockout"
        description="Wrong passwords and wrong codes both count. The account is locked for 15 minutes; admins can unlock it sooner."
        unit="attempts"
        min={1}
        max={100}
        value={draft.maxLoginAttempts}
        error={errors.maxLoginAttempts}
        onChange={(v) => set("maxLoginAttempts", v)}
      />
      <NumberRow
        label="Session timeout"
        description="Signed-in sessions end after this long without use."
        unit="minutes"
        min={5}
        max={129600}
        value={draft.sessionTimeout}
        error={errors.sessionTimeout}
        onChange={(v) => set("sessionTimeout", v)}
      />
      <ToggleRow
        label="Require two-factor sign-in for admins"
        description={
          setUpNext
            ? "You haven't set it up yet, so once this is saved you'll be asked to before carrying on."
            : "Admins sign in with a code from an authenticator app as well as their password. Anyone without it set up is asked to before they can use the admin. Everyone else can turn it on for themselves."
        }
        checked={draft.twoFactorAuthentication}
        onCheckedChange={(v) => set("twoFactorAuthentication", v)}
      />
      <ToggleRow
        label="Delete old records"
        description="Audit logs and connection history older than the retention period are deleted hourly."
        checked={retention.automaticDeletion}
        onCheckedChange={(v) => set("retentionPolicy", { ...retention, automaticDeletion: v })}
      />
      <NumberRow
        label="Retention period"
        unit="days"
        min={1}
        max={3650}
        value={retention.retentionPeriod}
        error={errors["retentionPolicy.retentionPeriod"]}
        onChange={(v) => set("retentionPolicy", { ...retention, retentionPeriod: v })}
      />
    </SettingsSection>
  );
};
