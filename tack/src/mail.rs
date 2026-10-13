//! Outgoing email. There's no mail transport yet (it must be free: plain SMTP via `lettre` is the
//! likely choice), so messages are written to the log. Debug builds include the body, which holds
//! the one-time link; release builds leave it out, since the log must never carry a working token.

pub fn send(to: &str, subject: &str, body: &str) {
    if cfg!(debug_assertions) {
        tracing::info!(to, subject, body, "email (no mail transport configured)");
    } else {
        tracing::warn!(to, subject, "email not sent: no mail transport configured");
    }
}
