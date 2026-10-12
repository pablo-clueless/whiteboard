import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { removeNullorUndefined } from "./utils";
import { http } from "./client";

interface UseApiMutationProps {
  keys: string | string[];
  method: "post" | "put" | "delete";
  url: string;
}

interface UseApiQueryProps {
  keys: string | string[];
  url: string;
  enabled?: boolean;
  params?: Record<string, unknown>;
}

export function useApiMutation<T, K>(options: UseApiMutationProps) {
  const qc = useQueryClient();
  const mutationKey = Array.isArray(options.keys) ? options.keys : [options.keys];

  return useMutation({
    mutationFn: (data: T) => http[options.method]<K>(options.url, data),
    mutationKey,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mutationKey });
      toast.success("Operation successful");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}

export function useApiQuery(options: UseApiQueryProps) {
  const queryKey = Array.isArray(options.keys) ? options.keys : [options.keys];
  const params = removeNullorUndefined(options.params || {});
  const enabled = options.enabled ?? true;

  return useQuery({
    queryFn: () => http.get(options.url, params),
    queryKey,
    enabled,
  });
}
