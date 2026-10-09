import { describe, expect, it } from "vitest";

import { looksLikeDbml, parseDbml } from "./dbml";

const SAMPLE = `
Table User {
  id uuid pk
  name varchar
  subscription uuid [ref : > Subscription.id]
  badge uuid[] [ref : > Badge.id]
}

Table Subscription {
  id uuid pk
    subscriptionTier varchar //"free" | "basic"
}

Table Badge {
  id uuid [pk]
  price decimal(10, 2) [not null, note: 'a, b']
}

Table Comment {
  id uuid pk
  replies uuid[] [ref  : > Comment.id]
}
`;

describe("parseDbml", () => {
  const schema = parseDbml(SAMPLE);

  it("reads every table and field without warnings", () => {
    expect(schema.warnings).toEqual([]);
    expect(schema.tables.map((t) => [t.name, t.fields.length])).toEqual([
      ["User", 4],
      ["Subscription", 2],
      ["Badge", 2],
      ["Comment", 2],
    ]);
  });

  it("accepts bare and bracketed primary keys", () => {
    expect(schema.tables.find((t) => t.name === "User")!.fields[0].pk).toBe(true);
    expect(schema.tables.find((t) => t.name === "Badge")!.fields[0].pk).toBe(true);
  });

  it("keeps array and parameterised types, and comments as notes", () => {
    const user = schema.tables.find((t) => t.name === "User")!;
    expect(user.fields[3].type).toBe("uuid[]");
    const badge = schema.tables.find((t) => t.name === "Badge")!;
    expect(badge.fields[1]).toMatchObject({ type: "decimal(10, 2)", notNull: true, note: "a, b" });
    const sub = schema.tables.find((t) => t.name === "Subscription")!;
    expect(sub.fields[1].note).toBe('"free" | "basic"');
  });

  it("reads inline refs, including odd spacing and self-references", () => {
    expect(
      schema.refs.map(
        (r) => `${r.from.table}.${r.from.field} ${r.kind} ${r.to.table}.${r.to.field}`,
      ),
    ).toEqual([
      "User.subscription > Subscription.id",
      "User.badge > Badge.id",
      "Comment.replies > Comment.id",
    ]);
  });

  it("reads standalone refs, enums and aliases", () => {
    const s = parseDbml(`
Table users as U {
  id int [pk]
}
Table posts {
  id int [pk]
  user_id int
}
Enum status {
  draft
  published [note: 'live']
}
Ref: posts.user_id > U.id
Ref {
  posts.id - users.id
}
Project demo {
  database_type: 'PostgreSQL'
}
`);
    expect(s.warnings).toEqual([]);
    expect(s.tables.map((t) => `${t.kind}:${t.name}`)).toEqual([
      "table:users",
      "table:posts",
      "enum:status",
    ]);
    expect(s.tables[2].fields.map((f) => f.name)).toEqual(["draft", "published"]);
    expect(
      s.refs.map((r) => `${r.from.table}.${r.from.field}${r.kind}${r.to.table}.${r.to.field}`),
    ).toEqual(["posts.user_id>users.id", "posts.id-users.id"]);
  });

  it("reports lines it can't read instead of failing", () => {
    const s = parseDbml("Table t {\n  ??? what\n  ok int\n}");
    expect(s.tables[0].fields.map((f) => f.name)).toEqual(["ok"]);
    expect(s.warnings).toHaveLength(1);
  });
});

describe("looksLikeDbml", () => {
  it("spots DBML and ignores other text", () => {
    expect(looksLikeDbml("Table users {\n id int\n}")).toBe(true);
    expect(looksLikeDbml("Ref: a.b > c.d")).toBe(true);
    expect(looksLikeDbml("A table of contents\nwith words")).toBe(false);
    expect(looksLikeDbml("flowchart LR\n A --> B")).toBe(false);
  });
});
