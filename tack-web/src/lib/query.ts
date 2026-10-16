import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { removeNullorUndefined } from "./utils";
import { fieldOf, http } from "./client";

type Keys = string | readonly unknown[];

const toKey = (keys: Keys) => (Array.isArray(keys) ? keys : [keys]);

interface UseApiMutationProps<T> {
  /** Queries to refetch afterwards; every query whose key starts with one of these. */
  keys: Keys | Keys[];
  method: "post" | "put" | "patch" | "delete";
  url: string | ((data: T) => string);
  /** Toast on success; false for none. */
  successMessage?: string | false;
  /**
   * For forms that show errors beside their fields: called instead of the error toast when the
   * server names the field at fault.
   */
  onFieldError?: (field: string, message: string) => void;
}

interface UseApiQueryProps {
  keys: Keys;
  url: string;
  enabled?: boolean;
  params?: Record<string, unknown>;
  /** Refetch this often, in ms. */
  refetchInterval?: number;
}

export function useApiMutation<T = unknown, K = unknown>(options: UseApiMutationProps<T>) {
  const qc = useQueryClient();
  const keys = toKey(options.keys);
  // `keys` is either one key or a list of keys; a list of lists means several.
  const invalidate = (Array.isArray(keys[0]) ? keys : [keys]) as unknown[][];

  return useMutation({
    mutationFn: (data: T) => {
      const url = typeof options.url === "function" ? options.url(data) : options.url;
      return options.method === "delete" ? http.delete<K>(url) : http[options.method]<K>(url, data);
    },
    onSuccess: () => {
      invalidate.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
      if (options.successMessage !== false) {
        toast.success(options.successMessage ?? "Operation successful");
      }
    },
    onError: (error) => {
      const field = fieldOf(error);
      if (field && options.onFieldError) options.onFieldError(field, error.message);
      else toast.error(error.message);
    },
  });
}

export function useApiQuery<T = unknown>(options: UseApiQueryProps) {
  const params = removeNullorUndefined(options.params || {});
  const queryKey = [...toKey(options.keys), params];
  const enabled = options.enabled ?? true;

  return useQuery({
    queryFn: () => http.get<T>(options.url, params),
    queryKey,
    enabled,
    refetchInterval: options.refetchInterval,
    // Keep the old page on screen while the next one loads, so tables don't flash empty.
    placeholderData: keepPreviousData,
  });
}
