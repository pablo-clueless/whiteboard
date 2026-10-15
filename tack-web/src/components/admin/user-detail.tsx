"use client";

import { ArrowLeft, KeyRound, LockOpen, LogOut, Trash2, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import Link from "next/link";

import { FormField, NativeSelect, ROLE_OPTIONS, STATUS_OPTIONS } from "./fields";
import { useApiMutation, useApiQuery } from "@/lib/query";
import { useBreadcrumbLabel } from "@/stores/breadcrumbs";
import { StatusCell } from "@/config/columns/core";
import { DetailRow, EmptyNote, Panel } from "./panel";
import { EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import type { UserDetail } from "@/types/admin";
import { Input } from "@/components/ui/input";
import { useUserStore } from "@/stores/user";
import { ActivityList } from "./activity-list";
import { HttpError } from "@/lib/client";
import { useConfirm } from "./confirm";

const USER_KEYS = [
  ["admin", "users"],
  ["admin", "user"],
];

const USER_STATUS = {
  active: "success",
  deleted: "danger",
  inactive: "neutral",
  pending: "warning",
  suspended: "amber",
} as const;

/** "← Users", back to the list. */
export const BackLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link
    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
    href={href}
  >
    <ArrowLeft className="size-4" /> {children}
  </Link>
);

/** One account's page: details, editing, sessions and activity. */
export const UserDetailView = ({ userId }: { userId: string }) => {
  const { data: user, error } = useApiQuery<UserDetail>({
    keys: ["admin", "user", userId],
    url: `/api/admin/users/${userId}`,
  });
  useBreadcrumbLabel(userId, user?.name);

  if (error && !user) {
    const missing = error instanceof HttpError && error.status === 404;
    return (
      <div className="space-y-4">
        <BackLink href="/admin/users">Users</BackLink>
        <EmptyState
          description={missing ? "It may have been deleted for good." : error.message}
          title={missing ? "No such user" : "Couldn't load this user"}
        />
      </div>
    );
  }
  if (!user || user.id !== userId) {
    return <p className="text-muted-foreground py-10 text-center text-sm">Loading…</p>;
  }
  // Keyed so the form starts from the loaded user, and resets when it changes on the server.
  return <UserDetails key={user.id + user.updatedAt} user={user} />;
};

const UserDetails = ({ user }: { user: UserDetail }) => {
  const router = useRouter();
  const me = useUserStore((s) => s.user);
  const isSelf = me?.id === user.id;
  const canTouchSuperadmins = me?.type === "superadmin";
  const locked = user.type === "superadmin" && !canTouchSuperadmins;
  const { dialog, confirm } = useConfirm();

  const [form, setForm] = useState({
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    type: user.type,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const update = useApiMutation<Partial<typeof form>>({
    keys: USER_KEYS,
    method: "patch",
    url: `/api/admin/users/${user.id}`,
    successMessage: "User updated",
  });
  const revokeAll = useApiMutation({
    keys: USER_KEYS,
    method: "delete",
    url: `/api/admin/users/${user.id}/sessions`,
    successMessage: "Signed out everywhere",
  });
  const revokeOne = useApiMutation<{ id: string }>({
    keys: USER_KEYS,
    method: "delete",
    url: ({ id }) => `/api/admin/users/${user.id}/sessions/${id}`,
    successMessage: "Session revoked",
  });
  const unlock = useApiMutation({
    keys: USER_KEYS,
    method: "post",
    url: `/api/admin/users/${user.id}/unlock`,
    successMessage: "Account unlocked",
  });
  const resetTwoFactor = useApiMutation({
    keys: USER_KEYS,
    method: "post",
    url: `/api/admin/users/${user.id}/reset-two-factor`,
    successMessage: "Two-factor sign-in turned off, and signed out everywhere",
  });
  const sendReset = useApiMutation({
    keys: USER_KEYS,
    method: "post",
    url: `/api/admin/users/${user.id}/reset-password`,
    successMessage: "Reset link sent",
  });
  const remove = useApiMutation({
    keys: USER_KEYS,
    method: "delete",
    url: `/api/admin/users/${user.id}`,
    successMessage: "User deleted",
  });

  // Send only what changed, so an admin editing a name can't trip the access checks.
  const changes = Object.fromEntries(
    Object.entries(form).filter(([key, value]) => user[key as keyof typeof form] !== value),
  ) as Partial<typeof form>;
  const dirty = Object.keys(changes).length > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackLink href="/admin/users">Users</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <span className="bg-primary grid size-10 shrink-0 place-items-center rounded-full font-semibold text-white">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xl font-medium">
              <span className="truncate">{user.name}</span>
              <StatusCell config={USER_STATUS} status={user.status} />
            </p>
            <p className="text-muted-foreground truncate text-sm">
              {user.email} ·{" "}
              {user.type === "superadmin" ? (
                "Superadmin"
              ) : (
                <span className="capitalize">{user.role}</span>
              )}
              {isSelf && " · you"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Account">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (dirty) update.mutate(changes);
              }}
            >
              {locked && (
                <p className="text-muted-foreground text-xs">
                  Only a superadmin can change a superadmin.
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Name">
                  {(id) => (
                    <Input
                      disabled={locked}
                      id={id}
                      onChange={(e) => set("name", e.target.value)}
                      value={form.name}
                    />
                  )}
                </FormField>
                <FormField label="Email">
                  {(id) => (
                    <Input
                      disabled={locked}
                      id={id}
                      onChange={(e) => set("email", e.target.value)}
                      type="email"
                      value={form.email}
                    />
                  )}
                </FormField>
                <FormField
                  label="Role"
                  hint={
                    isSelf
                      ? "You can't change your own access."
                      : "Resets permissions to the role's."
                  }
                >
                  {(id) => (
                    <NativeSelect
                      disabled={locked || isSelf}
                      id={id}
                      onChange={(e) => set("role", e.target.value as typeof form.role)}
                      options={ROLE_OPTIONS}
                      value={form.role}
                    />
                  )}
                </FormField>
                <FormField label="Status">
                  {(id) => (
                    <NativeSelect
                      disabled={locked || isSelf}
                      id={id}
                      onChange={(e) => set("status", e.target.value as typeof form.status)}
                      options={STATUS_OPTIONS}
                      value={form.status}
                    />
                  )}
                </FormField>
                {canTouchSuperadmins && (
                  <FormField label="Type">
                    {(id) => (
                      <NativeSelect
                        disabled={isSelf}
                        id={id}
                        onChange={(e) => set("type", e.target.value as typeof form.type)}
                        options={[
                          { label: "Client", value: "client" },
                          { label: "Superadmin", value: "superadmin" },
                        ]}
                        value={form.type}
                      />
                    )}
                  </FormField>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  disabled={!dirty || update.isPending}
                  onClick={() =>
                    setForm({
                      name: user.name,
                      email: user.email,
                      role: user.role,
                      status: user.status,
                      type: user.type,
                    })
                  }
                  type="button"
                  variant="outline"
                >
                  Discard
                </Button>
                <Button disabled={!dirty || update.isPending || locked} type="submit">
                  {update.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          </Panel>

          <Panel
            action={
              user.sessions.length > 0 && (
                <Button
                  disabled={revokeAll.isPending || locked}
                  onClick={() => revokeAll.mutate(undefined)}
                  size="xs"
                  variant="destructive"
                >
                  <LogOut /> Sign out everywhere
                </Button>
              )
            }
            title={`Sessions (${user.sessions.length})`}
          >
            {user.sessions.length ? (
              <ul className="divide-y rounded-md border">
                {user.sessions.map((s) => (
                  <li
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                    key={s.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate capitalize">
                        {s.metadata.browser ?? "Unknown"} on {s.metadata.device ?? "unknown device"}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {s.metadata.ip ?? "—"} · active{" "}
                        {formatDistanceToNow(new Date(s.lastSeenAt), { addSuffix: true })}
                      </p>
                    </div>
                    <Button
                      aria-label="Revoke session"
                      disabled={revokeOne.isPending || locked}
                      onClick={() => revokeOne.mutate({ id: s.id })}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyNote>Not signed in anywhere.</EmptyNote>
            )}
          </Panel>

          <Panel title="Recent activity">
            <ActivityList items={user.recentActivity} />
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Details">
            <div className="divide-y">
              <DetailRow label="Joined">{new Date(user.createdAt).toLocaleDateString()}</DetailRow>
              <DetailRow label="Last seen">
                {user.lastSeenAt
                  ? formatDistanceToNow(new Date(user.lastSeenAt), { addSuffix: true })
                  : "Never"}
              </DetailRow>
              <DetailRow label="Email verified">{user.emailVerified ? "Yes" : "No"}</DetailRow>
              <DetailRow label="Two-factor sign-in">
                {user.twoFactorEnabled ? (
                  <span className="inline-flex items-center gap-2">
                    On
                    <Button
                      disabled={locked || resetTwoFactor.isPending}
                      onClick={() =>
                        confirm({
                          title: "Turn off two-factor sign-in?",
                          description:
                            "For someone who lost their phone and their recovery codes. They're signed out everywhere and sign in with just their password; if it's required for them, they set it up again straight away.",
                          confirmLabel: "Turn it off",
                          destructive: true,
                          onConfirm: () => resetTwoFactor.mutate(undefined),
                        })
                      }
                      size="xs"
                      variant="outline"
                    >
                      Reset
                    </Button>
                  </span>
                ) : (
                  "Off"
                )}
              </DetailRow>
              <DetailRow label="Boards owned">{user.boardsOwned}</DetailRow>
              <DetailRow label="Failed sign-ins">{user.failedLogins}</DetailRow>
              <DetailRow label="Last sign-in from">
                {[user.metadata.ip, user.metadata.browser, user.metadata.locale]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </DetailRow>
              {user.lockedUntil && (
                <DetailRow label="Locked">
                  <span className="inline-flex items-center gap-2">
                    until {new Date(user.lockedUntil).toLocaleTimeString()}
                    <Button onClick={() => unlock.mutate(undefined)} size="xs" variant="outline">
                      <LockOpen /> Unlock
                    </Button>
                  </span>
                </DetailRow>
              )}
            </div>
          </Panel>

          <Panel title="Actions">
            <div className="flex flex-col gap-2">
              <Button
                disabled={sendReset.isPending || locked}
                onClick={() => sendReset.mutate(undefined)}
                variant="outline"
              >
                <KeyRound /> Email a password reset link
              </Button>
              <Button
                disabled={locked || isSelf || remove.isPending}
                onClick={() =>
                  confirm({
                    title: `Delete ${user.name}?`,
                    description:
                      "They're signed out everywhere and can't sign in again. Boards they own are kept.",
                    confirmLabel: "Delete",
                    destructive: true,
                    onConfirm: () =>
                      remove.mutate(undefined, { onSuccess: () => router.push("/admin/users") }),
                  })
                }
                title={isSelf ? "You can't delete yourself" : undefined}
                variant="destructive"
              >
                <Trash2 /> Delete user
              </Button>
            </div>
          </Panel>
        </div>
      </div>
      {dialog}
    </div>
  );
};
