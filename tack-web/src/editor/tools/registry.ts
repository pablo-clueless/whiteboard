import type { Tool } from "../types";

const tools = new Map<string, Tool>();

export const toolRegistry = {
  register(tool: Tool) {
    if (tools.has(tool.id)) throw new Error(`tool "${tool.id}" is already registered`);
    tools.set(tool.id, tool);
  },
  get(id: string): Tool | undefined {
    return tools.get(id);
  },
  /** In registration order, which is toolbar order. */
  all(): Tool[] {
    return [...tools.values()];
  },
};
