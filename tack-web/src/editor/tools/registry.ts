import type { Tool } from "../types";

const tools = new Map<string, Tool>();

export const toolRegistry = {
  register(tool: Tool) {
    // Hot reload re-runs registration; only a real clash in production is an error.
    if (tools.has(tool.id) && process.env.NODE_ENV === "production") {
      throw new Error(`tool "${tool.id}" is already registered`);
    }
    tools.set(tool.id, tool);
  },
  get(id: string): Tool | undefined {
    return tools.get(id);
  },
  /** In registration order, which is toolbar order. */
  all(): Tool[] {
    return [...tools.values()];
  },
  byShortcut(key: string): Tool | undefined {
    const k = key.toLowerCase();
    return [...tools.values()].find((t) => t.shortcut === k);
  },
};
