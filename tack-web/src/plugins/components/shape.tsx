import { Group, Rect, Text } from "react-konva";
import { useSyncExternalStore } from "react";
import { Box } from "lucide";

import { glyph, iconSvg, type IconSpec, KonvaIcon, readable, tint } from "@/editor/icons";
import { componentCatalog, itemColor } from "@/editor/component-catalog";
import { boxBounds, boxResize, num, str } from "@/editor/shapes/box";
import type { LabelBox, ShapeDef } from "@/editor/types";
import { BOARD_PROVIDER } from "@/editor/library";
import { useEditorStore } from "@/stores/editor";
import { textFont } from "@/editor/shapes/text";
import { esc, n } from "@/editor/svg";

/**
 * One service or technology: its logo on a tile and a name you can change, in the provider's
 * colours. Two looks: a card (logo beside the name, provider underneath) and an icon (logo
 * above the name). Which logo and colours come from the catalog, by `provider` and `item`, so
 * the board stores only references.
 */
export type ComponentProps = {
  provider: string;
  item: string;
  /** Shown name, e.g. "orders-db". Starts as the item's name. */
  label: string;
  variant: "card" | "icon";
  w: number;
  h: number;
};

/** Default size of each look; switching look resets the size to these. */
export const COMPONENT_SIZES = {
  card: { w: 200, h: 60 },
  icon: { w: 96, h: 96 },
} as const;

const FALLBACK: IconSpec = glyph(Box);
const FALLBACK_COLOR = "#5e5f66";

/** Colours, logo and caption, falling back to a plain grey look if the item is unknown. */
export function cardLook(p: ComponentProps) {
  const found = componentCatalog.find(p);
  const color = found ? itemColor(found.provider, found.item) : FALLBACK_COLOR;
  const accent = readable(color);
  return {
    icon: found?.item.icon ?? FALLBACK,
    // Brand logos keep their own colour; line icons and monograms take the provider's.
    iconColor: found?.item.icon.kind === "brand" ? found.item.icon.hex : accent,
    accent,
    fill: tint(accent, 0.93),
    tileStroke: tint(accent, 0.7),
    // A card from this board's components that has since been deleted is just a "Component".
    caption: found
      ? (found.item.caption ?? found.provider.label)
      : (p.provider !== BOARD_PROVIDER && p.provider) || "Component",
  };
}

const LABEL_SIZE = 14;
const ICON_LABEL_SIZE = 12;
const CAPTION_SIZE = 11;
const INK = "#0e0e10";
const MUTED = "#6b6b75";

type Layout = {
  tile: { x: number; y: number; size: number };
  icon: { x: number; y: number; size: number };
  label: LabelBox;
  caption: { x: number; y: number; w: number } | null;
};

/** Where everything goes inside a w×h component, for either look. */
function layout(p: ComponentProps): Layout {
  const { w, h } = p;
  if (p.variant === "icon") {
    const pad = Math.min(10, w * 0.1);
    const labelH = ICON_LABEL_SIZE * 1.25;
    const size = Math.max(12, Math.min(w - pad * 2, h - pad * 2 - labelH - 4, 64));
    const tile = { x: (w - size) / 2, y: pad, size };
    const iconSize = size * 0.6;
    return {
      tile,
      icon: {
        x: tile.x + (size - iconSize) / 2,
        y: tile.y + (size - iconSize) / 2,
        size: iconSize,
      },
      label: {
        x: 4,
        y: Math.min(h - pad - labelH, tile.y + size + 6),
        w: w - 8,
        h: labelH,
        fontSize: ICON_LABEL_SIZE,
        fontWeight: 600,
        align: "center",
      },
      caption: null,
    };
  }
  const pad = Math.min(10, h * 0.16);
  const size = Math.max(12, Math.min(h - pad * 2, 44));
  const tile = { x: pad, y: (h - size) / 2, size };
  const iconSize = size * 0.6;
  const textX = pad + size + pad;
  const textW = Math.max(0, w - textX - pad);
  const textH = LABEL_SIZE * 1.2 + 2 + CAPTION_SIZE * 1.2;
  const textY = (h - textH) / 2;
  return {
    tile,
    icon: { x: tile.x + (size - iconSize) / 2, y: tile.y + (size - iconSize) / 2, size: iconSize },
    label: {
      x: textX,
      y: textY,
      w: textW,
      h: LABEL_SIZE * 1.2,
      fontSize: LABEL_SIZE,
      fontWeight: 600,
      align: "left",
    },
    caption: { x: textX, y: textY + LABEL_SIZE * 1.2 + 2, w: textW },
  };
}

