import { env } from "./env";

// TODO: generate these from the Rust types with ts-rs (src/types/server/).
export type Role = "edit" | "view";

export type ShareLinks = { boardId: string; editToken: string; viewToken: string };
export type BoardInfo = { boardId: string; title: string; schemaVersion: number; role: Role };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  { method = "GET", token, body }: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Network failure: status 0 means "couldn't reach the server".
    throw new ApiError(0, "Can't reach the Tack server");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, data?.error ?? res.statusText);
  }
  return (await res.json()) as T;
}

/** Image types the server accepts, and the size limit. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const assetUrl = (assetId: string) => `${env.apiUrl}/api/assets/${assetId}`;

export const api = {
  createBoard: () => request<ShareLinks>("/api/boards", { method: "POST" }),
  getBoard: (boardId: string, token: string) =>
    request<BoardInfo>(`/api/boards/${boardId}`, { token }),
  /** Replaces both links; everyone using the old ones is disconnected. Edit links only. */
  resetLinks: (boardId: string, token: string) =>
    request<ShareLinks>(`/api/boards/${boardId}/tokens`, { method: "POST", token }),
  /** Uploads an image for a board. The id is the image's content hash. Edit links only. */
  uploadAsset: async (boardId: string, token: string, file: Blob) => {
    let res: Response;
    try {
      res = await fetch(`${env.apiUrl}/api/boards/${boardId}/assets`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });
    } catch {
      throw new ApiError(0, "Can't reach the Tack server");
    }
    const data = (await res.json().catch(() => null)) as {
      assetId?: string;
      error?: string;
    } | null;
    if (!res.ok || !data?.assetId) throw new ApiError(res.status, data?.error ?? res.statusText);
    return { assetId: data.assetId };
  },
  /** Adds one more link without revoking the others. Edit links only. */
  createLink: (boardId: string, token: string, role: Role) =>
    request<{ token: string; role: Role }>(`/api/boards/${boardId}/links`, {
      method: "POST",
      token,
      body: { role },
    }),
};
