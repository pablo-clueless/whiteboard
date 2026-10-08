-- Uploaded images, content-addressed by the SHA-256 of their bytes, so the same image uploaded
-- twice is stored once. Kept in Postgres to avoid paying for object storage.
CREATE TABLE assets (
    id         bytea       PRIMARY KEY,
    board_id   uuid        NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
    mime       text        NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
    size       integer     NOT NULL,
    bytes      bytea       NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_board_id ON assets (board_id);
