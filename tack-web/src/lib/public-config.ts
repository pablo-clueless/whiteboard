"use client";

import { useEffect, useState } from "react";

import type { PublicConfig } from "@/types/system";
import { env } from "./env";

// One request per page load, shared by every component that asks.
let pending: Promise<PublicConfig | null> | null = null;

function load() {
  pending ??= fetch(`${env.apiUrl}/api/config`)
    .then((res) => (res.ok ? (res.json() as Promise<PublicConfig>) : null))
    .catch(() => null);
  return pending;
}

/**
 * The server's public settings (`GET /api/config`): board features and feature flags. Null until
 * loaded, or when the server can't be reached; treat null as "everything on".
 */
export function usePublicConfig() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  useEffect(() => {
    let live = true;
    load().then((c) => live && setConfig(c));
    return () => {
      live = false;
    };
  }, []);
  return config;
}

/** Whether a feature flag is on. Unknown flags are off. */
export function useFeatureFlag(id: string) {
  return usePublicConfig()?.featureFlags[id] ?? false;
}
