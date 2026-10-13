-- Board read-only lock, and two-factor sign-in.

-- Set by an editor with the editor's read-only switch: nobody can edit until an editor unlocks it.
-- Only honoured while the board setting `readOnlySwitch` is on.
ALTER TABLE boards ADD COLUMN locked_at timestamptz;

-- TOTP (RFC 6238). `totp_secret` is set when someone starts setting it up and only counts once
-- `totp_enabled_at` is set, after they've entered a code from it. `totp_last_step` is the time
-- step of the last code accepted, so a code can't be used twice.
ALTER TABLE users
    ADD COLUMN totp_secret     bytea,
    ADD COLUMN totp_enabled_at timestamptz,
    ADD COLUMN totp_last_step  bigint;

-- Single-use codes for signing in without the authenticator, hashed.
CREATE TABLE recovery_codes (
    user_id   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_hash bytea       NOT NULL,
    used_at   timestamptz,
    PRIMARY KEY (user_id, code_hash)
);

-- The step between a correct password and the authenticator code.
ALTER TABLE auth_tokens DROP CONSTRAINT auth_tokens_kind_check;
ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_kind_check
    CHECK (kind IN ('verify_email', 'reset_password', 'two_factor'));
