import type { IconSpec } from "./icons";

/** One component a provider offers, such as "Lambda" for AWS or "PostgreSQL" for databases. */
export type ComponentItem = {
  /** Unique within its provider. */
  id: string;
  label: string;
  icon: IconSpec;
  /** The item's own colour (a brand logo's). Defaults to the provider's. */
  color?: string;
  /** Extra words to match when searching, e.g. "functions serverless" for Lambda. */
  keywords?: string;
  /** Shown under the name on cards. Defaults to the provider's name. */
  caption?: string;
};

/** A group of components in the side panel, with its own logo and colour. */
export type ComponentProvider = {
  id: string;
  label: string;
  /** Brand colour: card outlines, tints and line icons use it. */
  color: string;
  logo: IconSpec;
  items: ComponentItem[];
};

/** Identifies one item on the board: stored in a component shape's props. */
export type ComponentRef = { provider: string; item: string };

const providers = new Map<string, ComponentProvider>();
const listeners = new Set<() => void>();
let snapshot: ComponentProvider[] = [];

/**
 * Providers for the component panel. Register more (a company's internal services, say) the same
 * way the built-in ones are, from a plugin. Panel order is registration order.
 */
export const componentCatalog = {
  register(provider: ComponentProvider) {
    providers.set(provider.id, provider);
    snapshot = [...providers.values()];
    listeners.forEach((fn) => fn());
  },
  unregister(id: string) {
    if (!providers.delete(id)) return;
    snapshot = [...providers.values()];
    listeners.forEach((fn) => fn());
  },
  all(): ComponentProvider[] {
    return snapshot;
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  find(ref: ComponentRef): { provider: ComponentProvider; item: ComponentItem } | null {
    const provider = providers.get(ref.provider);
    const item = provider?.items.find((i) => i.id === ref.item);
    return provider && item ? { provider, item } : null;
  },
};

/** The colour an item draws in: its own, or its provider's. */
export const itemColor = (provider: ComponentProvider, item: ComponentItem) =>
  item.color ?? provider.color;

/** MIME type for dragging a component from the panel onto the board. */
export const COMPONENT_DRAG_TYPE = "application/x-tack-component";
