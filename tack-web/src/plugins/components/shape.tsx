import { Group, Rect, Text } from "react-konva";
import { Box } from "lucide";

import { glyph, iconSvg, type IconSpec, KonvaIcon, readable, tint } from "@/editor/icons";
import { componentCatalog, itemColor } from "@/editor/component-catalog";
import { boxBounds, boxResize, num, str } from "@/editor/shapes/box";
import { textFont } from "@/editor/shapes/text";
import type { ShapeDef } from "@/editor/types";
import { esc, n } from "@/editor/svg";

/**
 * A card for one service or technology: its logo on a tile, a name you can change, and the
 * provider underneath, in the provider's colours. Which logo and colours come from the catalog,
 * by `provider` and `item`, so the board stores only references.
 */
export type ComponentProps = {
  provider: string;
  item: string;
  /** Shown name, e.g. "orders-db". Starts as the item's name. */
  label: string;
  w: number;
  h: number;
};

export const COMPONENT_SIZE = { w: 200, h: 60 };

const FALLBACK: IconSpec = glyph(Box);
const FALLBACK_COLOR = "#5e5f66";

/** Colours, logo and caption for a card, falling back to a plain grey card if the item is unknown. */
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
    caption: found ? found.provider.label : p.provider || "Component",
  };
}

/** Layout inside a w×h card. The tile is square and never taller than the card. */
function layout(w: number, h: number) {
  const pad = Math.min(10, h * 0.16);
  const tile = Math.max(12, Math.min(h - pad * 2, 44));
  const icon = tile * 0.6;
  const textX = pad + tile + pad;
  return { pad, tile, icon, textX, textW: Math.max(0, w - textX - pad) };
}

const LABEL_SIZE = 14;
const CAPTION_SIZE = 11;
const INK = "#0e0e10";
const MUTED = "#6b6b75";

export const componentShape: ShapeDef<ComponentProps, "component"> = {
  type: "component",
  version: 1,
  defaultProps: { provider: "", item: "", label: "Component", ...COMPONENT_SIZE },
  validate: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      provider: str(p.provider, ""),
      item: str(p.item, ""),
      label: str(p.label, "Component").slice(0, 200),
      w: Math.max(40, num(p.w, COMPONENT_SIZE.w)),
      h: Math.max(28, num(p.h, COMPONENT_SIZE.h)),
    };
  },
  getBounds: boxBounds,
  onResize: boxResize,
  toSvg: ({ props: p }) => {
    const look = cardLook(p);
    const l = layout(p.w, p.h);
    const tileY = (p.h - l.tile) / 2;
    const mid = p.h / 2;
    return (
      `<rect width="${n(p.w)}" height="${n(p.h)}" rx="10" fill="${look.fill}" stroke="${look.accent}" stroke-width="1.5"/>` +
      `<rect x="${n(l.pad)}" y="${n(tileY)}" width="${n(l.tile)}" height="${n(l.tile)}" rx="8" fill="#ffffff" stroke="${look.tileStroke}"/>` +
      iconSvg(
        look.icon,
        look.iconColor,
        l.pad + (l.tile - l.icon) / 2,
        tileY + (l.tile - l.icon) / 2,
        l.icon,
      ) +
      `<text x="${n(l.textX)}" y="${n(mid - 4)}" font-family="${esc(textFont())}" font-weight="600" font-size="${LABEL_SIZE}" fill="${INK}">${esc(p.label)}</text>` +
      `<text x="${n(l.textX)}" y="${n(mid + 12)}" font-family="${esc(textFont())}" font-size="${CAPTION_SIZE}" fill="${MUTED}">${esc(look.caption)}</text>`
    );
  },
  Component: ({ shape, isSelected }) => {
    const p = shape.props;
    const look = cardLook(p);
    const l = layout(p.w, p.h);
    const tileY = (p.h - l.tile) / 2;
    const textH = LABEL_SIZE * 1.2 + 2 + CAPTION_SIZE * 1.2;
    const textY = (p.h - textH) / 2;
    return (
      <Group>
        <Rect
          width={p.w}
          height={p.h}
          cornerRadius={10}
          fill={look.fill}
          stroke={look.accent}
          strokeWidth={isSelected ? 2 : 1.5}
          perfectDrawEnabled={false}
        />
        <Rect
          x={l.pad}
          y={tileY}
          width={l.tile}
          height={l.tile}
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
          x={l.pad + (l.tile - l.icon) / 2}
          y={tileY + (l.tile - l.icon) / 2}
          size={l.icon}
        />
        <Text
          x={l.textX}
          y={textY}
          width={l.textW}
          text={p.label}
          fontSize={LABEL_SIZE}
          fontFamily={textFont()}
          fontStyle="600"
          lineHeight={1.2}
          fill={INK}
          wrap="none"
          ellipsis
          listening={false}
          perfectDrawEnabled={false}
        />
        <Text
          x={l.textX}
          y={textY + LABEL_SIZE * 1.2 + 2}
          width={l.textW}
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
      </Group>
    );
  },
  migrations: [],
};
