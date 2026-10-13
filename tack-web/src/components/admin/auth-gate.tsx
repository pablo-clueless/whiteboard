"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect } from "react";
import Link from "next/link";

import { useHydrated, useUserStore } from "@/stores/user";
import type { PublicConfig } from "@/types/system";
import { isAdmin } from "@/lib/permissions";
import { TwoFactorSetup } from "./two-factor";
import type { User } from "@/types/user";
import { http } from "@/lib/client";

export const PUBLIC_CONFIG_KEY = ["public-config"];

/**
 * The server's public settings, kept fresh for the admin interface (unlike `usePublicConfig`,
 * which loads once per page): whether admins must use two-factor sign-in can change while
 * they're here.
 */
export function useAdminConfig() {
  return useQuery({
    queryKey: PUBLIC_CONFIG_KEY,
    queryFn: () => http.get<PublicConfig>("/api/config"),
    staleTime: 60_000,
  });
}

interface Props {
  children: React.ReactNode;
}

const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="grid min-h-screen w-screen place-items-center p-6">{children}</div>
);

/**
 * Lets signed-in admins through. Everyone else is sent to sign in, or told they can't. Admins who
 * must use two-factor sign-in and haven't set it up do that first.
 */
export const AuthGate = ({ children }: Props) => {
  const { token, user, setUser, signout } = useUserStore();
  const hydrated = useHydrated();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const config = useAdminConfig();

  // Re-check the session with the server: it may have expired, or the account changed.
  const me = useQuery({
    queryKey: ["me", token],
    queryFn: () => http.get<User>("/api/auth/me"),
    enabled: hydrated && Boolean(token),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (me.data) setUser(me.data);
  }, [me.data, setUser]);

  useEffect(() => {
    if (hydrated && !token) router.replace(`/signin?next=${encodeURIComponent(pathname)}`);
  }, [hydrated, token, pathname, router]);

  if (!hydrated || !token || (!user && me.isPending)) {
    return (
      <Centered>
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </Centered>
    );
  }

  if (!isAdmin(user)) {
    return (
      <Centered>
        <div className="max-w-sm space-y-3 text-center">
          <ShieldAlert className="text-primary mx-auto size-8" />
          <p className="text-lg font-semibold">You don&apos;t have access</p>
          <p className="text-muted-foreground text-sm">
            {user?.email} isn&apos;t an admin. Ask an admin to give you the admin role.
          </p>
          <Link className="text-primary text-sm font-semibold hover:underline" href="/">
            Back to Tack
          </Link>
        </div>
      </Centered>
    );
  }

  if (config.data?.twoFactorRequired && !user?.twoFactorEnabled) {
    return (
      <Centered>
        <div className="w-full max-w-md space-y-5 rounded-lg border bg-white p-6">
          <div className="space-y-1.5">
            <ShieldCheck className="text-primary size-7" />
            <p className="text-lg font-semibold">Set up two-factor sign-in</p>
            <p className="text-muted-foreground text-sm">
              Admins have to sign in with a code from an authenticator app as well as a password.
              Set it up to carry on to the admin.
            </p>
          </div>
          <TwoFactorSetup
            onDone={(updated) => {
              setUser(updated);
              // Requests refused while it was missing can go through now.
              qc.invalidateQueries();
            }}
          />
          <p className="text-muted-foreground text-center text-xs">
            Signed in as {user?.email} ·{" "}
            <button
              className="text-primary font-semibold hover:underline"
              onClick={() => {
                http.post("/api/auth/signout").catch(() => {});
                signout();
              }}
              type="button"
            >
              Sign out
            </button>
          </p>
        </div>
      </Centered>
    );
  }

  return children;
};
