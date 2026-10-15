"use client";

import { useApiMutation } from "@/lib/query";
import { TabPanel } from "@/components/shared";
import { useUserStore } from "@/stores/user";
import type { TabProps } from "@/types/app";
import type { User } from "@/types/user";
import { SettingsSection } from "./section";
import { ToggleRow } from "../fields";

/** Emails Tack sends the signed-in user. */
export const Notifications = ({ tab }: TabProps) => {
  const { user, setUser } = useUserStore();
  const save = useApiMutation<{ securityEmails: boolean }, User>({
    keys: [["me"]],
    method: "patch",
    url: "/api/auth/me",
    successMessage: false,
  });

  return (
    <TabPanel tab={tab} value="notifications">
      {user && (
        <SettingsSection
          description={`Sent to ${user.email}. Saved as soon as you switch them.`}
          title="Email"
        >
          <ToggleRow
            checked={user.securityEmails}
            description="When your password, email or two-factor sign-in changes, or someone signs in to your account from an address it hasn't used before. Each says where it came from, so you can act if it wasn't you."
            disabled={save.isPending}
            label="Security alerts"
            onCheckedChange={(securityEmails) =>
              save.mutate({ securityEmails }, { onSuccess: setUser })
            }
          />
          <ToggleRow
            checked
            description="Verifying your email, and resetting your password. Always sent: they're how you get back into your account."
            disabled
            label="Account emails"
            onCheckedChange={() => {}}
          />
        </SettingsSection>
      )}
    </TabPanel>
  );
};
