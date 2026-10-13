"use client";

import { formatDistanceToNow } from "date-fns";
import { LockOpen, LogOut, X } from "lucide-react";
import React, { useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FormField, NativeSelect, ROLE_OPTIONS, STATUS_OPTIONS } from "./fields";
import { useApiMutation, useApiQuery } from "@/lib/query";
import { DetailRow, EmptyNote } from "./panel";
import { Button } from "@/components/ui/button";
import type { UserDetail } from "@/types/admin";
import { Input } from "@/components/ui/input";
import { useUserStore } from "@/stores/user";
import { ActivityList } from "./activity-list";
import { useConfirm } from "./confirm";

interface Props {
  userId: string | null;
  onClose: () => void;
}

const USER_KEYS = [["admin", "users"], ["admin", "user"]];

/** One account: details, editing, sessions and activity. */
export const UserSheet = ({ userId, onClose }: Props) => {
  const { data: user } = useApiQuery<UserDetail>({
    keys: ["admin", "user", userId],
    url: `/api/admin/users/${userId}`,
    enabled: Boolean(userId),
  });

  return (
    <Sheet open={Boolean(userId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{user?.name ?? "User"}</SheetTitle>
          <SheetDescription>{user?.email}</SheetDescription>
        </SheetHeader>
        {/* Keyed so the form starts from the loaded user, and resets when another opens. */}
        {user && user.id === userId && <UserDetails key={user.id + user.updatedAt} user={user} />}
      </SheetContent>
    </Sheet>
  );
};

const UserDetails = ({ user }: { user: UserDetail }) => {
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

  // Send only what changed, so an admin editing a name can't trip the access checks.
  const changes = Object.fromEntries(
    Object.entries(form).filter(([key, value]) => user[key as keyof typeof form] !== value),
  ) as Partial<typeof form>;
  const dirty = Object.keys(changes).length > 0;

  return (
    <div className="space-y-6 px-4 pb-6">
      <section className="divide-y">
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
      </section>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) update.mutate(changes);
        }}
      >
        <p className="text-sm font-semibold">Account</p>
        {locked && (
          <p className="text-muted-foreground text-xs">Only a superadmin can change a superadmin.</p>
        )}
        <div className="grid grid-cols-2 gap-4">
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
            hint={isSelf ? "You can't change your own access." : "Resets permissions to the role's."}
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
        <Button disabled={!dirty || update.isPending || locked} type="submit">
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </form>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Sessions ({user.sessions.length})</p>
          {user.sessions.length > 0 && (
            <Button
              disabled={revokeAll.isPending || locked}
              onClick={() => revokeAll.mutate(undefined)}
              size="xs"
              variant="destructive"
            >
              <LogOut /> Sign out everywhere
            </Button>
          )}
        </div>
        {user.sessions.length ? (
          <ul className="divide-y rounded-md border">
            {user.sessions.map((s) => (
              <li className="flex items-center justify-between gap-2 px-3 py-2 text-sm" key={s.id}>
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
      </section>

      <section className="space-y-2">
        <p className="text-sm font-semibold">Recent activity</p>
        <ActivityList items={user.recentActivity} />
      </section>
      {dialog}
    </div>
  );
};
