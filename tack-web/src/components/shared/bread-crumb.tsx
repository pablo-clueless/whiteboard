import { ChevronRight, Home, type LucideIcon } from "lucide-react";
import * as React from "react";
import Link from "next/link";
import { cn } from "cn";

type BreadcrumbItem = {
  label: string;
  href?: string;
  icon?: LucideIcon;
  disabled?: boolean;
};

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  separator?: React.ReactNode;
  homeHref?: string;
  showHome?: boolean;
  maxItems?: number;
  className?: string;
  itemClassName?: string;
  activeClassName?: string;
  separatorClassName?: string;
  collapsedLabel?: string;
}

interface BreadcrumbItemProps {
  item: BreadcrumbItem;
  isLast: boolean;
  className?: string;
  activeClassName?: string;
}

const BreadcrumbItemComponent = ({
  item,
  isLast,
  className,
  activeClassName,
}: BreadcrumbItemProps) => {
  const content = (
    <span className="flex items-center gap-1.5">
      {item.icon && <item.icon className="size-4" />}
      <span>{item.label}</span>
    </span>
  );

  if (isLast || !item.href || item.disabled) {
    return (
      <span
        className={cn("text-sm font-medium text-gray-600", activeClassName, className)}
        aria-current={isLast ? "page" : undefined}
      >
        {content}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      className={cn(
        "text-sm font-medium text-gray-400 transition-colors hover:text-gray-600",
        className,
      )}
    >
      {content}
    </Link>
  );
};

const BreadcrumbSeparator = ({
  separator,
  className,
}: {
  separator?: React.ReactNode;
  className?: string;
}) => (
  <span className={cn("text-gray-400", className)} aria-hidden="true">
    {separator ?? <ChevronRight className="size-4" />}
  </span>
);

const CollapsedItems = ({
  items,
  collapsedLabel = "...",
}: {
  items: BreadcrumbItem[];
  collapsedLabel?: string;
}) => {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
        aria-label="Show more breadcrumbs"
      >
        {collapsedLabel}
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 z-20 mt-1 flex min-w-50 flex-col gap-1 rounded-md border bg-white p-2 shadow-lg">
            {items.map((item, index) => (
              <div key={`${item.label}-${index}`}>
                {item.href ? (
                  <Link
                    href={item.href}
                    className="flex items-center gap-1.5 rounded px-2 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-100"
                    onClick={() => setIsOpen(false)}
                  >
                    {item.icon && <item.icon className="size-4" />}
                    <span>{item.label}</span>
                  </Link>
                ) : (
                  <span className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-gray-700">
                    {item.icon && <item.icon className="size-4" />}
                    <span>{item.label}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export const Breadcrumb = ({
  items,
  separator,
  homeHref = "/",
  showHome = true,
  maxItems,
  className,
  itemClassName,
  activeClassName,
  separatorClassName,
  collapsedLabel,
}: BreadcrumbProps) => {
  const allItems = React.useMemo(() => {
    const crumbs = [...items];

    if (showHome && crumbs[0]?.href !== homeHref) {
      crumbs.unshift({
        label: "Home",
        href: homeHref,
        icon: Home,
      });
    }

    return crumbs;
  }, [items, showHome, homeHref]);

  const displayItems = React.useMemo(() => {
    if (!maxItems || allItems.length <= maxItems) {
      return allItems;
    }

    const firstItem = allItems[0];
    const lastItems = allItems.slice(-(maxItems - 2));
    const collapsedItems = allItems.slice(1, -(maxItems - 2));

    return [firstItem, { collapsed: collapsedItems }, ...lastItems];
  }, [allItems, maxItems]);

  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center", className)}>
      <ol className="flex items-center gap-2">
        {displayItems.map((item, index) => {
          const isLast = index === displayItems.length - 1;
          const key = `breadcrumb-${index}`;

          if ("collapsed" in item) {
            return (
              <React.Fragment key={key}>
                <li>
                  <CollapsedItems
                    items={item.collapsed as BreadcrumbItem[]}
                    collapsedLabel={collapsedLabel}
                  />
                </li>
                {!isLast && (
                  <li>
                    <BreadcrumbSeparator separator={separator} className={separatorClassName} />
                  </li>
                )}
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={key}>
              <li>
                <BreadcrumbItemComponent
                  item={item as BreadcrumbItem}
                  isLast={isLast}
                  className={itemClassName}
                  activeClassName={activeClassName}
                />
              </li>
              {!isLast && (
                <li>
                  <BreadcrumbSeparator separator={separator} className={separatorClassName} />
                </li>
              )}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
};

export type { BreadcrumbProps, BreadcrumbItem };
