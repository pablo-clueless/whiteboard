import { Permission, PermissionLevel } from "@/lib/permissions";
import { Maybe } from "./app";

export type UserStatus = "active" | "deleted" | "inactive" | "pending" | "suspended";
export type UserType = "superadmin" | "client";

/** Matches `User` in `tack/src/accounts/mod.rs`. */
export interface User {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: Maybe<string>;
  type: UserType;
  role: PermissionLevel;
  permissions: Permission[];
  /** From the latest sign-in. */
  metadata: {
    ip: Maybe<string>;
    browser: Maybe<string>;
    locale: Maybe<string>;
  };
  emailVerified: boolean;
  /** Signs in with an authenticator app code as well as the password. */
  twoFactorEnabled: boolean;
  lastSeenAt: Maybe<string>;
}

export interface Session {
  token: string;
  expiresAt: string;
  user: User;
}

/** POST /api/auth/signin with two-factor on: the password was right; now a code. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challenge: string;
}

export type SigninResult = Session | TwoFactorChallenge;

/** POST /api/auth/two-factor/setup */
export interface TwoFactorSetup {
  /** Base32, for typing in by hand. */
  secret: string;
  otpauthUrl: string;
  /** The QR code as an SVG document. */
  qrSvg: string;
}
