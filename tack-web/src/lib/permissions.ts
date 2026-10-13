import { User } from "@/types/user";

export type PermissionLevel = "admin" | "owner" | "viewer";
export type PermissionAction = "read" | "write";

export type Permission = `${PermissionLevel}:${PermissionAction}`;

/** Superadmins have every permission. Matches `User::can` on the server. */
export function hasPermission(user: User, permission: Permission) {
  return user.type === "superadmin" || user.permissions.includes(permission);
}

/** Can open the admin interface. The server checks `admin:read` / `admin:write` per request. */
export function isAdmin(user: User | null | undefined) {
  if (!user) return false;
  return user.type === "superadmin" || (user.role === "admin" && hasPermission(user, "admin:read"));
}
