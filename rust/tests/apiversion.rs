//! Compatibility checks for Go protocol version negotiation.

use coder_core::apiversion::{self, ApiVersion};

#[test]
fn protocol_negotiation_preserves_go_errors() {
    let server = ApiVersion::new(2, 1).with_backward_compat([1]);
    for version in ["2.1", "2.0", "1.0", "1.9999", "+2.01", "2.-1"] {
        assert!(server.validate(version).is_ok(), "{version}");
    }
    for (version, expected) in [
        (
            "2.2",
            "server is at version 2.1, behind requested minor version 2.2",
        ),
        (
            "3.1",
            "server is at version 2.1, behind requested major version 3.1",
        ),
        ("cats", "invalid version string: cats"),
        ("cats.dogs", "invalid major version: cats.dogs"),
        ("1.dogs", "invalid minor version: 1.dogs"),
        ("1.0.1", "invalid version string: 1.0.1"),
        ("11", "invalid version string: 11"),
        ("0.8", "version 0.8 is no longer supported"),
    ] {
        assert_eq!(server.validate(version).unwrap_err().to_string(), expected);
    }
    assert_eq!(server.to_string(), "2.1");
}

#[test]
fn parser_handles_integer_boundaries_and_rejects_nondecimal_inputs() {
    assert_eq!(
        apiversion::parse("-9223372036854775808.9223372036854775807").unwrap(),
        (i64::MIN, i64::MAX)
    );
    for input in [
        "9223372036854775808.0",
        "-9223372036854775809.0",
        "0.9223372036854775808",
        " 1.0",
        "1.0 ",
        "1_0.0",
        "0x10.0",
        ".0",
        "0.",
        "1.２",
        "",
        ".",
        "..",
    ] {
        assert!(apiversion::parse(input).is_err(), "{input}");
    }
}

#[test]
fn additional_majors_never_override_current_or_newer_checks() {
    let server = ApiVersion::new(2, 1).with_backward_compat([1, 2, 3]);
    assert!(server.validate("2.2").is_err());
    assert!(server.validate("3.0").is_err());
    assert!(ApiVersion::new(2, 1).validate("1.0").is_err());
}
