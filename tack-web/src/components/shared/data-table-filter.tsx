"use client";

import { ColumnFiltersState, RowData } from "@tanstack/react-table";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { formatCatalogLabel } from "@/lib/utils";
import { Checkbox } from "../ui/checkbox";
import { Button } from "../ui/button";
import { Option } from "@/types/app";

export type FilterProps<TData extends RowData> = {
  key: keyof TData & string;
  label: string;
  options: Option[];
  placeholder?: string;
  type?: "radio" | "checkbox" | "select";
};

export type DataTableFilterProps<TData extends RowData> = {
  columnFilters: ColumnFiltersState;
  filters: FilterProps<TData>[];
  getFilterValues: (key: keyof TData & string) => string[];
  onFilterChange: (
    key: keyof TData & string,
    value: string,
    type?: "radio" | "checkbox" | "select",
  ) => void;
  setColumnFilters: (filters: ColumnFiltersState) => void;
};

export const DataTableFilter = <TData extends RowData>({
  columnFilters,
  filters,
  getFilterValues,
  onFilterChange,
  setColumnFilters,
}: DataTableFilterProps<TData>) => {
  const hasFilters = Boolean(columnFilters.length);

  const handleClearFilters = () => {
    setColumnFilters([]);
  };

  const render = (filter: FilterProps<TData>) => {
    switch (filter.type) {
      case "checkbox":
        return (
          <div className="flex flex-wrap gap-4 space-y-1">
            {filter.options.map((option) => {
              const selected = getFilterValues(filter.key).includes(option.value);
              return (
                <div className="flex items-center gap-x-2" key={option.value}>
                  <Checkbox
                    checked={selected}
                    onCheckedChange={() => onFilterChange(filter.key, option.value, "checkbox")}
                  />
                  <span className="text-xs">{formatCatalogLabel(option.label)}</span>
                </div>
              );
            })}
          </div>
        );
      case "radio":
        return (
          <RadioGroup
            value={getFilterValues(filter.key)[0] ?? ""}
            onValueChange={(value) => onFilterChange(filter.key, value, "radio")}
            className="flex flex-wrap items-center gap-3"
          >
            {filter.options.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 text-xs">
                <RadioGroupItem
                  id={`${filter.key}-${option.value}`}
                  value={option.value}
                  className="accent-primary"
                />
                {formatCatalogLabel(option.label)}
              </label>
            ))}
          </RadioGroup>
        );
      case "select":
        return (
          <Select
            onValueChange={(value) => onFilterChange(filter.key, value, filter.type)}
            value={getFilterValues(filter.key)[0] || ""}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {formatCatalogLabel(option.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      default:
        return (
          <Select>
            <SelectTrigger>
              <SelectContent />
            </SelectTrigger>
            <SelectContent>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
    }
  };

  return (
    <div className="space-y-2">
      {filters.map((filter) => (
        <div className="space-y-1.5" key={filter.key}>
          <p className="text-xs">{filter.label}</p>
          {render(filter)}
          {hasFilters && (
            <Button onClick={handleClearFilters} size="sm" variant="destructive">
              Clear Filters
            </Button>
          )}
        </div>
      ))}
    </div>
  );
};
