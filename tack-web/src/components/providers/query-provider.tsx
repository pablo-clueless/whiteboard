"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useState } from "react";

import { codeOf, type HttpError } from "@/lib/client";

interface Props {
  children: React.ReactNode;
}

function createClient() {
  // The server refuses admin requests from admins who haven't set up a required two-factor
  // sign-in. Reloading the config shows the auth gate's setup screen.
  const onError = (error: unknown) => {
    if (codeOf(error) === "two_factor_required") {
      client.invalidateQueries({ queryKey: ["public-config"] });
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // Retrying won't change a 4xx; it only delays the error.
        retry: (count, error) => (error as HttpError).status >= 500 && count < 2,
      },
    },
  });
  return client;
}

export const QueryProvider = ({ children }: Props) => {
  const [client] = useState(createClient);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
