import { persist } from "zustand/middleware";
import { create } from "zustand";

interface SigninOptions {
  expiresIn?: number;
  redirectUrl?: string;
  rememberMe?: boolean;
}

interface SignoutOptions {
  callbackUrl?: string;
  clearStorage?: boolean;
  redirectUrl?: string;
  soft?: boolean;
}

type User = {
  id: string;
  email: string;
};

type UserState = {
  signin?: (user: User, option?: SigninOptions) => void;
  signout?: (option?: SignoutOptions) => void;
  user: User | null;
};

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      user: null,
      signin: (user) => set({ user }),
      signout: () => set({ user: null }),
    }),
    { name: "user" },
  ),
);
