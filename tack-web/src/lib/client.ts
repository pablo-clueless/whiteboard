import axios, { AxiosError } from "axios";

import { sessionToken, useUserStore } from "@/stores/user";
import { env } from "./env";

/** What every failed request rejects with. `status` 0 means the server couldn't be reached. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

async function resolveData(data: unknown): Promise<unknown> {
  if (!(data instanceof Blob)) return data;
  try {
    const text = await data.text();
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/** The server answers errors with `{ error: "…" }`. */
function messageOf(data: unknown): string | undefined {
  if (typeof data === "string" && data.trim()) return data;
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    return data.error;
  }
  return undefined;
}

/** The form field a 400 is about (`{ error, field }`), so the message can sit beside it. */
export function fieldOf(error: unknown): string | undefined {
  const data = error instanceof HttpError ? error.data : undefined;
  return data && typeof data === "object" && "field" in data && typeof data.field === "string"
    ? data.field
    : undefined;
}

/** The server's stable code for an error, like `two_factor_required`. */
export function codeOf(error: unknown): string | undefined {
  const data = error instanceof HttpError ? error.data : undefined;
  return data && typeof data === "object" && "code" in data && typeof data.code === "string"
    ? data.code
    : undefined;
}

const client = axios.create({ baseURL: env.apiUrl, timeout: 15000 });

client.interceptors.request.use((config) => {
  const token = sessionToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status ?? 0;
    const data = await resolveData(error.response?.data);
    const message =
      messageOf(data) ??
      (status === 0 ? "Can't reach the Tack server" : error.message) ??
      "An unexpected error occurred.";

    // The session ended (expired, revoked, or the account was suspended): forget it, and the
    // auth gate sends the user to sign in.
    if (status === 401 && sessionToken() && !error.config?.url?.startsWith("/api/auth/signin")) {
      useUserStore.getState().signout();
    }
    return Promise.reject(new HttpError(status, message, data));
  },
);

export const http = {
  get: <T>(url: string, params?: Record<string, unknown>) =>
    client.get<T>(url, { params }).then((response) => response.data),
  post: <T>(url: string, data?: unknown) =>
    client.post<T>(url, data).then((response) => response.data),
  patch: <T>(url: string, data?: unknown) =>
    client.patch<T>(url, data).then((response) => response.data),
  put: <T>(url: string, data?: unknown) =>
    client.put<T>(url, data).then((response) => response.data),
  delete: <T>(url: string, params?: Record<string, unknown>) =>
    client.delete<T>(url, { params }).then((response) => response.data),
};
