//! Shared Coder logic ported from the Go implementation.
//!
//! This crate does not yet provide a Coder server, CLI, or workspace agent.

pub mod apiversion;
pub mod limited_writer;
pub mod secrets;
pub mod wsrelated;

use std::fmt;

/// A human-readable protocol validation failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidInput(String);

impl InvalidInput {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for InvalidInput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for InvalidInput {}
