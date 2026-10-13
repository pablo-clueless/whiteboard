import { persist } from "zustand/middleware";
import { useSyncExternalStore } from "react";
import { create } from "zustand";

import type { Session, User } from "@/types/user";

type UserState = {
  /** Bearer token for the API. Kept in localStorage, so the session survives a reload. */
  token: string | null;
  expiresAt: string | null;
  user: User | null;
  signin: (session: Session) => void;
  setUser: (user: User) => void;
  signout: () => void;
};

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      token: null,
      expiresAt: null,
      user: null,
      signin: ({ token, expiresAt, user }) => set({ token, expiresAt, user }),
      setUser: (user) => set({ user }),
      signout: () => set({ token: null, expiresAt: null, user: null }),
    }),
    { name: "user" },
  ),
);

/**
 * True once the stored session has been read back. False on the server and for the first client
 * render, so both render the same thing; until then "signed out" might not be true.
 */
export function useHydrated() {
  return useSyncExternalStore(
    (onChange) => useUserStore.persist.onFinishHydration(onChange),
    () => useUserStore.persist.hasHydrated(),
    () => false,
  );
}

/** The session token outside React, e.g. for requests. */
export const sessionToken = () => useUserStore.getState().token;
