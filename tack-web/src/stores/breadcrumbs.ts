import { useEffect } from "react";
import { create } from "zustand";

type BreadcrumbState = {
  /** Path segment (an id) → what the header's breadcrumbs call it. */
  labels: Record<string, string>;
};

export const useBreadcrumbStore = create<BreadcrumbState>()(() => ({ labels: {} }));

/** Names `segment` in the breadcrumbs, e.g. a user's id as their name, once `label` is known. */
export function useBreadcrumbLabel(segment: string, label: string | undefined) {
  useEffect(() => {
    if (!label) return;
    useBreadcrumbStore.setState((s) => ({ labels: { ...s.labels, [segment]: label } }));
  }, [segment, label]);
}
