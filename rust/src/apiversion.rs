//! Major/minor protocol negotiation, ported from `apiversion/apiversion.go`.

use crate::InvalidInput;
use std::fmt;

/// The server's current protocol version and explicitly supported older majors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiVersion {
    major: i64,
    minor: i64,
    additional_majors: Vec<i64>,
}

impl ApiVersion {
    /// Creates a protocol version without backward compatibility enabled.
    pub fn new(major: i64, minor: i64) -> Self {
        Self {
            major,
            minor,
            additional_majors: Vec::new(),
        }
    }

    /// Adds supported older major versions. Their minor version is unrestricted.
    pub fn with_backward_compat(mut self, majors: impl IntoIterator<Item = i64>) -> Self {
        self.additional_majors.extend(majors);
        self
    }

    /// Checks whether this server supports a requested `major.minor` version.
    pub fn validate(&self, version: &str) -> Result<(), InvalidInput> {
        let (major, minor) = parse(version)?;
        if major > self.major {
            return Err(InvalidInput::new(format!(
                "server is at version {self}, behind requested major version {version}"
            )));
        }
        if major == self.major {
            if minor > self.minor {
                return Err(InvalidInput::new(format!(
                    "server is at version {self}, behind requested minor version {version}"
                )));
            }
            return Ok(());
        }
        if self.additional_majors.contains(&major) {
            return Ok(());
        }
        Err(InvalidInput::new(format!(
            "version {version} is no longer supported"
        )))
    }
}

impl fmt::Display for ApiVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}", self.major, self.minor)
    }
}

/// Parses exactly two signed, decimal 64-bit integers separated by a period.
///
/// Signed components are retained for compatibility with Go's `strconv.Atoi`.
pub fn parse(version: &str) -> Result<(i64, i64), InvalidInput> {
    let mut parts = version.split('.');
    let major = parts.next().unwrap_or_default();
    let Some(minor) = parts.next() else {
        return Err(InvalidInput::new(format!(
            "invalid version string: {version}"
        )));
    };
    if parts.next().is_some() {
        return Err(InvalidInput::new(format!(
            "invalid version string: {version}"
        )));
    }
    let major = major
        .parse()
        .map_err(|_| InvalidInput::new(format!("invalid major version: {version}")))?;
    let minor = minor
        .parse()
        .map_err(|_| InvalidInput::new(format!("invalid minor version: {version}")))?;
    Ok((major, minor))
}
