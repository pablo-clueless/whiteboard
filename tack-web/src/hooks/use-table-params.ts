"use client";

import type { ColumnFiltersState, RowSelectionState } from "@tanstack/react-table";
import { useState } from "react";

import { filterParams } from "@/lib/admin";

/**
 * Paging, search, filters and selection for a server-driven DataTable. Spread `tableProps` into
 * the table and pass `params` to the list query.
 */
export function useTableParams(initialLimit = 10) {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(initialLimit);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  return {
    params: { page, limit, search, ...filterParams(filters) },
    rowSelection,
    clearSelection: () => setRowSelection({}),
    tableProps: {
      page,
      pageSize: limit,
      rowSelection,
      onRowSelectionChange: setRowSelection,
      onPageChange: setPage,
      onPageSizeChange: (size: number) => {
        setLimit(size);
        setPage(1);
      },
      onSearch: (q: string) => {
        setSearch(q);
        setPage(1);
      },
      onFilter: (f: ColumnFiltersState) => {
        setFilters(f);
        setPage(1);
      },
    },
  };
}
