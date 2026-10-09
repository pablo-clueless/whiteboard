import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  type LucideIcon,
} from "lucide-react";

import type { AlignEdge } from "./editor-core";

/** The six alignments, with the Alt shortcut for each (matched on `KeyboardEvent.code`). */
export const ALIGN_ACTIONS: {
  edge: AlignEdge;
  label: string;
  icon: LucideIcon;
  code: string;
  key: string;
}[] = [
  { edge: "left", label: "Align left", icon: AlignStartVertical, code: "KeyA", key: "A" },
  {
    edge: "centerX",
    label: "Centre horizontally",
    icon: AlignCenterVertical,
    code: "KeyH",
    key: "H",
  },
  { edge: "right", label: "Align right", icon: AlignEndVertical, code: "KeyD", key: "D" },
  { edge: "top", label: "Align top", icon: AlignStartHorizontal, code: "KeyW", key: "W" },
  {
    edge: "centerY",
    label: "Centre vertically",
    icon: AlignCenterHorizontal,
    code: "KeyV",
    key: "V",
  },
  { edge: "bottom", label: "Align bottom", icon: AlignEndHorizontal, code: "KeyS", key: "S" },
];
