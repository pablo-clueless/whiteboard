"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hook that debounces a value, delaying updates until after a specified delay.
 *
 * @template T - The type of value to debounce
 * @param value - The value to debounce
 * @param delay - The delay in milliseconds before updating the debounced value
 * @returns The debounced value
 *
 * @example
 * ```tsx
 * const [searchTerm, setSearchTerm] = useState("");
 * const debouncedSearch = useDebounce(searchTerm, 500);
 *
 * useEffect(() => {
 *   // This runs 500ms after the user stops typing
 *   fetchSearchResults(debouncedSearch);
 * }, [debouncedSearch]);
 * ```
 */
/**
 * Returns a debounced version of `callback` that only fires after `delay` ms
 * of inactivity. Stable across renders — safe to use directly in event handlers.
 *
 * @example
 * const onSearch = useDebouncedCallback((q: string) => fetchResults(q), 300);
 * <input onChange={(e) => onSearch(e.target.value)} />
 */
export const useDebouncedCallback = <T extends (...args: Parameters<T>) => void>(
  callback: T,
  delay: number,
) => {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ref = useRef(callback);

  useEffect(() => {
    ref.current = callback;
  });

  return useCallback(
    (...args: Parameters<T>) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => ref.current(...args), delay);
    },
    [delay],
  );
};

export const useDebounce = <T>(value: T, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue as T;
};
