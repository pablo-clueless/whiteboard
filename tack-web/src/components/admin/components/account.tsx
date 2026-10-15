"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useState } from "react";

import { useReportDirty } from "./use-settings";
import { TabPanel } from "@/components/shared";
import { Input } from "@/components/ui/input";
import { useApiMutation } from "@/lib/query";
import { useUserStore } from "@/stores/user";
import type { TabProps } from "@/types/app";
import { DetailRow, Panel } from "../panel";
import { SettingsSection } from "./section";
import type { User } from "@/types/user";
import { FormField } from "../fields";

/** The signed-in user's name and email. */
export const Account = ({ tab }: TabProps) => {
  const user = useUserStore((s) => s.user);
  return (
    <TabPanel tab={tab} value="account">
      {/* Keyed so the form starts again from what was saved. */}
      {user && <AccountForm key={`${user.name}\n${user.email}`} user={user} />}
    </TabPanel>
  );
};

const AccountForm = ({ user }: { user: User }) => {
  const setUser = useUserStore((s) => s.setUser);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const emailChanged = email.trim().toLowerCase() !== user.email;
  const dirty = name.trim() !== user.name || emailChanged;
  useReportDirty("account", dirty);

  const save = useApiMutation<{ name?: string; email?: string; currentPassword?: string }, User>({
    keys: [["me"], ["admin", "user"], ["admin", "users"]],
    method: "patch",
    url: "/api/auth/me",
    successMessage: false,
    onFieldError: (field, message) => setErrors({ [field]: message }),
  });
  const resend = useApiMutation({
    keys: ["me"],
    method: "post",
    url: "/api/auth/me/verify-email",
    successMessage: `Verification link sent to ${user.email}`,
  });

  const submit = () => {
    setErrors({});
    save.mutate(
      {
        name: name.trim(),
        ...(emailChanged ? { email: email.trim(), currentPassword } : {}),
      },
      { onSuccess: setUser },
    );
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        description="How you appear to other admins, and where Tack emails you."
        dirty={dirty}
        onReset={() => {
          setName(user.name);
          setEmail(user.email);
          setCurrentPassword("");
          setErrors({});
        }}
        onSave={submit}
        saving={save.isPending}
        title="Profile"
      >
        <div className="grid gap-4 py-3 sm:grid-cols-2">
          <FormField label="Name">
            {(id) => (
              <Input
                autoComplete="name"
                id={id}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                required
                value={name}
              />
            )}
          </FormField>
          <FormField
            hint={
              errors.email ? (
                <span className="text-destructive">{errors.email}</span>
              ) : user.emailVerified ? (
                <span className="inline-flex items-center gap-1">
                  <CircleCheck className="size-3 text-green-600" /> Verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <CircleAlert className="size-3 text-amber-600" /> Not verified yet.
                  <button
                    className="text-primary underline-offset-2 hover:underline disabled:opacity-50"
                    disabled={resend.isPending}
                    onClick={() => resend.mutate(undefined)}
                    type="button"
                  >
                    Send the link again
                  </button>
                </span>
              )
            }
            label="Email"
          >
            {(id) => (
              <Input
                aria-invalid={Boolean(errors.email)}
                autoComplete="email"
                id={id}
                onChange={(e) => setEmail(e.target.value)}
                required
                type="email"
                value={email}
              />
            )}
          </FormField>
        </div>
        {emailChanged && (
          <div className="space-y-3 py-3">
            <p className="text-muted-foreground text-xs">
              We&apos;ll send a link to the new address to verify it, and let {user.email} know
              about the change.
            </p>
            <FormField
              hint={
                errors.currentPassword && (
                  <span className="text-destructive">{errors.currentPassword}</span>
                )
              }
              label="Current password"
            >
              {(id) => (
                <Input
                  aria-invalid={Boolean(errors.currentPassword)}
                  autoComplete="current-password"
                  className="sm:max-w-xs"
                  id={id}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  type="password"
                  value={currentPassword}
                />
              )}
            </FormField>
          </div>
        )}
      </SettingsSection>

      <Panel title="Access">
        <div className="divide-y">
          <DetailRow label="Role">
            <span className="capitalize">
              {user.type === "superadmin" ? "Superadmin" : user.role}
            </span>
          </DetailRow>
          <DetailRow label="Permissions">{user.permissions.join(", ") || "None"}</DetailRow>
          <DetailRow label="Member since">
            {new Date(user.createdAt).toLocaleDateString()}
          </DetailRow>
        </div>
        <p className="text-muted-foreground text-xs">
          Another admin changes these from the Users page.
        </p>
      </Panel>
    </div>
  );
};
