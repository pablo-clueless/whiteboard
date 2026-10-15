# Tack

A real-time collaborative whiteboard. Open a board, share the link, and everyone on it draws and
edits together, with live cursors. It's built around a plugin interface for custom shapes and
tools, and it has no paid dependencies: the only costs are a server and a Postgres database.

- **`tack-web/`**: the Next.js app. A Konva canvas on a Yjs document, plus the landing page,
  accounts and the admin interface.
- **`tack/`**: the Rust server (axum + `yrs`). One actor per open board relays edits and presence,
  enforces roles and limits, and saves to Postgres.

```
Browser (Next.js + Konva + Yjs) ──WebSocket /ws/boards/:id──▶ tack :8080 ──▶ Postgres
                                ──REST /api────────────────▶
```

`HANDOFF.md` has the design, the decisions behind it and what's left to do.

## What it does

- Shapes, lines and arrows that stay attached, freehand, text with markdown, sticky notes,
  images, frames, database tables and architecture component cards
- Diagrams from code: DBML, and Mermaid flowcharts, ER, class, sequence and state diagrams
- Groups, align, auto-arrange, snapping, templates, undo/redo, export as PNG, SVG or PDF
- Share links with edit and view roles; optional accounts with two-factor sign-in
- An admin interface: live rooms, users, boards, audit logs, settings and system health

## Running it locally

You need Rust (stable), Node.js 20+, pnpm and Docker.

```bash
# Postgres, on localhost:5434
cd tack && docker compose up -d postgres

# The server, on :8080. Migrations run at startup.
cargo run

# The web app, on :3000
cd ../tack-web
cp .env.example .env.local
pnpm install
pnpm dev
```

Open http://localhost:3000 and start a board.

### Configuration

The server reads these from the environment, or from a `.env` file in the repo root:

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | `postgres://tack:tack@localhost:5434/tack` | |
| `TACK_ADDR` | `0.0.0.0:8080` | |
| `TACK_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:3001` | Default for the admin setting; origins allowed to open a WebSocket or call the API |
| `TACK_APP_URL` | `http://localhost:3001` | Base URL of the web app, for links in emails |
| `TACK_MAX_BOARD_BYTES` | 20 MB | Default for the admin setting |
| `TACK_ADMIN_EMAIL`, `TACK_ADMIN_PASSWORD` | | Creates the first superadmin at startup if there's none |
| `TACK_SMTP_URL` | | e.g. `smtps://user:pass@smtp.example.com`. Without it, emails go to the log |
| `TACK_MAIL_FROM` | `Tack <tack@localhost>` | Sender of every email |
| `TACK_TRUST_PROXY` | off | Read client IPs from `X-Forwarded-For`; only behind a proxy that sets it |
| `TACK_STORAGE_QUOTA_BYTES` | | Storage budget shown on the admin health page |

The web app needs `NEXT_PUBLIC_TACK_WS_URL` and `NEXT_PUBLIC_TACK_API_URL` (see
`tack-web/.env.example`).

## Tests

```bash
cd tack && cargo test         # uses the dev Postgres when it's up, skips those tests otherwise
cd tack-web && pnpm test      # Vitest
cd tack-web && pnpm typecheck && pnpm lint
```

Smoke checks against a running server: `pnpm smoke:sync`, `smoke:solo`, `smoke:full`,
`smoke:presence` and `smoke:ping` (set `TACK_WS_URL` / `TACK_API_URL` for another port).
