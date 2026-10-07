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
