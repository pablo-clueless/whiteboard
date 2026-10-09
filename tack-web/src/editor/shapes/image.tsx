import { Group, Image as KonvaImage, Rect, Text } from "react-konva";
import { useSyncExternalStore } from "react";

import type { ShapeDef } from "../types";
import { assetUrl } from "@/lib/api";
import { esc, n } from "../svg";

import { boxBounds, boxResize, num, str } from "./box";

export type ImageProps = {
  /** Content hash of the uploaded image; served from /api/assets/<id>. */
  assetId: string;
  w: number;
  h: number;
};

type Loaded =
  { status: "loading" } | { status: "ready"; img: HTMLImageElement } | { status: "error" };

/** One <img> per asset for the whole page, shared by every shape and by export. */
const images = new Map<
  string,
  { state: Loaded; listeners: Set<() => void>; ready: Promise<void> }
>();

function entry(assetId: string) {
  let e = images.get(assetId);
  if (e) return e;
  const listeners = new Set<() => void>();
  let settle!: () => void;
  const ready = new Promise<void>((r) => (settle = r));
  const created = { state: { status: "loading" } as Loaded, listeners, ready };
  images.set(assetId, created);
  const img = new window.Image();
  // Without CORS the canvas would be "tainted" and PNG export would fail.
  img.crossOrigin = "anonymous";
  img.onload = () => {
    created.state = { status: "ready", img };
    listeners.forEach((l) => l());
    settle();
  };
  img.onerror = () => {
    created.state = { status: "error" };
    listeners.forEach((l) => l());
    settle();
  };
  img.src = assetUrl(assetId);
  e = created;
  return e;
}

/** Resolves once the image has loaded (or failed), e.g. before exporting. */
export const whenImageLoaded = (assetId: string) => entry(assetId).ready;

/**
 * Resolves once every image the page has asked for has loaded (or failed): image shapes, and
 * images used inside other shapes (a custom component's icon).
 */
export const whenImagesLoaded = () =>
  Promise.all([...images.values()].map((e) => e.ready)).then(() => {});

/** The shared <img> for an asset, re-rendering when it loads. */
export function useAssetImage(assetId: string): Loaded {
  return useSyncExternalStore(
    (onChange) => {
      const e = entry(assetId);
      e.listeners.add(onChange);
      return () => e.listeners.delete(onChange);
    },
    () => entry(assetId).state,
    () => ({ status: "loading" }) as Loaded,
  );
}

export const imageShape: ShapeDef<ImageProps, "image"> = {
  type: "image",
  version: 1,
  defaultProps: { assetId: "", w: 240, h: 160 },
  validate: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      assetId: str(p.assetId, ""),
      w: Math.max(1, num(p.w, 240)),
      h: Math.max(1, num(p.h, 160)),
    };
  },
  getBounds: boxBounds,
  onResize: boxResize,
  // The editor swaps the URL for the image's bytes when exporting, so the file stands alone.
  toSvg: ({ props: p }) =>
    `<image href="${esc(assetUrl(p.assetId))}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="none"/>`,
  Component: function BoardImage({ shape }) {
    const { assetId, w, h } = shape.props;
    const loaded = useAssetImage(assetId);
    if (loaded.status === "ready") {
      return <KonvaImage image={loaded.img} width={w} height={h} perfectDrawEnabled={false} />;
    }
    // Placeholder while loading, or a clear marker if the image can't be fetched.
    return (
      <Group>
        <Rect
          width={w}
          height={h}
          fill="#f1f1f3"
          stroke="#d4d4da"
          strokeWidth={1}
          dash={[6, 4]}
          cornerRadius={4}
        />
        {loaded.status === "error" && (
          <Text
            text="Image unavailable"
            width={w}
            height={h}
            align="center"
            verticalAlign="middle"
            fontSize={Math.max(10, Math.min(16, w / 12))}
            fill="#8a8a93"
          />
        )}
      </Group>
    );
  },
  migrations: [],
};
