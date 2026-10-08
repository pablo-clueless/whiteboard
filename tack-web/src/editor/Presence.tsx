"use client";

import { Group, Label, Path, Rect, Tag, Text } from "react-konva";
import { useEffect, useSyncExternalStore } from "react";
import type { Awareness } from "y-protocols/awareness";

import { screenToPage, useEditorStore } from "@/stores/editor";
import type { Editor } from "./editor-core";
import type { Vec } from "./types";

/** Cursors go out at most this often (HANDOFF: awareness at most every 50 ms). */
const CURSOR_INTERVAL_MS = 50;

const USER_COLORS = ["#e5484d", "#f76b15", "#e2a400", "#46a758", "#0090ff", "#8e4ec6", "#d6409f"];
const ANIMALS = [
  "Otter",
  "Heron",
  "Lynx",
  "Panda",
  "Gecko",
  "Moose",
  "Koala",
  "Bison",
  "Raven",
  "Tapir",
];

export type PresenceUser = { name: string; color: string };

/** What each client shares about itself. Never persisted. */
export type PresenceState = {
  user?: PresenceUser;
  /** Pointer position in page space, or null when it's off the board. */
  cursor?: Vec | null;
  selection?: string[];
};

/** A colour and a friendly name, stable for this client id. */
export function presenceUser(clientId: number): PresenceUser {
  return {
    name: `Anonymous ${ANIMALS[clientId % ANIMALS.length]}`,
    color: USER_COLORS[clientId % USER_COLORS.length],
  };
}

/**
 * Shares this client's name, pointer and selection over awareness. The pointer is throttled; the
 * selection goes out whenever it changes.
 */
export function usePresencePublisher(editor: Editor, awareness: Awareness) {
  useEffect(() => {
    awareness.setLocalStateField("user", presenceUser(awareness.clientID));
  }, [awareness]);

  useEffect(() => {
    awareness.setLocalStateField("selection", editor.ui.selectedIds);
    return useEditorStore.subscribe((s, prev) => {
      if (s.selectedIds !== prev.selectedIds)
        awareness.setLocalStateField("selection", s.selectedIds);
    });
  }, [editor, awareness]);

  useEffect(() => {
    let last = 0;
    let timer = 0;
    let pending: Vec | null = null;
    const send = () => {
      timer = 0;
      last = performance.now();
      awareness.setLocalStateField("cursor", pending);
    };
    const queue = (cursor: Vec | null) => {
      pending = cursor;
      if (timer) return;
      const wait = CURSOR_INTERVAL_MS - (performance.now() - last);
      if (wait <= 0) send();
      else timer = window.setTimeout(send, wait);
    };

    const onMove = (e: PointerEvent) => {
      const container = editor.stage?.container();
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      // Over toolbars and panels the pointer isn't on the board.
      const onCanvas = inside && container.contains(e.target as Node);
      queue(
        onCanvas
          ? screenToPage({ x: e.clientX - rect.left, y: e.clientY - rect.top }, editor.ui.camera)
          : null,
      );
    };
    const onLeave = () => queue(null);

    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [editor, awareness]);
}

type Remote = { clientId: number; state: PresenceState };

/** Everyone else on the board, as an immutable snapshot that changes only when awareness does. */
function useRemotePresence(awareness: Awareness): Remote[] {
  return useSyncExternalStore(
    (onChange) => {
      awareness.on("change", onChange);
      return () => awareness.off("change", onChange);
    },
    () => snapshot(awareness),
    () => EMPTY,
  );
}

const EMPTY: Remote[] = [];
const snapshots = new WeakMap<Awareness, { key: Map<number, unknown>; value: Remote[] }>();

/**
 * Awareness replaces a client's state object whenever it changes, so identity tells us what's
 * new. Our own state is left out, so moving our own pointer doesn't redraw this layer.
 */
function snapshot(awareness: Awareness): Remote[] {
  const remote = new Map(awareness.getStates() as Map<number, PresenceState>);
  remote.delete(awareness.clientID);
  const prev = snapshots.get(awareness);
  if (
    prev &&
    prev.key.size === remote.size &&
    [...remote].every(([id, s]) => prev.key.get(id) === s)
  ) {
    return prev.value;
  }
  const value: Remote[] = [];
  remote.forEach((state, clientId) => {
    if (state.user) value.push({ clientId, state });
  });
  snapshots.set(awareness, { key: remote, value });
  return value;
}

/** Re-renders when shapes move, so remote selection outlines follow them. */
function useIndexVersion(editor: Editor) {
  return useSyncExternalStore(
    (onChange) => editor.indexChanged.subscribe(onChange),
    () => editor.indexVersion,
    () => 0,
  );
}

/** Other people's cursors and selection outlines. Drawn on its own layer so shapes never redraw. */
export function RemotePresence({ editor, awareness }: { editor: Editor; awareness: Awareness }) {
  const remotes = useRemotePresence(awareness);
  const zoom = useEditorStore((s) => s.camera.zoom);
  useIndexVersion(editor);

  return remotes.map(({ clientId, state }) => {
    const { color, name } = state.user!;
    return (
      <Group key={clientId}>
        {(state.selection ?? []).map((id) => {
          const b = editor.getBounds(id);
          if (!b) return null;
          const pad = 4 / zoom;
          return (
            <Rect
              key={id}
              x={b.x - pad}
              y={b.y - pad}
              width={b.w + pad * 2}
              height={b.h + pad * 2}
              stroke={color}
              strokeWidth={1.5 / zoom}
              dash={[6 / zoom, 4 / zoom]}
              cornerRadius={3 / zoom}
            />
          );
        })}
        {state.cursor && (
          <Group x={state.cursor.x} y={state.cursor.y} scaleX={1 / zoom} scaleY={1 / zoom}>
            <Path
              data="M0 0 L0 16 L4.5 12.2 L7.6 19 L10.4 17.8 L7.4 11.2 L13 11 Z"
              fill={color}
              stroke="white"
              strokeWidth={1.25}
              lineJoin="round"
            />
            <Label x={12} y={18}>
              <Tag fill={color} cornerRadius={6} />
              <Text text={name} fill="white" fontSize={11} fontStyle="600" padding={5} />
            </Label>
          </Group>
        )}
      </Group>
    );
  });
}
