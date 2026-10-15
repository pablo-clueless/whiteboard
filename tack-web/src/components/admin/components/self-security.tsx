"use client";

import { LogOut, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

import { useApiMutation, useApiQuery } from "@/lib/query";
import { PASSWORD_POLICIES } from "@/components/auth/auth-forms";
import type { UserSession } from "@/types/admin";
import { Button } from "@/components/ui/button";
import { TabPanel } from "@/components/shared";
import { Input } from "@/components/ui/input";
import { isAdmin } from "@/lib/permissions";
import { useUserStore } from "@/stores/user";
import type { TabProps } from "@/types/app";
import { EmptyNote, Panel } from "../panel";
import { TwoFactorDialog } from "../two-factor";
import { useAdminConfig } from "../auth-gate";
import { useReportDirty } from "./use-settings";
import { SettingsSection } from "./section";
import { FormField } from "../fields";

const SESSIONS_KEY = ["me", "sessions"];

/** One of my sessions; `current` is this browser's. */
type MySession = UserSession & { current: boolean };

/** The signed-in user's password, two-factor sign-in and sessions. */
export const SelfSecurity = ({ tab }: TabProps) => (
  <TabPanel tab={tab} value="security">
    <div className="space-y-6">
      <PasswordForm />
      <TwoFactor />
      <Sessions />
    </div>
  </TabPanel>
);

const PasswordForm = () => {
  const policy = PASSWORD_POLICIES[useAdminConfig().data?.passwordPolicy ?? "basic"];
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = Object.values(form).some(Boolean);
  useReportDirty("password", dirty);

  const save = useApiMutation<{ currentPassword: string; newPassword: string }>({
    keys: [SESSIONS_KEY],
    method: "post",
    url: "/api/auth/password",
    successMessage: "Password changed. Other sessions were signed out.",
    onFieldError: (field, message) => setErrors({ [field]: message }),
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const error = (key: string) =>
    errors[key] && <span className="text-destructive">{errors[key]}</span>;

  return (
    <SettingsSection
      description="Changing it signs you out everywhere else."
      dirty={dirty}
      onReset={() => {
        setForm({ currentPassword: "", newPassword: "", confirm: "" });
        setErrors({});
      }}
      onSave={() => {
        if (form.newPassword !== form.confirm) {
          setErrors({ confirm: "The passwords don't match." });
          return;
        }
        setErrors({});
        save.mutate(
          { currentPassword: form.currentPassword, newPassword: form.newPassword },
          { onSuccess: () => setForm({ currentPassword: "", newPassword: "", confirm: "" }) },
        );
      }}
      saving={save.isPending}
      title="Password"
    >
      <div className="grid gap-4 py-3 sm:grid-cols-3">
        <FormField hint={error("currentPassword")} label="Current password">
          {(id) => (
            <Input
              aria-invalid={Boolean(errors.currentPassword)}
              autoComplete="current-password"
              id={id}
              onChange={set("currentPassword")}
              required
              type="password"
              value={form.currentPassword}
            />
          )}
        </FormField>
        <FormField hint={error("newPassword") || policy.hint} label="New password">
          {(id) => (
            <Input
              aria-invalid={Boolean(errors.newPassword)}
              autoComplete="new-password"
              id={id}
              minLength={policy.min}
              onChange={set("newPassword")}
              required
              type="password"
              value={form.newPassword}
            />
          )}
        </FormField>
        <FormField hint={error("confirm")} label="Confirm new password">
          {(id) => (
            <Input
              aria-invalid={Boolean(errors.confirm)}
              autoComplete="new-password"
              id={id}
              onChange={set("confirm")}
              required
              type="password"
              value={form.confirm}
            />
          )}
        </FormField>
      </div>
    </SettingsSection>
  );
};

const TwoFactor = () => {
  const user = useUserStore((s) => s.user);
  const required = Boolean(useAdminConfig().data?.twoFactorRequired && isAdmin(user));
  const [open, setOpen] = useState(false);
  const on = Boolean(user?.twoFactorEnabled);

  return (
    <Panel
      action={
        <Button onClick={() => setOpen(true)} size="sm" variant="outline">
          {on ? "Manage" : "Set up"}
        </Button>
      }
      title="Two-factor sign-in"
    >
      <p className="flex items-start gap-2 text-sm">
        {on ? (
          <>
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-green-600" />
            On. Signing in asks for a code from your authenticator app as well as your password.
          </>
        ) : (
          <>
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
            Off. Anyone with your password can sign in as you.
          </>
        )}
      </p>
      {required && (
        <p className="text-muted-foreground text-xs">
          The security settings require it for admins.
        </p>
      )}
      <TwoFactorDialog onOpenChange={setOpen} open={open} required={required} />
    </Panel>
  );
};

const Sessions = () => {
  const { data: sessions, isPending } = useApiQuery<MySession[]>({
    keys: SESSIONS_KEY,
    url: "/api/auth/sessions",
  });
  const revokeOthers = useApiMutation({
    keys: [SESSIONS_KEY],
    method: "delete",
    url: "/api/auth/sessions",
    successMessage: "Signed out everywhere else",
  });
  const revokeOne = useApiMutation<{ id: string }>({
    keys: [SESSIONS_KEY],
    method: "delete",
    url: ({ id }) => `/api/auth/sessions/${id}`,
    successMessage: "Session signed out",
  });
  const others = (sessions ?? []).filter((s) => !s.current).length;

  return (
    <Panel
      action={
        others > 0 && (
          <Button
            disabled={revokeOthers.isPending}
            onClick={() => revokeOthers.mutate(undefined)}
            size="sm"
            variant="outline"
          >
            <LogOut /> Sign out everywhere else
          </Button>
        )
      }
      title="Where you're signed in"
    >
      {sessions?.length ? (
        <ul className="divide-y rounded-md border">
          {sessions.map((s) => (
            <li className="flex items-center justify-between gap-2 px-3 py-2 text-sm" key={s.id}>
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate">
                  <span className="capitalize">
                    {s.metadata.browser ?? "Unknown browser"} on{" "}
                    {s.metadata.device ?? "unknown device"}
                  </span>
                  {s.current && (
                    <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-700">
                      This browser
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {s.metadata.ip ?? "—"} · signed in{" "}
                  {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })} · active{" "}
                  {formatDistanceToNow(new Date(s.lastSeenAt), { addSuffix: true })}
                </p>
              </div>
              {!s.current && (
                <Button
                  aria-label="Sign out this session"
                  disabled={revokeOne.isPending}
                  onClick={() => revokeOne.mutate({ id: s.id })}
                  size="icon-sm"
                  variant="ghost"
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyNote>{isPending ? "Loading…" : "No sessions."}</EmptyNote>
      )}
    </Panel>
  );
};
