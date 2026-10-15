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

/** Longest name shown on a cursor. */
export const MAX_DISPLAY_NAME_LENGTH = 40;

/** Cursor colours to pick from; each stands out on the board and under white text. */
export const CURSOR_COLORS = [
  "#e5484d",
  "#f76b15",
  "#e2a400",
  "#46a758",
  "#0090ff",
  "#8e4ec6",
  "#d6409f",
];

type ProfileState = {
  /** The name this browser shows to others on a board. Null means the account name, or an animal. */
  displayName: string | null;
  /** This browser's cursor colour. Null means one picked for each visit. */
  color: string | null;
  setDisplayName: (name: string) => void;
  setColor: (color: string | null) => void;
};

/** How this browser appears to others, signed in or not. Kept in localStorage. */
export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      displayName: null,
      color: null,
      setDisplayName: (name) =>
        set({ displayName: name.trim().slice(0, MAX_DISPLAY_NAME_LENGTH) || null }),
      setColor: (color) => set({ color: color && CURSOR_COLORS.includes(color) ? color : null }),
    }),
    { name: "profile" },
  ),
);

/** The name to show others: the one picked here, else the account's, else null. */
export function chosenName(): string | null {
  return (
    useProfileStore.getState().displayName ?? useUserStore.getState().user?.name?.trim() ?? null
  );
}
