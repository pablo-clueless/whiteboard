//! Outgoing email over plain SMTP (`lettre`), so any mail server works and nothing has to be paid
//! for. Configure it with `TACK_SMTP_URL` and `TACK_MAIL_FROM`.
//!
//! Without SMTP, messages are written to the log instead. Debug builds include the body, which
//! holds the one-time link; release builds leave it out, since the log must never carry a working
//! token.

use anyhow::Context;
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor, message::Mailbox,
    message::header::ContentType,
};

#[derive(Clone)]
pub struct Mailer {
    transport: Option<(AsyncSmtpTransport<Tokio1Executor>, Mailbox)>,
}

impl Mailer {
    /// `smtp_url` is lettre's URL form, e.g. `smtps://user:pass@smtp.example.com` (implicit TLS,
    /// port 465), `smtp://user:pass@smtp.example.com:587?tls=required` (STARTTLS), or
    /// `smtp://localhost:1025` (plain, for a local catcher such as Mailpit).
    pub fn new(smtp_url: Option<&str>, from: &str) -> anyhow::Result<Self> {
        let Some(url) = smtp_url else {
            tracing::warn!("TACK_SMTP_URL isn't set: emails go to the log, not to people");
            return Ok(Self { transport: None });
        };
        let transport = AsyncSmtpTransport::<Tokio1Executor>::from_url(url)
            .context("TACK_SMTP_URL isn't a valid SMTP URL")?
            .build();
        let from = from
            .parse()
            .context("TACK_MAIL_FROM must be an address, e.g. Tack <tack@example.com>")?;
        Ok(Self {
            transport: Some((transport, from)),
        })
    }

    /// Sends a plain-text email in the background, so the request that asked for it doesn't wait
    /// on the mail server. Failures are logged.
    pub fn send(&self, to: &str, subject: &str, body: &str) {
        let Some((transport, from)) = &self.transport else {
            if cfg!(debug_assertions) {
                tracing::info!(to, subject, body, "email (no mail transport configured)");
            } else {
                tracing::warn!(to, subject, "email not sent: no mail transport configured");
            }
            return;
        };
        let message = to
            .parse::<Mailbox>()
            .map_err(anyhow::Error::from)
            .and_then(|to| {
                Message::builder()
                    .from(from.clone())
                    .to(to)
                    .subject(subject)
                    .header(ContentType::TEXT_PLAIN)
                    .body(body.to_owned())
                    .map_err(anyhow::Error::from)
            });
        let message = match message {
            Ok(message) => message,
            Err(err) => {
                tracing::warn!(to, subject, %err, "email not sent: couldn't build the message");
                return;
            }
        };
        let transport = transport.clone();
        let (to, subject) = (to.to_owned(), subject.to_owned());
        tokio::spawn(async move {
            match transport.send(message).await {
                Ok(_) => tracing::info!(to, subject, "email sent"),
                Err(err) => tracing::warn!(to, subject, %err, "email not sent"),
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reads_smtp_settings() {
        assert!(Mailer::new(None, "not an address").unwrap().transport.is_none());
        assert!(Mailer::new(Some("smtp://localhost:1025"), "Tack <tack@example.com>").unwrap().transport.is_some());
        assert!(Mailer::new(Some("smtps://user:pass@smtp.example.com"), "tack@example.com").is_ok());
        assert!(Mailer::new(Some("http://example.com"), "tack@example.com").is_err());
        assert!(Mailer::new(Some("smtp://localhost:1025"), "not an address").is_err());
    }
}
