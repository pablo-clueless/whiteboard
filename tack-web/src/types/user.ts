import { Permission, PermissionLevel } from "@/lib/permissions";
import { Maybe } from "./app";

type UserStatus = "active" | "deleted" | "inactive" | "pending" | "suspended";
type UserType = "superadmin" | "client";

export interface User {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Maybe<Date>;
  type: UserType;
  role: PermissionLevel;
  permissions: Permission[];
  metadata: {
    ip: string;
    browser: string;
    locale: string;
  };
}

export interface Session {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  metadata: {
    ip: string;
    browser: string;
    device: "desktop" | "tablet" | "mobile";
    locale: string;
  };
}
