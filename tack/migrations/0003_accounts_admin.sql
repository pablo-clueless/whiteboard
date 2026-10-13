-- Accounts, sessions, analytics, audit log and runtime settings for the admin interface.

CREATE TABLE users (
    id                uuid        PRIMARY KEY,
    name              text        NOT NULL,
    -- Stored lowercased; compared lowercased.
    email             text        NOT NULL UNIQUE,
    password_hash     text        NOT NULL,
    status            text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('active', 'deleted', 'inactive', 'pending', 'suspended')),
    type              text        NOT NULL DEFAULT 'client' CHECK (type IN ('superadmin', 'client')),
    role              text        NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'owner', 'viewer')),
    permissions       text[]      NOT NULL DEFAULT '{}',
    email_verified_at timestamptz,
    failed_logins     integer     NOT NULL DEFAULT 0,
    locked_until      timestamptz,
    -- From the latest sign-in.
    last_ip           text,
    last_browser      text,
    last_locale       text,
    last_seen_at      timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz
);
CREATE INDEX users_created_at ON users (created_at);

-- Signed-in sessions. Only the SHA-256 of each bearer token is stored, like share tokens.
CREATE TABLE user_sessions (
    id           uuid        PRIMARY KEY,
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash   bytea       NOT NULL UNIQUE,
    ip           text,
    browser      text,
    device       text,
    locale       text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);
CREATE INDEX user_sessions_user_id ON user_sessions (user_id);

-- One-time tokens for email verification and password resets, hashed.
CREATE TABLE auth_tokens (
    token_hash bytea       PRIMARY KEY,
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind       text        NOT NULL CHECK (kind IN ('verify_email', 'reset_password')),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_id ON auth_tokens (user_id);

ALTER TABLE boards
    ADD COLUMN owner_id    uuid REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN archived_at timestamptz;
CREATE INDEX boards_owner_id ON boards (owner_id);

-- Lets admins revoke one link without exposing it: links are listed by hash.
ALTER TABLE share_tokens ADD COLUMN created_by uuid REFERENCES users (id) ON DELETE SET NULL;

-- One row per WebSocket connection, for usage analytics. `visitor_id` is a salted hash of the
-- user id when signed in, or of IP + user agent otherwise; raw IPs aren't kept here.
CREATE TABLE connections (
    id         bigserial   PRIMARY KEY,
    board_id   uuid        NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
    user_id    uuid        REFERENCES users (id) ON DELETE SET NULL,
    visitor_id bytea       NOT NULL,
    role       text        NOT NULL,
    browser    text        NOT NULL,
    device     text        NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at   timestamptz
);
CREATE INDEX connections_started_at ON connections (started_at);
CREATE INDEX connections_visitor_id ON connections (visitor_id, started_at);
CREATE INDEX connections_board_id ON connections (board_id);

CREATE TABLE audit_logs (
    id         bigserial   PRIMARY KEY,
    actor_id   uuid        REFERENCES users (id) ON DELETE SET NULL,
    -- Who did it, as shown in the log: an email, "anonymous" or "system". Kept after the user goes.
    actor      text        NOT NULL,
    action     text        NOT NULL,
    resource   text        NOT NULL,
    metadata   jsonb       NOT NULL DEFAULT '{}',
    ip         text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_at ON audit_logs (created_at);
CREATE INDEX audit_logs_action ON audit_logs (action);

-- Runtime settings, one JSON document per section, edited from the admin interface.
CREATE TABLE settings (
    key        text        PRIMARY KEY,
    value      jsonb       NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feature_flags (
    id          text        PRIMARY KEY,
    name        text        NOT NULL,
    description text,
    enabled     boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz
);
