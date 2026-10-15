import { format } from "date-fns";
export { cn } from "cn";

export function capitalize(value?: string) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * One crumb per path segment, each linking to the path up to it. `labels` names segments that
 * aren't words, such as ids; an id without one shows as "…" until it loads.
 */
export function getBreadcrumbs(pathname: string, labels: Record<string, string> = {}) {
  if (!pathname) return [];
  const paths = pathname.split("/").filter(Boolean);
  return paths.map((path, i) => ({
    label: labels[path] ?? (/^[0-9a-f-]{36}$/i.test(path) ? "…" : capitalize(path)),
    href: `/${paths.slice(0, i + 1).join("/")}`,
  }));
}

export function getDelta(delta?: string) {
  if (!delta) return "neutral";
  return delta.startsWith("-") ? "negative" : "positive";
}

export function formatCatalogLabel(name?: string) {
  if (!name) return "";

  const ranges: string[] = [];
  const stashRange = (match: string) => {
    const normalized = match.replace(/\s*[-–—]\s*/, " - ").replace(/^(\d+)\s+(\d+)$/, "$1 - $2");
    ranges.push(normalized);
    return `\u0000RANGE${ranges.length - 1}\u0000`;
  };

  const withPlaceholders = name
    .replace(/\d+\s*[-–—]\s*\d+/g, stashRange)
    .replace(/\d+\s+\d+/g, stashRange);

  return withPlaceholders
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\u0000RANGE(\d+)\u0000/g, (_, index) => ranges[Number(index)] ?? "");
}

export function formatDate(date?: Date | string, formatStr = "dd/MM/yy") {
  if (!date) return "--";
  const parsed = new Date(date);
  return format(parsed, formatStr);
}

const segments = (path: string) => path.split(/[?#]/)[0].split("/").filter(Boolean);

/**
 * The route in `hrefs` that `pathname` is on: the deepest one whose segments all lead the path's,
 * so `/admin/users/:id` gives `/admin/users`, and a nested route beats its parent. Whole segments
 * are compared, so `/admin/user` doesn't match `/admin/users`. "" when nothing matches.
 */
export function normalizePathname(pathname: string | undefined, hrefs: readonly string[]) {
  if (!pathname) return "";
  const path = segments(pathname);
  let best = "";
  let depth = -1;
  for (const href of hrefs) {
    const route = segments(href);
    if (route.length <= depth || route.length > path.length) continue;
    if (route.every((segment, i) => segment === path[i])) {
      best = href;
      depth = route.length;
    }
  }
  return best;
}

export function removeNullorUndefined(params: Record<string, unknown>) {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(
      ([, v]) => v !== null && v !== undefined && v !== "" && v !== "all",
    ),
  );
  return filtered;
}

export function getRandomNumber(min = 0, max = 100) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
