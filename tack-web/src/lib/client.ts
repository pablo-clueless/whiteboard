import axios, { AxiosError, AxiosRequestConfig } from "axios";

const baseURL = process.env.NEXT_PUBLIC_TACK_API_URL;

type ExtendAxiosRequestConfig = AxiosRequestConfig & {
  _maxRetries: number;
  _retry: boolean;
};

async function resolveError(data: unknown): Promise<unknown> {
  if (!(data instanceof Blob)) return data;
  try {
    const text = await data.text();
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function extractApiMessage(error: unknown): string | undefined {
  if (typeof error === "string" && error.trim()) return error;
  if (!error || typeof error !== "object") return undefined;
  if (error instanceof Error) return error.message;
  return undefined;
}

const client = axios.create({
  baseURL,
  timeout: 10000,
});

client.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer`;
  return config;
});

client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as ExtendAxiosRequestConfig;
    const status = error.response?.status;
    const err = await resolveError(error.response?.data);
    const message = extractApiMessage(err) ?? error.message ?? "An unexpected error occurred.";

    if (status === 401 && request.url !== "/auth/signin") {
      return Promise.reject({ data: err, message, status });
    }

    if (request._retry && request._maxRetries > 0) {
      // get new token, check if we are authenticated and retry request

      try {
        return client(request);
      } catch {
        return Promise.reject({
          data: err,
          message: "Session expired, please login again.",
          status,
        });
      }
    }
    request._retry = true;

    return Promise.reject(error);
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
  delete: <T>(url: string) => client.delete<T>(url).then((response) => response.data),
};
