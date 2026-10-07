import { getStroke } from "perfect-freehand";
import { useMemo } from "react";
import { Line } from "react-konva";

import type { Box, ShapeDef } from "../types";

import { clamp, MAX_STROKE_WIDTH, num, str } from "./box";

export type FreehandProps = {
  /** Flat [x, y, pressure, x, y, pressure, …] in the shape's own space. */
  samples: number[];
  stroke: string;
  /** Nominal pen size; pressure thins and thickens the stroke around it. */
  strokeWidth: number;
  /** Mice have no pressure, so their strokes fake it from speed. */
  simulatePressure: boolean;
};

const DEFAULT_FREEHAND: FreehandProps = {
  samples: [],
  stroke: "#000000",
  strokeWidth: 4,
  simulatePressure: true,
};

/** perfect-freehand's size is the full width; our strokeWidth reads as a pen size. */
const sizeFor = (strokeWidth: number) => strokeWidth * 2;

export function freehandOutline(p: FreehandProps, last = true): number[] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i + 2 < p.samples.length; i += 3)
    pts.push([p.samples[i], p.samples[i + 1], p.samples[i + 2]]);
  if (!pts.length) return [];
  return getStroke(pts, {
    size: sizeFor(p.strokeWidth),
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: p.simulatePressure,
    last,
  }).flat();
}

function samplesBox(samples: number[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < samples.length; i += 3) {
    [minX, minY] = [Math.min(minX, samples[i]), Math.min(minY, samples[i + 1])];
    [maxX, maxY] = [Math.max(maxX, samples[i]), Math.max(maxY, samples[i + 1])];
  }
  return minX === Infinity ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
}

export const freehandShape: ShapeDef<FreehandProps, "freehand"> = {
  type: "freehand",
  version: 1,
  defaultProps: DEFAULT_FREEHAND,
  validate: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const samples =
      Array.isArray(p.samples) &&
      p.samples.length % 3 === 0 &&
      p.samples.every((n) => typeof n === "number")
        ? (p.samples as number[])
        : [];
    return {
      samples,
      stroke: str(p.stroke, DEFAULT_FREEHAND.stroke),
      strokeWidth: clamp(num(p.strokeWidth, DEFAULT_FREEHAND.strokeWidth), 0.5, MAX_STROKE_WIDTH),
      simulatePressure: p.simulatePressure !== false,
    };
  },
  getBounds: (s): Box => {
    // Rotation is rare for strokes; use the rotated box of the sample bounds.
    const b = samplesBox(s.props.samples);
    const pad = sizeFor(s.props.strokeWidth) / 2;
    const r = (s.rotation * Math.PI) / 180;
    const [c, sn] = [Math.cos(r), Math.sin(r)];
    const corners = [
      [b.minX - pad, b.minY - pad],
      [b.maxX + pad, b.minY - pad],
      [b.minX - pad, b.maxY + pad],
      [b.maxX + pad, b.maxY + pad],
    ].map(([x, y]) => [s.x + x * c - y * sn, s.y + x * sn + y * c]);
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  },
  onResize: (shape, { scaleX, scaleY, initial }) => {
    const start = initial.props as FreehandProps;
    return {
      props: {
        ...shape.props,
        samples: start.samples.map((v, i) =>
          i % 3 === 0 ? v * scaleX : i % 3 === 1 ? v * scaleY : v,
        ),
      },
    };
  },
  Component: function FreehandStroke({ shape }) {
    const p = shape.props;
    const outline = useMemo(() => freehandOutline(p), [p]);
    return (
      <Line
        points={outline}
        closed
        fill={p.stroke}
        strokeEnabled={false}
        perfectDrawEnabled={false}
      />
    );
  },
  migrations: [],
};
