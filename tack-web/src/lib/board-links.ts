import type { Role } from "./api";

/**
 * Share links live in the URL fragment (`/b/<id>#t=<token>`), which browsers never send to a
 * server. On open we move the token into this browser's storage and strip it from the address
 * bar, so a screenshot or a pasted address doesn't leak access. Sharing goes through the share
 * dialog instead.
 */

const key = (boardId: string, role: Role) => `tack:link:${boardId}:${role}`;

export function rememberLink(boardId: string, role: Role, token: string) {
  try {
    localStorage.setItem(key(boardId, role), token);
  } catch {
    // Storage unavailable (private mode): the link still works for this visit.
  }
}

export function rememberedLink(boardId: string, role: Role): string | null {
  try {
    return localStorage.getItem(key(boardId, role));
  } catch {
    return null;
  }
}

export function forgetLink(boardId: string, role: Role) {
  try {
    localStorage.removeItem(key(boardId, role));
  } catch {
    // Nothing to forget.
  }
}

/** Reads `#t=<token>` from the address bar and removes it. */
export function takeTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("t");
  if (token) {
    history.replaceState(history.state, "", window.location.pathname + window.location.search);
  }
  return token;
}

export function shareUrl(boardId: string, token: string) {
  return `${window.location.origin}/b/${boardId}#t=${encodeURIComponent(token)}`;
}

/* ── Boards this browser just created ───────────────────────────────────── */

const newKey = (boardId: string) => `tack:new-board:${boardId}`;

/** Marks a board as just created here, so it opens with the template picker. */
export function markNewBoard(boardId: string) {
  try {
    sessionStorage.setItem(newKey(boardId), "1");
  } catch {
    // No storage: the board just opens blank.
  }
}

/** Whether this browser just created the board and hasn't picked a template for it yet. */
export function isNewBoard(boardId: string): boolean {
  try {
    return sessionStorage.getItem(newKey(boardId)) === "1";
  } catch {
    return false;
  }
}

/** The template choice has been made (or skipped); don't offer it again. */
export function clearNewBoard(boardId: string) {
  try {
    sessionStorage.removeItem(newKey(boardId));
  } catch {
    // Nothing to clear.
  }
}
