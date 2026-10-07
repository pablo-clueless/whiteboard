CREATE TABLE boards (
    id             uuid PRIMARY KEY,
    title          text        NOT NULL DEFAULT '',
    schema_version integer     NOT NULL DEFAULT 1,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Share links. Only the SHA-256 of each token is stored; the token itself is shown once.
CREATE TABLE share_tokens (
    token_hash bytea       PRIMARY KEY,
    board_id   uuid        NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
    role       text        NOT NULL CHECK (role IN ('edit', 'view')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX share_tokens_board_id ON share_tokens (board_id);

-- Yjs updates appended since the last snapshot. Compaction folds them into board_snapshots.
CREATE TABLE board_updates (
    board_id   uuid        NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
    seq        bigserial,
    update     bytea       NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (board_id, seq)
);

-- Full encoded doc state covering every update with seq <= upto_seq.
CREATE TABLE board_snapshots (
    board_id   uuid        PRIMARY KEY REFERENCES boards (id) ON DELETE CASCADE,
    state      bytea       NOT NULL,
    upto_seq   bigint      NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
