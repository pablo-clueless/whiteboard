import type { ShapeDef } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- defs are heterogeneous by design
type AnyShapeDef = ShapeDef<any>;

const defs = new Map<string, AnyShapeDef>();

export const shapeRegistry = {
  register(def: AnyShapeDef) {
    if (defs.has(def.type)) throw new Error(`shape type "${def.type}" is already registered`);
    defs.set(def.type, def);
  },
  get(type: string): AnyShapeDef | undefined {
    return defs.get(type);
  },
  all(): AnyShapeDef[] {
    return [...defs.values()];
  },
};
