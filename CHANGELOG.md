# Changelog

All notable changes to **Tack** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- PlantUML (`@startuml … @enduml`), pasted or in "From code": sequence, class, state, activity
  (`:step;` syntax) and entity (IE) diagrams. Other PlantUML diagrams say they aren't supported.
- Board names: editors rename a board in the top-left field, everyone sees it live, and it shows
  in the browser tab. The server copies it to `boards.title`, so the admin shows it too.
- People's names: pick the name on your cursor from the collaborators popover. It's remembered in
  this browser. Signed-in people default to their account name, and everyone else to
  "Anonymous <animal>".
- Email over SMTP (`lettre`, free with any mail server): set `TACK_SMTP_URL` and `TACK_MAIL_FROM`.
  Without them, emails are logged as before.
- Dev latency overlay: ping round trip through the board's room, and the time from a remote update
  arriving to it being drawn. Shown in dev builds, or with `?latency` in the URL.
- Mermaid state diagrams: states, `[*]` start and end, composite states (nested), choice, fork and
  join, labelled transitions.
- Diagrams drawn from code remember their code. With part of one selected, "From code" (or
  right-click → Edit diagram code…) opens on it and can redraw it in place, as one undo step.
- Relationships from a table's Fields box: `team uuid > teams.id` (or DBML's `[ref: > teams.id]`)
  draws the relationship to that table when you save.
- Tests: editor core (bindings, clipboard, groups, diagram updates, typed relationships) under
  jsdom, and the room actor end to end (relay, viewers, presence, pings, saving on close).
  `pnpm smoke:presence` and `pnpm smoke:ping` against a running server.

- Admin: users and boards open on their own pages (`/admin/users/:id`, `/admin/boards/:id`)
  instead of a side sheet, with names in the breadcrumbs. A user's page can also email a reset
  link or delete them.
- Your settings (`/admin/profile`): change your name, email (needs your password; the new address
  is verified and the old one told) and password (signs out your other sessions); two-factor
  sign-in; see and sign out your sessions; security alert emails; your name and cursor colour on
  boards.
- Security alert emails, on by default: password, email or two-factor changes, and signing in from
  a new address. Server: `PATCH /api/auth/me`, `POST /api/auth/password`, `/api/auth/sessions`.

### Security

- Removed malicious code from `tack-web/postcss.config.mjs` (added in `2dfee50`, hidden after
  `export default config;`). It fetched and ran remote code whenever the web app built.

### Fixed

- Admin breadcrumbs linked to `/users` rather than `/admin/users`.
- Someone joining a board now sees everyone already on it straight away. The server sent the
  current presence in the same WebSocket frame as sync step 1, and y-websocket reads only the
  first message in a frame, so late joiners saw nobody until each person's next cursor move.
- Clearing a board's title stores NULL, so it reads as untitled again.

## [0.1.0] - 2026-10-14

The first working version: milestones M0–M5 of `HANDOFF.md`, accounts and the admin interface.

### Added

- Real-time boards: Next.js + Konva editor on Yjs, synced through a Rust (axum + `yrs`) room actor
  per board, saved to Postgres as an update log with snapshots and compaction.
- Share links with edit and view roles (hashed tokens, reset links); origin check, message, rate
  and board-size limits; boards can be locked read-only.
- Shapes: rectangle, ellipse, polygon, star, line, arrow (bound, straight or elbow, routed round
  obstacles, self-loops, labels, arrowhead kinds), freehand with pressure, text with markdown and
  wrapping, sticky notes, images, frames (nesting, clipping), database tables, component cards
  (161 components across 13 providers) and board-made components.
- Point editing, groups, align, auto-arrange, snapping with guides and equal spacing, zoom to
  area, copy/paste, undo/redo, keyboard shortcuts, templates for new boards.
- Diagrams from DBML and Mermaid (flowchart, ER, class, sequence).
- Export as PNG, SVG and PDF.
- Presence: cursors with names and remote selections.
- Plugin API: shapes and tools register through `ShapeDef` and `Tool`; speech bubble, stamp
  shape and stamp tool are built that way.
- Accounts: sign-up, sign-in, email verification, password reset, two-factor authentication.
- Admin interface: overview, live rooms, users, boards and images, audit logs, settings, feature
  flags and system health.
