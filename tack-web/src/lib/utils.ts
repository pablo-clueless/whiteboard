import { format } from "date-fns";
export { cn } from "cn";

export function capitalize(value?: string) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function getBreadcrumbs(pathname: string) {
  if (!pathname) return [];
  const paths = pathname.split("/").filter(Boolean);
  return paths.map((path) => ({ label: capitalize(path), href: `/${path}` }));
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
