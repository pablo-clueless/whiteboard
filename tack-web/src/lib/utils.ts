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

export function normalizePathname(pathname?: string) {
  if (!pathname) return "";
  if (!pathname) return "";
  const qIndex = pathname.indexOf("?");
  const hIndex = pathname.indexOf("#");
  const end =
    qIndex === -1
      ? hIndex === -1
        ? pathname.length
        : hIndex
      : hIndex === -1
        ? qIndex
        : Math.min(qIndex, hIndex);
  const cleanPath = pathname.slice(0, end);
  if (cleanPath.length <= 3) return cleanPath;

  let firstPart = "";
  let secondPart = "";
  let partCount = 0;
  const start = cleanPath.startsWith("/") ? 1 : 0;

  for (let i = start; i < cleanPath.length; i++) {
    if (cleanPath[i] === "/") {
      if (partCount === 0 && firstPart) {
        partCount++;
        continue;
      }
      if (partCount === 1 && secondPart) {
        break;
      }
      continue;
    }

    if (partCount === 0) {
      firstPart += cleanPath[i];
    } else if (partCount === 1) {
      secondPart += cleanPath[i];
    }
  }

  if (!firstPart) return "";
  if (!secondPart) return `/${firstPart}`;
  return `/${firstPart}/${secondPart}`;
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
