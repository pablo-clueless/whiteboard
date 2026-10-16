// Shapes returned by the admin API (`tack/src/admin/`).
// TODO: generate these from the Rust types with ts-rs (src/types/server/).

import type { User } from "./user";

/** A stat card: this period, the period before, and the percent change (null when undefined). */
export type Stat = { value: number; previous: number; delta: number | null };

export type Page<T> = { data: T[]; total: number; page: number; limit: number };

export type AuditLog = {
  id: string;
  /** An email, "anonymous" or "system". */
  user: string;
  userId: string | null;
  action: string;
  resource: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
};

export type DayPoint = { date: string; visitors: number };

export type Overview = {
  period: number;
  stats: { sessions: Stat; boards: Stat; activeUsers: Stat; totalUsers: Stat };
  activeUsers: DayPoint[];
  retention: DayPoint[];
  usersByBrowser: { browser: string; visitors: number }[];
  usersByDevice: { device: string; visitors: number }[];
  topBoards: { id: string; name: string; sessions: number; visitors: number }[];
  recentActivity: AuditLog[];
};

export type ClientStats = {
  id: string;
  role: "edit" | "view";
  userId: string | null;
  userName: string | null;
  browser: string;
  device: string;
  connectedAt: string;
};

export type RoomStats = {
  boardId: string;
  title: string;
  openedAt: string;
  clients: ClientStats[];
  editors: number;
  viewers: number;
  /** Locked read-only from the editor, and the read-only switch is on. */
  locked: boolean;
  updatesLastMinute: number;
  updatesSinceSnapshot: number;
  docBytes: number;
  maxDocBytes: number;
  full: boolean;
  lastSnapshotAt: string | null;
};

export type LiveConnection = ClientStats & { boardId: string; boardTitle: string };

export type Live = {
  openRooms: number;
  connectedClients: number;
  editors: number;
  viewers: number;
  signedInUsers: number;
  updatesLastMinute: number;
  byBrowser: Record<string, number>;
  byDevice: Record<string, number>;
  rooms: RoomStats[];
  connections: LiveConnection[];
  timeline: { time: string; connections: number }[];
};

export type UserStats = {
  period: number;
  totalUsers: Stat;
  monthlyActiveUsers: Stat;
  monthlyUniqueUsers: Stat;
  monthlyNewUsers: Stat;
};

export type UserSession = {
  id: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  metadata: {
    ip: string | null;
    browser: string | null;
    device: string | null;
    locale: string | null;
  };
};

export type UserDetail = User & {
  lockedUntil: string | null;
  failedLogins: number;
  boardsOwned: number;
  sessions: UserSession[];
  recentActivity: AuditLog[];
};

export type BoardStatus = "active" | "archived";

export type Board = {
  id: string;
  name: string;
  owner: string | null;
  ownerId: string | null;
  ownerEmail: string | null;
  status: BoardStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  /** Locked read-only from the editor. Only enforced while the read-only switch is on. */
  lockedAt: string | null;
  sizeBytes: number;
  assetCount: number;
  assetBytes: number;
  linkCount: number;
  connected: number;
};

export type ShareLink = { id: string; role: "edit" | "view"; createdAt: string };

export type BoardDetail = Board & {
  schemaVersion: number;
  snapshotAt: string | null;
  pendingUpdates: number;
  links: ShareLink[];
  sessionsLast30Days: number;
  visitorsLast30Days: number;
  room: Omit<RoomStats, "title"> | null;
  recentActivity: AuditLog[];
};

export type BoardStats = {
  period: number;
  totalBoards: Stat;
  activeBoards: Stat;
  collaborators: Stat;
  archivedBoards: Stat;
  openRooms: number;
};

export type Asset = {
  id: string;
  boardId: string;
  boardTitle: string;
  mime: string;
  size: number;
  createdAt: string;
};

export type LogStats = { total: Stat; today: Stat; thisWeek: Stat; thisMonth: Stat };

export type FeatureFlag = {
  id: string;
  name: string;
  enabled: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type Health = {
  status: "ok" | "degraded";
  version: string;
  startedAt: string;
  uptimeSeconds: number;
  database: { latencyMs: number; poolSize: number; poolIdle: number; poolMax: number };
  storage: {
    used: string;
    available: string;
    usedBytes: number;
    availableBytes: number | null;
    quotaBytes: number | null;
    tables: { name: string; bytes: number; rows: number }[];
  };
  rooms: { open: number; connectedClients: number };
};

export type BulkResult = { updated: string[]; skipped?: { id: string; reason: string }[] };
