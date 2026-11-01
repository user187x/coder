//! Write-budget boundaries, partial writes, and underlying I/O failures.

use coder_core::limited_writer::{LimitReached, LimitedWriter};
use std::io::{self, Write};

#[test]
fn oversized_writes_leave_the_destination_and_budget_unchanged() {
    let mut writer = LimitedWriter::new(Vec::new(), 4);
    writer.write_all(b"ab").unwrap();
    let err = writer.write(b"cde").unwrap_err();
    assert!(err.get_ref().unwrap().is::<LimitReached>());
    assert_eq!(writer.get_ref(), b"ab");
    assert_eq!(writer.remaining(), 2);
    writer.write_all(b"cd").unwrap();
    assert_eq!(writer.written(), 4);
    assert!(writer.write(b"e").is_err());
    assert!(writer.write(b"").is_err());
    assert_eq!(writer.into_inner(), b"abcd");
}

#[test]
fn negative_and_zero_limits_reject_every_write() {
    for limit in [-1, 0] {
        let mut writer = LimitedWriter::new(Vec::new(), limit);
        assert!(writer.write(b"a").is_err());
        assert!(writer.write(b"").is_err());
        assert_eq!(writer.remaining(), 0);
        assert!(writer.into_inner().is_empty());
    }
}

#[derive(Default)]
struct ShortWriter {
    bytes: Vec<u8>,
    fail: bool,
}

impl Write for ShortWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.fail {
            return Err(io::ErrorKind::BrokenPipe.into());
        }
        let n = buf.len().min(1);
        self.bytes.extend_from_slice(&buf[..n]);
        self.fail = true;
        Ok(n)
    }
    fn flush(&mut self) -> io::Result<()> {
        Err(io::ErrorKind::PermissionDenied.into())
    }
}

#[test]
fn short_writes_and_io_errors_preserve_actual_byte_count() {
    let mut writer = LimitedWriter::new(ShortWriter::default(), 4);
    assert_eq!(writer.write(b"abcd").unwrap(), 1);
    assert_eq!(
        writer.write(b"bcd").unwrap_err().kind(),
        io::ErrorKind::BrokenPipe
    );
    assert_eq!(writer.written(), 1);
    assert_eq!(writer.remaining(), 3);
    assert_eq!(
        writer.flush().unwrap_err().kind(),
        io::ErrorKind::PermissionDenied
    );
    assert_eq!(writer.into_inner().bytes, b"a");
}

#[test]
fn empty_write_before_exhaustion_uses_no_budget() {
    let mut writer = LimitedWriter::new(Vec::new(), 1);
    assert_eq!(writer.write(b"").unwrap(), 0);
    assert_eq!(writer.remaining(), 1);
}
