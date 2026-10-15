import { describe, expect, it } from "vitest";

import { normalizePathname } from "./utils";

const HREFS = ["/admin/overview", "/admin/users", "/admin/users/invites", "/admin/boards", "/"];

describe("normalizePathname", () => {
  it("matches a route exactly", () => {
    expect(normalizePathname("/admin/users", HREFS)).toBe("/admin/users");
  });

  it("matches the route a page is under", () => {
    expect(normalizePathname("/admin/boards/1b2c3d4e-0000-4000-8000-000000000000", HREFS)).toBe(
      "/admin/boards",
    );
  });

  it("prefers the deepest route, whatever the order", () => {
    expect(normalizePathname("/admin/users/invites/42", HREFS)).toBe("/admin/users/invites");
    expect(normalizePathname("/admin/users/invites", [...HREFS].reverse())).toBe(
      "/admin/users/invites",
    );
  });

  it("compares whole segments", () => {
    expect(normalizePathname("/admin/user", ["/admin/users"])).toBe("");
    expect(normalizePathname("/admin/usersx", ["/admin/users"])).toBe("");
  });

  it("ignores query, hash and stray slashes", () => {
    expect(normalizePathname("/admin/users/?tab=all#top", HREFS)).toBe("/admin/users");
    expect(normalizePathname("//admin//overview/", HREFS)).toBe("/admin/overview");
  });

  it("falls back to a shallower route, or nothing", () => {
    expect(normalizePathname("/elsewhere", HREFS)).toBe("/");
    expect(normalizePathname("/elsewhere", ["/admin/users"])).toBe("");
    expect(normalizePathname(undefined, HREFS)).toBe("");
  });
});
