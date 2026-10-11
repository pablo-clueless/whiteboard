"use client";

import { useCallback, useMemo, useState } from "react";

export const useValues = <T extends object>(initialValues: T) => {
  const [values, setValues] = useState(initialValues);

  const memoizedValues = useMemo(() => values, [values]);

  const onValueChange = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((values) => ({ ...values, [key]: value }));
  }, []);

  const onValuesChange = useCallback((values: T) => {
    setValues(values);
  }, []);

  return {
    onValueChange,
    onValuesChange,
    values: memoizedValues,
  };
};
