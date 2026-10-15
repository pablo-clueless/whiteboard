"use client";

import { cn } from "cn";

import { formatBytes, formatDuration } from "@/lib/admin";
import { TabPanel } from "@/components/shared";
import type { Health } from "@/types/admin";
import { DetailRow, Panel } from "../panel";
import { useApiQuery } from "@/lib/query";
import { TabProps } from "@/types/app";

export const SystemHealth = ({ tab }: TabProps) => {
  const { data: health } = useApiQuery<Health>({
    keys: ["admin", "health"],
    url: "/api/admin/system/health",
    enabled: tab === "system-health",
    refetchInterval: 15_000,
  });

  const storage = health?.storage;
  const usedShare = storage?.quotaBytes
    ? Math.min(100, (storage.usedBytes / storage.quotaBytes) * 100)
    : null;
  const largest = storage?.tables[0]?.bytes ?? 1;

  return (
    <TabPanel tab={tab} value="system-health">
      {health && storage && (
        <div className="grid grid-cols-2 gap-6">
          <Panel
            title="Server"
            action={
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                  health.status === "ok"
                    ? "bg-green-100 text-green-700"
                    : "bg-amber-100 text-amber-700",
                )}
              >
                {health.status}
              </span>
            }
          >
            <div className="divide-y">
              <DetailRow label="Version">{health.version}</DetailRow>
              <DetailRow label="Uptime">{formatDuration(health.uptimeSeconds)}</DetailRow>
              <DetailRow label="Started">{new Date(health.startedAt).toLocaleString()}</DetailRow>
              <DetailRow label="Open rooms">{health.rooms.open}</DetailRow>
              <DetailRow label="Connected clients">{health.rooms.connectedClients}</DetailRow>
            </div>
          </Panel>
          <Panel title="Database">
            <div className="divide-y">
              <DetailRow label="Round trip">{health.database.latencyMs} ms</DetailRow>
              <DetailRow label="Connections">
                {health.database.poolSize - health.database.poolIdle} busy ·{" "}
                {health.database.poolIdle} idle · {health.database.poolMax} max
              </DetailRow>
              <DetailRow label="Size">{storage.used}</DetailRow>
              <DetailRow label="Available">
                {storage.quotaBytes
                  ? `${storage.available} of ${formatBytes(storage.quotaBytes)}`
                  : "No quota set (TACK_STORAGE_QUOTA_BYTES)"}
              </DetailRow>
            </div>
            {usedShare !== null && (
              <div className="h-2 rounded-full bg-gray-100">
                <div
                  className={cn(
                    "h-full rounded-full",
                    usedShare > 90 ? "bg-red-500" : "bg-primary",
                  )}
                  style={{ width: `${usedShare}%` }}
                />
              </div>
            )}
          </Panel>
          <Panel className="col-span-2" title="Storage by table">
            <div className="space-y-2">
              {storage.tables.map((t) => (
                <div
                  className="grid grid-cols-[10rem_1fr_6rem_6rem] items-center gap-3 text-sm"
                  key={t.name}
                >
                  <span className="truncate font-mono text-xs">{t.name}</span>
                  <div className="h-1.5 rounded-full bg-gray-100">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${(t.bytes / largest) * 100}%` }}
                    />
                  </div>
                  <span className="text-right">{formatBytes(t.bytes)}</span>
                  {/* Postgres's estimate: 0 until the table has been analyzed, so hidden then. */}
                  <span className="text-muted-foreground text-right text-xs">
                    {t.rows > 0 ? `~${t.rows.toLocaleString()} rows` : ""}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </TabPanel>
  );
};
