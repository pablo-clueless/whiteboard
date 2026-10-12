"use client";

import { type MouseEvent, type KeyboardEvent, useState } from "react";
import { ListFilter } from "lucide-react";
import { cn } from "cn";
import {
  columnFilteringFeature,
  columnOrderingFeature,
  createFilteredRowModel,
  createSortedRowModel,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import type {
  ColumnDef,
  ColumnFiltersState,
  ColumnOrderState,
  Row,
  RowData,
  RowSelectionState,
  SortingState,
  Updater,
} from "@tanstack/react-table";

import { DataTableFilter, FilterProps } from "./data-table-filter";
import { EmptyState, type EmptyStateProps } from "./empty-state";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { Pagination } from "./pagination";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const features = tableFeatures({
  columnFilteringFeature,
  rowSortingFeature,
  rowSelectionFeature,
  columnOrderingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
});

const isInteractiveTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  !!target.closest(
    'button, a, input, select, textarea, label, [role="menuitem"], [role="checkbox"]',
  );

export type DataTableFeatures = typeof features;
export type ColumnsWithRowClick<TData extends RowData> = ColumnDef<
  DataTableFeatures,
  TData,
  unknown
>[] & {
  onRowClick?: (row: Row<DataTableFeatures, TData>) => void;
};
type TFeatures = DataTableFeatures;

interface Props<TData extends RowData> {
  columns: ColumnDef<TFeatures, TData, unknown>[];
  data: TData[];
  total: number;
  empty?: EmptyStateProps;
  filters?: FilterProps<TData>[];
  onFilter?: (filters: ColumnFiltersState) => void;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  onRowClick?: (row: Row<TFeatures, TData>) => void;
  onSearch?: (query: string) => void;
  page?: number;
  pageSize?: number;
  rowSelection?: RowSelectionState;
  showPageSizeChange?: boolean;
}

export const DataTable = <TData extends RowData>({
  columns,
  data,
  total,
  empty,
  onFilter,
  onPageChange,
  onPageSizeChange,
  onRowClick,
  onRowSelectionChange,
  onSearch,
  page = 1,
  pageSize = 10,
  rowSelection: externalRowSelection,
  showPageSizeChange,
}: Props<TData>) => {
  const [internalRowSelection, setInternalRowSelection] = useState<RowSelectionState>({});
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [query, setQuery] = useState("");

  const debouncedSearch = useDebouncedCallback((q: string) => onSearch?.(q), 500);

  const rowSelection = externalRowSelection ?? internalRowSelection;
  const handleRowClick = onRowClick ?? (columns as Partial<ColumnsWithRowClick<TData>>).onRowClick;
  const handleRowSelectionChange = (updaterOrValue: Updater<RowSelectionState>) => {
    const next =
      typeof updaterOrValue === "function" ? updaterOrValue(rowSelection) : updaterOrValue;
    if (onRowSelectionChange) onRowSelectionChange(next);
    else setInternalRowSelection(next);
  };

  const table = useTable({
    key: "",
    features,
    data,
    columns,
    onColumnFiltersChange: setColumnFilters,
    onColumnOrderChange: setColumnOrder,
    onRowSelectionChange: handleRowSelectionChange,
    onSortingChange: setSorting,
    state: { columnFilters, columnOrder, rowSelection, sorting },
  });

  const getFilterValues = (key: string): string[] => {
    const f = columnFilters.find((f) => f.id === key);
    return (f?.value as string[]) ?? [];
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    debouncedSearch(e.target.value);
  };

  const handleFilterChange = (
    key: string,
    value: string,
    type: FilterProps<TData>["type"] = "radio",
  ) => {
    const without = columnFilters.filter((f) => f.id !== key);
    let updated: ColumnFiltersState;
    if (type === "checkbox") {
      const current = (columnFilters.find((f) => f.id === key)?.value as string[]) ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      updated = next.length ? [...without, { id: key, value: next }] : without;
    } else {
      const current = (columnFilters.find((f) => f.id === key)?.value as string[])?.[0];
      updated = current === value ? without : [...without, { id: key, value: [value] }];
    }
    setColumnFilters(updated);
    onFilter?.(updated);
  };

  const rows = table.getRowModel().rows || [];
  const hasPagination = Boolean(total > pageSize);

  return (
    <div className="w-full rounded-md border bg-white">
      <div className="flex w-full items-center justify-between px-4 py-2">
        <Input
          className="w-75"
          onChange={handleQueryChange}
          placeholder="Search..."
          type="search"
          value={query}
        />
        {onFilter && (
          <Popover>
            <PopoverTrigger
              render={
                <Button variant="outline">
                  <ListFilter /> Filter
                </Button>
              }
            />
            <PopoverContent align="end">
              <PopoverHeader>
                <div className="flex items-center justify-between">
                  <PopoverTitle>Filters</PopoverTitle>
                </div>
                <PopoverDescription></PopoverDescription>
              </PopoverHeader>
              <DataTableFilter
                columnFilters={columnFilters}
                filters={[]}
                getFilterValues={getFilterValues}
                onFilterChange={handleFilterChange}
                setColumnFilters={setColumnFilters}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
      <div className={cn("w-full", hasPagination ? "border-t" : "")}>
        <Table>
          <TableHeader className={cn(hasPagination ? "rounded-t-lg" : "")}>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow className="h-11" key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="text-primary text-sm font-medium first:rounded-tl-lg last:rounded-tr-lg"
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {Boolean(rows.length) ? (
              rows.map((row) => (
                <TableRow
                  className={cn(
                    "data-[state=selected]:bg-primary/10 h-14",
                    handleRowClick && "cursor-pointer",
                  )}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  {...(handleRowClick
                    ? {
                        role: "button",
                        tabIndex: 0,
                        onClick: (event: MouseEvent<HTMLTableRowElement>) => {
                          if (!isInteractiveTarget(event.target)) handleRowClick(row);
                        },
                        onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          if (isInteractiveTarget(event.target)) return;
                          event.preventDefault();
                          handleRowClick(row);
                        },
                      }
                    : {})}
                  key={row.id}
                >
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id} className="whitespace-nowrap">
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="p-0">
                  <EmptyState
                    title={empty?.title ?? "No data available"}
                    action={empty?.action}
                    description={
                      empty?.description ??
                      "Nothing here matches the current filters. Try clearing them or searching for something broader."
                    }
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {hasPagination && (
        <div className="w-full">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
            showPageSizeChange={showPageSizeChange}
          />
        </div>
      )}
    </div>
  );
};
