//! Small shapes shared by several endpoints.

use serde::Serialize;

/// A select or filter option. Matches `Option` in the web client.
#[derive(Debug, Serialize)]
pub struct SelectOption {
    pub label: String,
    pub value: String,
}

/// Serializes a number as a string, for ids the web client types as `string`.
pub fn as_string<S: serde::Serializer, T: std::fmt::Display>(value: &T, s: S) -> Result<S::Ok, S::Error> {
    s.collect_str(value)
}
