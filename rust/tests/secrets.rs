//! Secret validation boundaries and injection-target invariants.

use coder_core::secrets::{self, CreateSecretRequest, MAX_USER_SECRET_VALUE_BYTES};

#[test]
fn secret_names_preserve_route_and_whitespace_rules() {
    for name in ["my-key", "API_KEY", "contains spaces", "成龍"] {
        assert!(secrets::validate_name(name).is_ok(), "{name}");
    }
    for (name, expected) in [
        ("", "Name is required."),
        (" \t\n", "Name is required."),
        (" key", "Name must not have leading or trailing whitespace."),
        (
            "key\u{00a0}",
            "Name must not have leading or trailing whitespace.",
        ),
        ("key/name", "Name must not contain /, ?, or #."),
        ("key?name", "Name must not contain /, ?, or #."),
        ("key#name", "Name must not contain /, ?, or #."),
    ] {
        assert_eq!(
            secrets::validate_name(name).unwrap_err().to_string(),
            expected
        );
    }
}

#[test]
fn environment_names_reject_every_reserved_namespace_case_insensitively() {
    let names = [
        "PATH",
        "HOME",
        "SHELL",
        "USER",
        "LOGNAME",
        "PWD",
        "OLDPWD",
        "LANG",
        "TERM",
        "IFS",
        "CDPATH",
        "ENV",
        "BASH_ENV",
        "TMPDIR",
        "TMP",
        "TEMP",
        "HOSTNAME",
        "SSH_AUTH_SOCK",
        "SSH_CLIENT",
        "SSH_CONNECTION",
        "SSH_TTY",
        "EDITOR",
        "VISUAL",
        "PAGER",
        "VSCODE_PROXY_URI",
        "CS_DISABLE_GETTING_STARTED_OVERRIDE",
        "XDG_RUNTIME_DIR",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_CACHE_HOME",
        "XDG_STATE_HOME",
    ];
    for name in names {
        for candidate in [name.to_string(), name.to_lowercase()] {
            assert_eq!(
                secrets::validate_env_name(&candidate)
                    .unwrap_err()
                    .to_string(),
                format!("{name} is a reserved environment variable name")
            );
        }
    }
    for prefix in ["CODER", "CODER_", "GIT_", "LC_", "LD_", "DYLD_"] {
        let name = if prefix == "CODER" {
            prefix.to_string()
        } else {
            format!("{prefix}CUSTOM")
        };
        assert!(secrets::validate_env_name(&name).is_err(), "{name}");
        assert!(
            secrets::validate_env_name(&name.to_lowercase()).is_err(),
            "{name}"
        );
    }
    for name in [
        "", "TOKEN", "my_token", "_KEY", "KEY123", "CODERX", "GIT", "DYLD",
    ] {
        assert!(secrets::validate_env_name(name).is_ok(), "{name}");
    }
    for name in [
        "9TOKEN",
        "API-KEY",
        "API KEY",
        "KEY=VALUE",
        "éKEY",
        "TOKEN\0",
        "\n",
    ] {
        assert!(secrets::validate_env_name(name).is_err(), "{name}");
    }
    assert!(secrets::validate_env_name(&"A".repeat(256)).is_ok());
    assert!(secrets::validate_env_name(&"A".repeat(257)).is_err());
}

#[test]
fn path_validation_preserves_existing_syntax_and_byte_boundaries() {
    for path in ["", "~/foo", "~/.ssh/id_rsa", "/home/coder/.ssh/id_rsa", "/"] {
        assert!(secrets::validate_file_path(path).is_ok(), "{path}");
    }
    for path in [
        "foo/bar",
        ".ssh/id_rsa",
        "credentials",
        "~foo",
        "/home/\0coder",
    ] {
        assert!(secrets::validate_file_path(path).is_err(), "{path}");
    }
    assert!(secrets::validate_file_path(&format!("/{}", "a".repeat(4095))).is_ok());
    assert!(secrets::validate_file_path(&format!("/{}", "a".repeat(4096))).is_err());
    assert!(secrets::validate_file_path(&format!("/{}", "é".repeat(2048))).is_err());
}

#[test]
fn values_use_byte_limits_without_exposing_credentials_in_errors() {
    for value in ["", "my-secret-token", "line1\nline2\nline3", "key\tvalue"] {
        assert!(secrets::validate_value(value).is_ok());
    }
    assert!(secrets::validate_value(&"a".repeat(MAX_USER_SECRET_VALUE_BYTES)).is_ok());
    assert!(secrets::validate_value(&"é".repeat(MAX_USER_SECRET_VALUE_BYTES / 2)).is_ok());
    let too_large = "a".repeat(MAX_USER_SECRET_VALUE_BYTES + 1);
    assert_eq!(
        secrets::validate_value(&too_large).unwrap_err().to_string(),
        "secret value must not exceed 24576 bytes"
    );
    let value = "sensitive-value\0suffix";
    let error = secrets::validate_value(value).unwrap_err().to_string();
    assert_eq!(error, "secret value must not contain null bytes");
    assert!(!error.contains("sensitive-value"));
}

#[test]
fn create_validation_returns_all_errors_in_api_field_order() {
    let req = CreateSecretRequest {
        name: "bad/name",
        value: "",
        env_name: "HOME",
        file_path: "relative",
        enabled: None,
    };
    let errors = secrets::validate_create(&req);
    assert_eq!(
        errors.iter().map(|e| e.field).collect::<Vec<_>>(),
        ["name", "value", "env_name", "file_path"]
    );
    assert_eq!(errors[1].detail, "Value is required.");
}

#[test]
fn enabled_secrets_need_a_target_and_disabled_secrets_may_omit_it() {
    for enabled in [None, Some(true), Some(false)] {
        let mut req = CreateSecretRequest {
            name: "token",
            value: "secret",
            enabled,
            ..Default::default()
        };
        let errors = secrets::validate_create(&req);
        if enabled == Some(false) {
            assert!(errors.is_empty());
        } else {
            assert_eq!(errors.len(), 1);
            assert_eq!(errors[0].field, "env_name");
            assert_eq!(errors[0].detail, secrets::INJECTION_TARGET_REQUIRED);
        }
        req.env_name = "API_KEY";
        assert!(secrets::validate_create(&req).is_empty());
        req.env_name = "";
        req.file_path = "~/.credentials";
        assert!(secrets::validate_create(&req).is_empty());
    }
}
