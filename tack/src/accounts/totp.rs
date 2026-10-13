//! Codes from an authenticator app: TOTP (RFC 6238) with the settings every app assumes —
//! HMAC-SHA1, 6 digits, 30-second steps — plus single-use recovery codes for a lost phone.

use chrono::Utc;
use hmac::{Hmac, KeyInit, Mac};
use rand::{Rng, RngCore};
use sha1::Sha1;

const STEP_SECONDS: i64 = 30;
const DIGITS: u32 = 6;
/// Codes from one step either side are accepted too, for phones whose clock drifts.
const SKEW_STEPS: i64 = 1;
/// Recovery codes handed out at a time.
pub const RECOVERY_CODES: usize = 10;
/// No 0/o or 1/l/i, so a code copied from paper reads back the same.
const RECOVERY_ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";

/// A new 160-bit secret, the size RFC 4226 recommends.
pub fn new_secret() -> Vec<u8> {
    let mut secret = vec![0u8; 20];
    rand::rng().fill_bytes(&mut secret);
    secret
}

/// The secret as people type it into an app that can't scan: base32, no padding.
pub fn encode_secret(secret: &[u8]) -> String {
    data_encoding::BASE32_NOPAD.encode(secret)
}

/// The `otpauth://` URI authenticator apps read from the QR code.
pub fn otpauth_uri(issuer: &str, account: &str, secret: &[u8]) -> String {
    format!(
        "otpauth://totp/{}:{}?secret={}&issuer={}&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}",
        percent_encode(issuer),
        percent_encode(account),
        encode_secret(secret),
        percent_encode(issuer),
    )
}

/// The QR code for `data`, as an SVG document.
pub fn qr_svg(data: &str) -> String {
    match qrcode::QrCode::new(data.as_bytes()) {
        Ok(code) => code.render::<qrcode::render::svg::Color>().min_dimensions(200, 200).build(),
        Err(err) => {
            tracing::error!(%err, "couldn't make a QR code");
            String::new()
        }
    }
}

fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn code_at(secret: &[u8], step: i64) -> u32 {
    let mut mac = Hmac::<Sha1>::new_from_slice(secret).expect("HMAC takes keys of any length");
    mac.update(&step.to_be_bytes());
    let hash = mac.finalize().into_bytes();
    // Dynamic truncation (RFC 4226 §5.3).
    let offset = usize::from(hash[hash.len() - 1] & 0x0f);
    let bin = u32::from_be_bytes([hash[offset], hash[offset + 1], hash[offset + 2], hash[offset + 3]])
        & 0x7fff_ffff;
    bin % 10u32.pow(DIGITS)
}

/// Whether `code` is a TOTP code's shape: six digits, ignoring spaces.
pub fn looks_like_code(code: &str) -> bool {
    let digits: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    digits.len() == DIGITS as usize && digits.bytes().all(|b| b.is_ascii_digit())
}

/// The time step `code` belongs to if it's valid now. Steps up to `last_step` were already used,
/// so a code seen once (even by someone looking over a shoulder) can't be replayed.
pub fn verify(secret: &[u8], code: &str, last_step: Option<i64>) -> Option<i64> {
    verify_at(secret, code, last_step, Utc::now().timestamp())
}

fn verify_at(secret: &[u8], code: &str, last_step: Option<i64>, now: i64) -> Option<i64> {
    if !looks_like_code(code) {
        return None;
    }
    let code: u32 = code.chars().filter(|c| !c.is_whitespace()).collect::<String>().parse().ok()?;
    let current = now.div_euclid(STEP_SECONDS);
    (current - SKEW_STEPS..=current + SKEW_STEPS)
        .filter(|&step| last_step.is_none_or(|last| step > last))
        .find(|&step| code_at(secret, step) == code)
}

/// A recovery code like `k7pqx-m3dre`.
pub fn new_recovery_code() -> String {
    let mut rng = rand::rng();
    let mut code: String =
        (0..10).map(|_| RECOVERY_ALPHABET[rng.random_range(0..RECOVERY_ALPHABET.len())] as char).collect();
    code.insert(5, '-');
    code
}

/// A recovery code as stored (hashed): lowercase, without the dash or spaces people add.
pub fn normalize_recovery_code(code: &str) -> String {
    code.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 6238 appendix B, SHA-1, last six digits.
    #[test]
    fn matches_the_rfc_test_vectors() {
        let secret = b"12345678901234567890";
        for (time, code) in [(59, 287082), (1111111109, 81804), (1234567890, 5924), (2000000000, 279037)] {
            assert_eq!(code_at(secret, time / STEP_SECONDS), code, "at {time}");
        }
    }

    #[test]
    fn accepts_adjacent_steps_once() {
        let secret = b"12345678901234567890";
        let now = 1111111109;
        let code = format!("{:06}", code_at(secret, now / STEP_SECONDS - 1));
        let step = verify_at(secret, &code, None, now).expect("previous step is accepted");
        assert_eq!(verify_at(secret, &code, Some(step), now), None, "not twice");
        assert_eq!(verify_at(secret, &code, None, now + 3 * STEP_SECONDS), None, "not long after");
        assert_eq!(verify_at(secret, "12345", None, now), None);
        assert_eq!(verify_at(secret, "abcdef", None, now), None);
    }

    #[test]
    fn recovery_codes_normalize() {
        let code = new_recovery_code();
        assert_eq!(code.len(), 11);
        assert_eq!(normalize_recovery_code(&code.to_uppercase().replace('-', " - ")), code.replace('-', ""));
    }
}
