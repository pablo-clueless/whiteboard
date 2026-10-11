import type { ColumnDef, Row, RowData } from "@tanstack/react-table";
import { MoreVertical, type LucideIcon } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Fragment } from "react";
import Link from "next/link";
import { cn } from "cn";

import type { ColumnsWithRowClick, DataTableFeatures } from "@/components/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

/** Column type accepted by {@link DataTable}: bound to its registered v9 feature set. */
export type Column<T extends RowData> = ColumnDef<DataTableFeatures, T, unknown>;

type TabelActionVariant = "amber" | "default" | "destructive" | "info" | "success" | "warning";

const variants: Record<TabelActionVariant, string> = {
  amber: "text-amber-500 hover:text-amber-600 hover:bg-amber-100/90",
  default: "text-neutral-500 hover:text-neutral-600 hover:bg-neutral-100/90",
  destructive: "text-red-500 hover:text-red-600 hover:bg-red-100/90",
  info: "text-blue-500 hover:text-blue-600 hover:bg-blue-100/90",
  success: "text-green-500 hover:text-green-600 hover:bg-green-100/10",
  warning: "text-yellow-500 hover:text-yellow-600 hover:bg-yellow-100/10",
};

interface TableActionItem<T> {
  label: string;
  icon?: LucideIcon;
  hidden?: boolean | ((args: T) => boolean);
  href?: string | ((args: T) => string);
  onClick?: (args: T) => void;
  variant?: TabelActionVariant | (string & {});
}

interface CreateColumnsProps<T extends object> {
  columns: Column<T>[];
  actions?: (rowItem: T) => TableActionItem<T>[];
  actionColumnId?: string;
  actionColumnHeader?: string;
  baseHref?: string;
  onRowClick?: (row: Row<DataTableFeatures, T>) => void;
  selectable?: boolean;
}

/** Resolves a value that may be given directly or as a function of the row. */
const resolve = <T, V>(value: V | ((args: T) => V) | undefined, args: T): V | undefined =>
  typeof value === "function" ? (value as (args: T) => V)(args) : value;

const RowActions = <T extends object>({
  row,
  items,
  baseHref,
}: {
  row: T;
  items: TableActionItem<T>[];
  baseHref?: string;
}) => {
  const visible = items.filter((item) => !resolve(item.hidden, row));
  if (visible.length === 0) return null;

  return (
    <div className="flex justify-end">
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Row actions">
              <MoreVertical className="size-4" />
            </Button>
          }
        />
        <PopoverContent align="end" className="w-44 gap-0.5 p-1">
          {visible.map((item, index) => {
            const Icon = item.icon;
            const href = resolve(item.href, row);
            const className = cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
              variants[item.variant as TabelActionVariant] ?? variants.default,
            );
            const content = (
              <Fragment>
                {Icon && <Icon className="size-4" />}
                {item.label}
              </Fragment>
            );
            return href ? (
              <Link key={index} href={baseHref ? `${baseHref}${href}` : href} className={className}>
                {content}
              </Link>
            ) : (
              <Button
                key={index}
                type="button"
                variant="ghost"
                className={cn(className, "h-auto justify-start font-normal")}
                onClick={() => item.onClick?.(row)}
              >
                {content}
              </Button>
            );
          })}
        </PopoverContent>
      </Popover>
    </div>
  );
};

/**
 * Assembles a {@link DataTable}-ready column set: an optional leading selection
 * checkbox, the provided data columns, then an optional trailing action menu.
 */
export function createColumns<T extends object>({
  columns,
  actions,
  actionColumnId = "actions",
  actionColumnHeader = "",
  baseHref,
  onRowClick,
  selectable,
}: CreateColumnsProps<T>): ColumnsWithRowClick<T> {
  const result: Column<T>[] = [];

  if (selectable) {
    result.push({
      id: "select",
      enableSorting: false,
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && undefined)
          }
          onCheckedChange={(checked: boolean) => table.toggleAllPageRowsSelected(checked)}
          aria-label="Select all rows"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(checked: boolean) => row.toggleSelected(checked)}
          aria-label="Select row"
        />
      ),
    });
  }

  result.push(...columns);

  if (actions) {
    result.push({
      id: actionColumnId,
      header: actionColumnHeader,
      enableSorting: false,
      cell: ({ row }) => (
        <RowActions row={row.original} items={actions(row.original)} baseHref={baseHref} />
      ),
    });
  }

  // Attached rather than returned separately so every call site keeps passing a
  // plain `columns={...}` — see `ColumnsWithRowClick`.
  const withRowClick = result as ColumnsWithRowClick<T>;
  withRowClick.onRowClick = onRowClick;
  return withRowClick;
}