export const componentShape: ShapeDef<ComponentProps, "component"> = {
  type: "component",
  version: 1,
  defaultProps: {
    provider: "",
    item: "",
    label: "Component",
    variant: "card",
    ...COMPONENT_SIZES.card,
  },
  validate: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const variant = p.variant === "icon" ? "icon" : "card";
    return {
      provider: str(p.provider, ""),
      item: str(p.item, ""),
      label: str(p.label, "Component").slice(0, 200),
      variant,
      w: Math.max(40, num(p.w, COMPONENT_SIZES[variant].w)),
      h: Math.max(28, num(p.h, COMPONENT_SIZES[variant].h)),
    };
  },
  getBounds: boxBounds,
  onResize: boxResize,
  // Double-click renames, in place.
  label: { prop: "label", box: (shape) => layout(shape.props).label },
  variants: [
    { id: "card", label: "Card", size: COMPONENT_SIZES.card },
    { id: "icon", label: "Icon", size: COMPONENT_SIZES.icon },
  ],
  toSvg: ({ props: p }) => {
    const look = cardLook(p);
    const l = layout(p);
    const lb = l.label;
    const anchor = lb.align === "center" ? "middle" : "start";
    const lx = lb.align === "center" ? lb.x + lb.w / 2 : lb.x;
    return (
      `<rect width="${n(p.w)}" height="${n(p.h)}" rx="10" fill="${look.fill}" stroke="${look.accent}" stroke-width="1.5"/>` +
      `<rect x="${n(l.tile.x)}" y="${n(l.tile.y)}" width="${n(l.tile.size)}" height="${n(l.tile.size)}" rx="8" fill="#ffffff" stroke="${look.tileStroke}"/>` +
      iconSvg(look.icon, look.iconColor, l.icon.x, l.icon.y, l.icon.size) +
      `<text x="${n(lx)}" y="${n(lb.y + lb.h / 2)}" text-anchor="${anchor}" dominant-baseline="central" font-family="${esc(textFont())}" font-weight="600" font-size="${lb.fontSize}" fill="${INK}">${esc(p.label)}</text>` +
      (l.caption
        ? `<text x="${n(l.caption.x)}" y="${n(l.caption.y + (CAPTION_SIZE * 1.2) / 2)}" dominant-baseline="central" font-family="${esc(textFont())}" font-size="${CAPTION_SIZE}" fill="${MUTED}">${esc(look.caption)}</text>`
        : "")
    );
  },
  Component: function ComponentCard({ shape, isSelected }) {
    // While the name is being edited in place, the editor draws it instead.
    const editing = useEditorStore((s) => s.editingLabelId === shape.id);
    // Redraw when the catalog changes: a component made on this board can be edited or arrive
    // after the card that uses it.
    useSyncExternalStore(componentCatalog.subscribe, componentCatalog.all, componentCatalog.all);
    const p = shape.props;
    const look = cardLook(p);
    const l = layout(p);
    return (
      <Group>
        <Rect
          width={p.w}
          height={p.h}
          cornerRadius={p.variant === "icon" ? 14 : 10}
          fill={look.fill}
          stroke={look.accent}
          strokeWidth={isSelected ? 2 : 1.5}
          perfectDrawEnabled={false}
        />
        <Rect
          x={l.tile.x}
          y={l.tile.y}
          width={l.tile.size}
          height={l.tile.size}
          cornerRadius={8}
          fill="#ffffff"
          stroke={look.tileStroke}
          strokeWidth={1}
          listening={false}
          perfectDrawEnabled={false}
        />
        <KonvaIcon
          icon={look.icon}
          color={look.iconColor}
          x={l.icon.x}
          y={l.icon.y}
          size={l.icon.size}
        />
        {!editing && (
          <Text
            x={l.label.x}
            y={l.label.y}
            width={l.label.w}
            text={p.label}
            fontSize={l.label.fontSize}
            fontFamily={textFont()}
            fontStyle="600"
            lineHeight={1.2}
            align={l.label.align}
            fill={INK}
            wrap="none"
            ellipsis
            listening={false}
            perfectDrawEnabled={false}
          />
        )}
        {l.caption && (
          <Text
            x={l.caption.x}
            y={l.caption.y}
            width={l.caption.w}
            text={look.caption}
            fontSize={CAPTION_SIZE}
            fontFamily={textFont()}
            lineHeight={1.2}
            fill={MUTED}
            wrap="none"
            ellipsis
            listening={false}
            perfectDrawEnabled={false}
          />
        )}
      </Group>
    );
  },
  migrations: [],
};
