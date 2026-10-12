import { User } from "@/types/user";

export type PermissionLevel = "admin" | "owner" | "viewer";
export type PermissionAction = "read" | "write";

export type Permission = `${PermissionLevel}:${PermissionAction}`;

export function hasPermission(user: User, permission: Permission) {
  return user.permissions.includes(permission);
}