export const TextCell = ({ value, className }: { value?: string | null; className?: string }) =>
  value?.trim() ? (
    <div className={className}>{value}</div>
  ) : (
    <div className={cn("text-muted-foreground", className)}>—</div>
  );

export const DateCell = ({
  date,
  className,
}: {
  date: Date | string | null;
  className?: string;
}) => {
  if (!date) return <div className={cn("text-muted-foreground", className)}>—</div>;
  return <div className={className}>{format(new Date(date), "dd/MM/yyyy")}</div>;
};

export const TimeCell = ({
  date,
  className,
}: {
  date: Date | string | null;
  className?: string;
}) => {
  if (!date) return <div className={cn("text-muted-foreground", className)}>—</div>;
  return <div className={className}>{format(new Date(date), "HH:mm")}</div>;
};

export const DateTimeCell = ({
  date,
  className,
}: {
  date: Date | string | null;
  className?: string;
}) => {
  if (!date) return <div className={cn("text-muted-foreground", className)}>—</div>;
  return <div className={className}>{format(new Date(date), "dd/MM/yyyy, HH:mm")}</div>;
};

export const RelativeTimeCell = ({
  date,
  className,
}: {
  date: Date | string | null;
  className?: string;
}) => {
  if (!date) return <div className={cn("text-muted-foreground", className)}>—</div>;
  return (
    <div title={format(new Date(date), "dd/MM/yyyy HH:mm")} className={className}>
      {formatDistanceToNow(new Date(date), { addSuffix: true })}
    </div>
  );
};

export const PercentageCell = ({ value, decimals = 1 }: { value: number; decimals?: number }) => {
  return <span>{value.toFixed(decimals)}%</span>;
};

export const BooleanCell = ({
  value,
  labels = ["Yes", "No"],
}: {
  value: boolean;
  labels?: [string, string];
}) => {
  return (
    <span className={cn("text-xs font-medium", value ? "text-success" : "text-destructive")}>
      {value ? labels[0] : labels[1]}
    </span>
  );
};

export type StatusVariant =
  "amber" | "danger" | "draft" | "info" | "neutral" | "outline" | "success" | "warning";

const STATUS_DEFAULTS: Record<string, StatusVariant> = {
  active: "success",
  approved: "success",
  completed: "success",
  paid: "success",
  published: "success",
  cancelled: "danger",
  failed: "danger",
  rejected: "danger",
  terminated: "danger",
  draft: "draft",
  "in-progress": "warning",
  inactive: "neutral",
  pending: "warning",
  review: "info",
  suspended: "neutral",
};

export const STATUS_STYLES: Record<StatusVariant, string> = {
  amber: "bg-amber-100 text-amber-600 border-amber-300",
  danger: "bg-red-100 text-red-600 border-red-300",
  draft: "bg-muted text-muted-foreground border-border",
  info: "bg-blue-100 text-blue-600 border-blue-300",
  neutral: "bg-muted text-muted-foreground border-border",
  outline: "bg-transparent text-foreground border-foreground",
  success: "bg-green-100 text-green-600 border-green-300",
  warning: "bg-yellow-100 text-yellow-600 border-yellow-300",
};

interface StatusCellProps<TStatus extends string> {
  status: TStatus;
  className?: string;
  config?: Partial<Record<TStatus, StatusVariant>>;
  default?: StatusVariant;
}

/** Splits kebab-case ("in-progress") and PascalCase ("PendingFinalApproval") status strings into readable words. */
const toReadableStatus = (status: string): string =>
  status
    .replace(/-/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();

export const StatusCell = <TStatus extends string>({
  status,
  className,
  config,
  default: fallback = "neutral",
}: StatusCellProps<TStatus>) => {
  const map: Record<string, StatusVariant> = config
    ? { ...STATUS_DEFAULTS, ...config }
    : STATUS_DEFAULTS;
  const variant = map[status?.toLowerCase()] ?? fallback;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
        STATUS_STYLES[variant],
        className,
      )}
    >
      {status ? toReadableStatus(status) : status}
    </span>
  );
};

export const SerialNumberCell = <T extends RowData>({
  row,
}: {
  row: Row<DataTableFeatures, T>;
}) => <span>{row.index + 1}</span>;
