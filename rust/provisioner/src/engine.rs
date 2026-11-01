//! Replaceable infrastructure engine selection. Builds never download executables.

use crate::{Error, terraform::private_directory};
use std::{
    env,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
};
include!(concat!(env!("OUT_DIR"), "/embedded.rs"));

/// A selected executable. Embedded bytes live in a private directory for this process.
pub struct Engine {
    pub(crate) binary: PathBuf,
    _directory: Option<tempfile::TempDir>,
}
impl Engine {
    /// Uses an explicit binary, then the embedded engine, then the selected PATH command.
    /// `CODER_IAC_ENGINE` is terraform (default) or opentofu. No engine is downloaded.
    pub fn from_environment() -> Result<Self, Error> {
        if let Some(path) =
            env::var_os("CODER_IAC_BINARY").or_else(|| env::var_os("CODER_TERRAFORM_BINARY"))
        {
            return Self::external(PathBuf::from(path));
        }
        let selected = env::var("CODER_IAC_ENGINE").ok();
        if let Some((kind, bytes)) = EMBEDDED {
            if selected
                .as_deref()
                .is_none_or(|selection| selection == kind)
            {
                return Self::embedded(kind, bytes);
            }
        }
        let binary = match selected.as_deref().unwrap_or("terraform") {
            "terraform" => "terraform",
            "opentofu" => "tofu",
            _ => {
                return Err(Error::Config(
                    "CODER_IAC_ENGINE must be terraform or opentofu.",
                ));
            }
        };
        Self::external(binary.into())
    }
    fn external(binary: PathBuf) -> Result<Self, Error> {
        let binary = if binary.components().count() > 1 {
            std::fs::canonicalize(binary)?
        } else {
            binary
        };
        Ok(Self {
            binary,
            _directory: None,
        })
    }
    fn embedded(kind: &str, bytes: &[u8]) -> Result<Self, Error> {
        let mut builder = tempfile::Builder::new();
        builder.prefix("coder-engine-");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            builder.permissions(std::fs::Permissions::from_mode(0o700));
        }
        let directory = builder.tempdir()?;
        private_directory(directory.path())?;
        let binary = directory.path().join(if kind == "opentofu" {
            "tofu"
        } else {
            "terraform"
        });
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o700);
        }
        let mut file = options.open(&binary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(Self {
            binary,
            _directory: Some(directory),
        })
    }
    /// Executable used by this worker. Embedded files are removed when the engine drops.
    pub fn path(&self) -> &Path {
        &self.binary
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn embedded_engine_is_private_and_cleaned_up() {
        let engine = Engine::embedded("opentofu", b"engine fixture").unwrap();
        let path = engine.path().to_owned();
        assert_eq!(std::fs::read(&path).unwrap(), b"engine fixture");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        drop(engine);
        assert!(!path.exists());
    }
}
