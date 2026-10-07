//! Share tokens and roles.
//!
//! A token is 32 random bytes, base64url-encoded, handed out once. Only its SHA-256 is stored, so
//! a database leak doesn't leak working links. Lookups go by hash, so there's no secret to compare
//! in non-constant time. Never log a token.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Edit,
    View,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Edit => "edit",
            Self::View => "view",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "edit" => Some(Self::Edit),
            "view" => Some(Self::View),
            _ => None,
        }
    }
}

pub type TokenHash = [u8; 32];

/// A fresh token and the hash to store for it.
pub fn new_token() -> (String, TokenHash) {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    let token = URL_SAFE_NO_PAD.encode(bytes);
    let hash = hash_token(&token);
    (token, hash)
}

pub fn hash_token(token: &str) -> TokenHash {
    Sha256::digest(token.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_unique_urlsafe_and_hash_stably() {
        let (a, ha) = new_token();
        let (b, _) = new_token();
        assert_ne!(a, b);
        assert_eq!(a.len(), 43);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_eq!(hash_token(&a), ha);
    }
}
