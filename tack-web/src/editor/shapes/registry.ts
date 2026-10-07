import type { ShapeDef } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- defs are heterogeneous by design
export type AnyShapeDef = ShapeDef<any, any>;

const defs = new Map<string, AnyShapeDef>();

export const shapeRegistry = {
  register(def: AnyShapeDef) {
    // Hot reload re-runs registration; only a real clash in production is an error.
    if (defs.has(def.type) && process.env.NODE_ENV === "production") {
      throw new Error(`shape type "${def.type}" is already registered`);
    }
    defs.set(def.type, def);
  },
  get(type: string): AnyShapeDef | undefined {
    return defs.get(type);
  },
  all(): AnyShapeDef[] {
    return [...defs.values()];
  },
};
