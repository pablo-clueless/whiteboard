//! Argon2id password hashes. Hashing is deliberately slow, so it runs on the blocking pool.

use std::sync::OnceLock;

use argon2::{
    Argon2, PasswordHasher, PasswordVerifier,
    password_hash::{PasswordHash, SaltString},
};
use rand::RngCore;

use crate::{api::ApiError, settings::PasswordPolicy};

/// Longer inputs are refused before hashing.
const MAX_PASSWORD_CHARS: usize = 256;

pub async fn hash_password(password: String) -> Result<String, ApiError> {
    tokio::task::spawn_blocking(move || hash_now(&password))
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
}

fn hash_now(password: &str) -> Result<String, ApiError> {
    let mut salt = [0u8; 16];
    rand::rng().fill_bytes(&mut salt);
    let salt = SaltString::encode_b64(&salt).map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .to_string())
}

/// Checks a password against a stored hash. With no hash (unknown email) it checks against a
/// dummy, so a missing account takes as long to refuse as a wrong password.
pub async fn verify_password(password: String, hash: Option<String>) -> bool {
    tokio::task::spawn_blocking(move || {
        static DUMMY: OnceLock<String> = OnceLock::new();
        let real = hash.is_some();
        let hash =
            hash.unwrap_or_else(|| DUMMY.get_or_init(|| hash_now("dummy").unwrap_or_default()).clone());
        let ok = PasswordHash::new(&hash)
            .is_ok_and(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok());
        real && ok
    })
    .await
    .unwrap_or(false)
}

pub fn check_policy(password: &str, policy: PasswordPolicy) -> Result<(), ApiError> {
    let chars = password.chars().count();
    if chars > MAX_PASSWORD_CHARS {
        return Err(ApiError::BadRequest(format!(
            "passwords can be at most {MAX_PASSWORD_CHARS} characters"
        )));
    }
    let ok = match policy {
        PasswordPolicy::Basic => chars >= 8,
        PasswordPolicy::Strong => {
            chars >= 12
                && password.chars().any(|c| c.is_lowercase())
                && password.chars().any(|c| c.is_uppercase())
                && password.chars().any(|c| c.is_ascii_digit())
                && password.chars().any(|c| !c.is_alphanumeric())
        }
    };
    if ok {
        return Ok(());
    }
    Err(ApiError::BadRequest(match policy {
        PasswordPolicy::Basic => "passwords must be at least 8 characters".into(),
        PasswordPolicy::Strong => "passwords must be at least 12 characters, with upper and lower case \
                                   letters, a digit and a symbol"
            .into(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn hashes_verify_and_unknown_accounts_never_match() {
        let hash = hash_password("correct horse".into()).await.unwrap();
        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_password("correct horse".into(), Some(hash.clone())).await);
        assert!(!verify_password("wrong".into(), Some(hash)).await);
        assert!(!verify_password("dummy".into(), None).await);
    }

    #[test]
    fn policies() {
        assert!(check_policy("12345678", PasswordPolicy::Basic).is_ok());
        assert!(check_policy("1234567", PasswordPolicy::Basic).is_err());
        assert!(check_policy("abcdefghijkl", PasswordPolicy::Strong).is_err());
        assert!(check_policy("Abcdefghij1!", PasswordPolicy::Strong).is_ok());
    }
}
