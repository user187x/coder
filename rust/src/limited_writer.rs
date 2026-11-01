//! A write budget, ported from `coderd/util/xio/limitwriter.go`.

use std::{
    fmt,
    io::{self, Write},
};

/// A write would exceed the configured byte budget.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LimitReached;

impl fmt::Display for LimitReached {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("i/o limit reached")
    }
}

impl std::error::Error for LimitReached {}

/// Rejects an entire write when its buffer would exceed the remaining budget.
///
/// An exhausted writer also rejects empty writes, matching the Go implementation.
#[derive(Debug)]
pub struct LimitedWriter<W> {
    inner: W,
    limit: u64,
    written: u64,
}

impl<W> LimitedWriter<W> {
    /// Wraps a writer; a negative limit is treated as zero.
    pub fn new(inner: W, limit: i64) -> Self {
        Self {
            inner,
            limit: limit.max(0) as u64,
            written: 0,
        }
    }

    /// Returns the number of bytes accepted by the underlying writer.
    pub fn written(&self) -> u64 {
        self.written
    }

    /// Returns the unused byte budget.
    pub fn remaining(&self) -> u64 {
        self.limit - self.written
    }

    /// Returns a shared reference to the underlying writer.
    pub fn get_ref(&self) -> &W {
        &self.inner
    }

    /// Consumes the budget wrapper and returns its writer.
    pub fn into_inner(self) -> W {
        self.inner
    }
}

impl<W: Write> Write for LimitedWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.remaining() == 0 || buf.len() as u64 > self.remaining() {
            return Err(io::Error::other(LimitReached));
        }
        let count = self.inner.write(buf)?;
        self.written += count as u64;
        Ok(count)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}
