-- Emails a user about changes to how they sign in: password, email, two-factor, and sign-ins from
-- a new address. On unless they turn it off in their settings.
ALTER TABLE users ADD COLUMN security_emails boolean NOT NULL DEFAULT true;
