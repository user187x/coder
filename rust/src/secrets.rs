//! User secret request validation, ported from `codersdk/usersecretvalidation.go`.
//!
//! Database aggregate limits still require enforcement by the existing SQL trigger.

use crate::InvalidInput;

/// Maximum secrets per user, enforced by the database.
pub const MAX_USER_SECRETS_PER_USER_COUNT: usize = 50;
/// Maximum aggregate stored secret bytes, enforced by the database.
pub const MAX_USER_SECRETS_TOTAL_VALUE_BYTES: usize = 200 * 1024;
/// Maximum plaintext value bytes and database stored environment aggregate budget.
pub const MAX_USER_SECRET_VALUE_BYTES: usize = 24 * 1024;
/// Maximum environment variable name bytes.
pub const MAX_USER_SECRET_ENV_NAME_LENGTH: usize = 256;

/// Validation message for an enabled secret without an injection destination.
pub const INJECTION_TARGET_REQUIRED: &str = "An enabled secret must have at least one of env_name or file_path set. To keep a secret without injecting it, set enabled to false instead of clearing both targets.";

const RESERVED_NAMES: &[&str] = &[
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
const RESERVED_PREFIXES: &[&str] = &["GIT_", "LC_", "LD_", "DYLD_"];

/// Inputs for creating a user secret. Absent `enabled` defaults to true.
///
/// Deliberately does not implement `Debug`, so debug logs cannot expose values.
#[derive(Default)]
pub struct CreateSecretRequest<'a> {
    /// Name used in API route path segments.
    pub name: &'a str,
    /// Plaintext secret value.
    pub value: &'a str,
    /// Environment injection destination; empty disables this destination.
    pub env_name: &'a str,
    /// File injection destination; empty disables this destination.
    pub file_path: &'a str,
    /// Whether to inject this secret into workspaces.
    pub enabled: Option<bool>,
}

/// A field-specific request validation failure, without the submitted value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    /// API field name.
    pub field: &'static str,
    /// User-facing explanation.
    pub detail: String,
}

/// Collects all field errors in the same order as the Go request validator.
pub fn validate_create(req: &CreateSecretRequest<'_>) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    let value = if req.value.is_empty() {
        Err(InvalidInput::new("Value is required."))
    } else {
        validate_value(req.value)
    };
    for (field, result) in [
        ("name", validate_name(req.name)),
        ("value", value),
        ("env_name", validate_env_name(req.env_name)),
        ("file_path", validate_file_path(req.file_path)),
    ] {
        if let Err(error) = result {
            errors.push(ValidationError {
                field,
                detail: error.to_string(),
            });
        }
    }
    if req.env_name.is_empty() && req.file_path.is_empty() && req.enabled.unwrap_or(true) {
        errors.push(ValidationError {
            field: "env_name",
            detail: INJECTION_TARGET_REQUIRED.into(),
        });
    }
    errors
}

/// Requires a nonblank, unpadded name without API route separators.
pub fn validate_name(name: &str) -> Result<(), InvalidInput> {
    if name.trim().is_empty() {
        return Err(InvalidInput::new("Name is required."));
    }
    if name.trim() != name {
        return Err(InvalidInput::new(
            "Name must not have leading or trailing whitespace.",
        ));
    }
    if name.contains(['/', '?', '#']) {
        return Err(InvalidInput::new("Name must not contain /, ?, or #."));
    }
    Ok(())
}

/// Validates POSIX syntax and rejects reserved agent and system variables.
pub fn validate_env_name(name: &str) -> Result<(), InvalidInput> {
    if name.is_empty() {
        return Ok(());
    }
    if name.len() > MAX_USER_SECRET_ENV_NAME_LENGTH {
        return Err(InvalidInput::new(format!(
            "environment variable name must not exceed {MAX_USER_SECRET_ENV_NAME_LENGTH} bytes"
        )));
    }
    let mut bytes = name.bytes();
    let first = bytes.next().expect("nonempty name");
    if !(first.is_ascii_alphabetic() || first == b'_')
        || !bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Err(InvalidInput::new(
            "must start with a letter or underscore, followed by letters, digits, or underscores",
        ));
    }
    let upper = name.to_ascii_uppercase();
    if RESERVED_NAMES.contains(&upper.as_str()) {
        return Err(InvalidInput::new(format!(
            "{upper} is a reserved environment variable name"
        )));
    }
    if upper == "CODER" || upper.starts_with("CODER_") {
        return Err(InvalidInput::new(
            "environment variable names starting with CODER_ are reserved for internal use",
        ));
    }
    for prefix in RESERVED_PREFIXES {
        if upper.starts_with(prefix) {
            return Err(InvalidInput::new(format!(
                "environment variables starting with {prefix} are reserved"
            )));
        }
    }
    Ok(())
}

/// Accepts empty, absolute, or home-relative paths up to 4096 bytes without NUL.
pub fn validate_file_path(path: &str) -> Result<(), InvalidInput> {
    if path.is_empty() {
        return Ok(());
    }
    if !path.starts_with("~/") && !path.starts_with('/') {
        return Err(InvalidInput::new("file path must start with ~/ or /"));
    }
    if path.contains('\0') {
        return Err(InvalidInput::new("file path must not contain null bytes"));
    }
    if path.len() > 4096 {
        return Err(InvalidInput::new("file path must not exceed 4096 bytes"));
    }
    Ok(())
}

/// Validates plaintext byte length and rejects NUL bytes without echoing the value.
pub fn validate_value(value: &str) -> Result<(), InvalidInput> {
    if value.contains('\0') {
        return Err(InvalidInput::new(
            "secret value must not contain null bytes",
        ));
    }
    if value.len() > MAX_USER_SECRET_VALUE_BYTES {
        return Err(InvalidInput::new(format!(
            "secret value must not exceed {MAX_USER_SECRET_VALUE_BYTES} bytes"
        )));
    }
    Ok(())
}
