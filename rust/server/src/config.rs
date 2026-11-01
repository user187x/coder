//! Validated server and external PostgreSQL configuration, without printable secrets.

use sqlx::{
    ConnectOptions, PgPool,
    postgres::{PgConnectOptions, PgPoolOptions, PgSslMode},
};
use std::{collections::BTreeMap, fmt, io::Read, net::SocketAddr, path::Path, time::Duration};
use url::Url;

/// Server, PostgreSQL, and migration settings. Deliberately does not implement Debug.
pub struct ServerConfig {
    /// HTTP listening address.
    pub listen: SocketAddr,
    /// Optional public browser origin.
    pub origin: Option<String>,
    /// Encryption key for secrets, agent credentials, and infrastructure state.
    pub encryption_key: Option<[u8; 32]>,
    /// Whether startup applies migrations. Disable with a separately migrated database.
    pub migrate: bool,
    database: PgConnectOptions,
    maximum_connections: u32,
    acquire_timeout: Duration,
}

/// A sanitized configuration or connection failure, never containing credentials.
#[derive(Debug)]
pub struct ConfigError(&'static str);
impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for ConfigError {}
type Result<T> = std::result::Result<T, ConfigError>;

/// Command-specific help, available without database credentials.
pub const HELP: &str = "Usage: coder server|migrate|db-check [OPTIONS]

--database-url URL       PostgreSQL URL (DATABASE_URL)
--db-host HOST           Database hostname (PGHOST)
--db-port PORT           Database TCP port (PGPORT, default 5432)
--db-user USER           Database role (PGUSER, default postgres)
--db-name NAME           Database name (PGDATABASE, default postgres)
--db-password-file PATH  Password file (CODER_DB_PASSWORD_FILE), or use PGPASSWORD
--db-ssl-mode MODE       disable, allow, prefer, require, verify-ca, verify-full
                        (PGSSLMODE; default verify-full)
--db-ssl-root-cert PATH  Trusted CA PEM file (PGSSLROOTCERT)
--db-ssl-cert PATH       Client certificate PEM (PGSSLCERT)
--db-ssl-key PATH        Client private key PEM (PGSSLKEY)
--db-max-connections N   1-1000 (CODER_DB_MAX_CONNECTIONS, default 10)
--db-connect-timeout N   Acquisition/connect deadline, 1-300 seconds
                        (CODER_DB_CONNECT_TIMEOUT, default 10)
--listen IP:PORT        HTTP address (CODER_SERVER_LISTEN, default 127.0.0.1:3000)
--origin URL            Public browser origin (CODER_SERVER_ORIGIN)
--encryption-key-file P Encryption key file (CODER_ENCRYPTION_KEY_FILE), or
                        use CODER_ENCRYPTION_KEY (64 hexadecimal characters)
--no-migrate            Check existing schema instead of applying migrations
                        (CODER_DATABASE_MIGRATE=false)
--help                  Show help without reading secrets or contacting PostgreSQL

Flags override their environment variables. Structured flags override URL fields.
PG* environment fields are defaults when no URL is supplied; PGPASSWORD and TLS
settings can supply values missing from a URL. Prefer password files or PGPASSWORD
over passwords in command arguments. db-check never applies migrations.
";

fn secret(path: &str, limit: usize) -> Result<String> {
    let file = std::fs::File::open(Path::new(path))
        .map_err(|_| ConfigError("Secret file could not be opened."))?;
    if !file
        .metadata()
        .map_err(|_| ConfigError("Secret file metadata is unavailable."))?
        .is_file()
    {
        return Err(ConfigError("Secret path must be a regular file."));
    }
    let mut bytes = Vec::new();
    file.take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| ConfigError("Secret file could not be read."))?;
    if bytes.len() > limit {
        return Err(ConfigError("Secret file exceeds its size limit."));
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| ConfigError("Secret file must contain UTF-8 text."))?;
    // Remove a single conventional line ending, preserving all other password bytes.
    let text = text.strip_suffix('\n').unwrap_or(&text);
    let text = text.strip_suffix('\r').unwrap_or(text);
    if text.is_empty() || text.contains(['\0', '\r', '\n']) {
        return Err(ConfigError("Secret file must contain one nonempty line."));
    }
    Ok(text.into())
}

impl ServerConfig {
    /// Reads known environment variables and explicit flags. Unknown/duplicate flags fail.
    pub fn from_args(args: impl IntoIterator<Item = String>) -> Result<Self> {
        Self::parse(args, |name| std::env::var(name).ok())
    }
    fn parse(
        args: impl IntoIterator<Item = String>,
        env: impl Fn(&str) -> Option<String>,
    ) -> Result<Self> {
        let mut flags = BTreeMap::new();
        let mut args = args.into_iter();
        while let Some(argument) = args.next() {
            let (name, value) = if argument == "--no-migrate" {
                (argument, "false".into())
            } else if let Some((name, value)) = argument.split_once('=') {
                (name.to_owned(), value.to_owned())
            } else {
                (
                    argument,
                    args.next()
                        .ok_or(ConfigError("Each option requires a value."))?,
                )
            };
            if !matches!(
                name.as_str(),
                "--database-url"
                    | "--db-host"
                    | "--db-port"
                    | "--db-user"
                    | "--db-name"
                    | "--db-password-file"
                    | "--db-ssl-mode"
                    | "--db-ssl-root-cert"
                    | "--db-ssl-cert"
                    | "--db-ssl-key"
                    | "--db-max-connections"
                    | "--db-connect-timeout"
                    | "--listen"
                    | "--origin"
                    | "--encryption-key-file"
                    | "--no-migrate"
            ) {
                return Err(ConfigError(
                    "Unknown server option. Use --help for supported parameters.",
                ));
            }
            if value.is_empty() || flags.insert(name, value).is_some() {
                return Err(ConfigError("Options must be nonempty and supplied once."));
            }
        }
        let setting =
            |flag: &str, variable: &str| flags.get(flag).cloned().or_else(|| env(variable));
        let database_url = setting("--database-url", "DATABASE_URL");
        if database_url.is_none() && setting("--db-host", "PGHOST").is_none() {
            return Err(ConfigError(
                "Set DATABASE_URL or provide --db-host/PGHOST for an external PostgreSQL database.",
            ));
        }
        let mut parsed = Url::parse(
            database_url
                .as_deref()
                .unwrap_or("postgresql://postgres@localhost:5432/postgres"),
        )
        .map_err(|_| ConfigError("Invalid PostgreSQL URL."))?;
        if !matches!(parsed.scheme(), "postgres" | "postgresql") || parsed.fragment().is_some() {
            return Err(ConfigError(
                "Use a postgres:// or postgresql:// URL without a fragment.",
            ));
        }
        let allowed = [
            "sslmode",
            "ssl-mode",
            "sslrootcert",
            "ssl-root-cert",
            "ssl-ca",
            "sslcert",
            "ssl-cert",
            "sslkey",
            "ssl-key",
            "host",
            "hostaddr",
            "port",
            "dbname",
            "user",
            "password",
            "application_name",
            "statement-cache-capacity",
        ];
        if parsed
            .query_pairs()
            .any(|(key, _)| !allowed.contains(&key.as_ref()))
        {
            return Err(ConfigError("Unsupported PostgreSQL URL parameter."));
        }
        if parsed.host_str().is_none()
            && !parsed
                .query_pairs()
                .any(|(key, _)| matches!(key.as_ref(), "host" | "hostaddr"))
            && !flags.contains_key("--db-host")
        {
            return Err(ConfigError(
                "The PostgreSQL URL must specify a host, or supply --db-host.",
            ));
        }
        if parsed.username().is_empty() {
            parsed
                .set_username("postgres")
                .map_err(|_| ConfigError("Invalid PostgreSQL URL."))?;
        }
        if parsed.path().trim_matches('/').is_empty() {
            parsed.set_path("/postgres");
        }
        let has_mode = parsed
            .query_pairs()
            .any(|(k, _)| matches!(k.as_ref(), "sslmode" | "ssl-mode"));
        if !has_mode {
            parsed.query_pairs_mut().append_pair(
                "sslmode",
                &env("PGSSLMODE").unwrap_or_else(|| "verify-full".into()),
            );
        }
        let mut database = PgConnectOptions::from_url(&parsed)
            .map_err(|_| ConfigError("Invalid PostgreSQL connection parameters."))?
            .application_name("coder-rust")
            .disable_statement_logging();
        if parsed.port().is_none() && !parsed.query_pairs().any(|(k, _)| k == "port") {
            database = database.port(5432);
        }
        // A URL owns its host/user/database fields; explicit component flags always win.
        let component = |flag: &str, variable: &str| {
            flags.get(flag).cloned().or_else(|| {
                if database_url.is_none() {
                    env(variable)
                } else {
                    None
                }
            })
        };
        if let Some(host) = component("--db-host", "PGHOST") {
            database = database.host(&host);
        }
        if let Some(port) = component("--db-port", "PGPORT") {
            let port = port
                .parse::<u16>()
                .ok()
                .filter(|p| *p > 0)
                .ok_or(ConfigError("Database port must be 1-65535."))?;
            database = database.port(port);
        }
        if database.get_port() == 0 {
            return Err(ConfigError("Database port must be 1-65535."));
        }
        if let Some(user) = component("--db-user", "PGUSER") {
            database = database.username(&user);
        }
        if let Some(name) = component("--db-name", "PGDATABASE") {
            database = database.database(&name);
        }
        if parsed.password().is_none() && !parsed.query_pairs().any(|(k, _)| k == "password") {
            if let Some(password) = env("PGPASSWORD") {
                database = database.password(&password);
            }
        }
        if let Some(path) = setting("--db-password-file", "CODER_DB_PASSWORD_FILE") {
            database = database.password(&secret(&path, 16384)?);
        }
        if let Some(mode) = flags.get("--db-ssl-mode") {
            database = database.ssl_mode(
                mode.parse::<PgSslMode>()
                    .map_err(|_| ConfigError("Invalid PostgreSQL TLS mode."))?,
            );
        }
        // Explicit TLS flags override the URL; URL parameters override environment defaults.
        for (flag, variable, keys) in [
            (
                "--db-ssl-root-cert",
                "PGSSLROOTCERT",
                &["sslrootcert", "ssl-root-cert", "ssl-ca"][..],
            ),
            ("--db-ssl-cert", "PGSSLCERT", &["sslcert", "ssl-cert"][..]),
            ("--db-ssl-key", "PGSSLKEY", &["sslkey", "ssl-key"][..]),
        ] {
            let in_url = parsed
                .query_pairs()
                .any(|(key, _)| keys.contains(&key.as_ref()));
            let value = flags
                .get(flag)
                .cloned()
                .or_else(|| if !in_url { env(variable) } else { None });
            if let Some(value) = value {
                database = match flag {
                    "--db-ssl-root-cert" => database.ssl_root_cert(value),
                    "--db-ssl-cert" => database.ssl_client_cert(value),
                    _ => database.ssl_client_key(value),
                };
            }
        }
        let number = |flag: &str, variable: &str, default: u32, maximum: u32| -> Result<u32> {
            setting(flag, variable)
                .unwrap_or_else(|| default.to_string())
                .parse::<u32>()
                .ok()
                .filter(|n| *n > 0 && *n <= maximum)
                .ok_or(ConfigError("Invalid connection limit or timeout."))
        };
        let maximum_connections = number(
            "--db-max-connections",
            "CODER_DB_MAX_CONNECTIONS",
            10u32,
            1000,
        )?;
        let acquire_timeout = Duration::from_secs(u64::from(number(
            "--db-connect-timeout",
            "CODER_DB_CONNECT_TIMEOUT",
            10u32,
            300,
        )?));
        let listen = setting("--listen", "CODER_SERVER_LISTEN")
            .unwrap_or_else(|| "127.0.0.1:3000".into())
            .parse()
            .map_err(|_| ConfigError("Invalid HTTP listening address."))?;
        let origin = setting("--origin", "CODER_SERVER_ORIGIN");
        if let Some(origin) = &origin {
            let url = Url::parse(origin).map_err(|_| ConfigError("Invalid public HTTP origin."))?;
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.path() != "/"
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(ConfigError(
                    "Use an HTTP(S) origin without credentials, paths, or query parameters.",
                ));
            }
        }
        let encryption_key =
            if let Some(path) = setting("--encryption-key-file", "CODER_ENCRYPTION_KEY_FILE") {
                Some(secret(&path, 128)?)
            } else {
                env("CODER_ENCRYPTION_KEY")
            }
            .map(|v| crate::encryption_key(&v).map_err(ConfigError))
            .transpose()?;
        if flags.get("--no-migrate").is_some_and(|v| v != "false") {
            return Err(ConfigError("--no-migrate takes no value."));
        }
        let migrate = setting("--no-migrate", "CODER_DATABASE_MIGRATE")
            .unwrap_or_else(|| "true".into())
            .parse()
            .map_err(|_| ConfigError("CODER_DATABASE_MIGRATE must be true or false."))?;
        Ok(Self {
            listen,
            origin,
            encryption_key,
            migrate,
            database,
            maximum_connections,
            acquire_timeout,
        })
    }
    /// Opens an external pool using the configured acquisition deadline and connection cap.
    /// Does not create a database, role, schema, or run migrations.
    pub async fn connect(&self) -> Result<PgPool> {
        PgPoolOptions::new().max_connections(self.maximum_connections).acquire_timeout(self.acquire_timeout).connect_with(self.database.clone()).await.map_err(|_|ConfigError("PostgreSQL connection failed. Check network access, credentials, TLS settings, and the connection deadline."))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(args: &[&str], environment: &[(&str, &str)]) -> Result<ServerConfig> {
        ServerConfig::parse(args.iter().map(|s| s.to_string()), |key| {
            environment
                .iter()
                .find(|(name, _)| *name == key)
                .map(|(_, value)| value.to_string())
        })
    }
    #[test]
    fn structured_fields_override_url_and_preserve_special_characters() {
        let cfg = parse(
            &[
                "--database-url",
                "postgres://old:secret@old.example/old?sslmode=require",
                "--db-host=db.example",
                "--db-port",
                "6543",
                "--db-user",
                "role @:+",
                "--db-name",
                "workspace /:db",
                "--db-ssl-mode",
                "verify-full",
            ],
            &[
                ("DATABASE_URL", "postgres://ignored/wrong"),
                ("PGHOST", "ignored.example"),
            ],
        )
        .unwrap();
        assert_eq!(cfg.database.get_host(), "db.example");
        assert_eq!(cfg.database.get_port(), 6543);
        assert_eq!(cfg.database.get_username(), "role @:+");
        assert_eq!(cfg.database.get_database(), Some("workspace /:db"));
        assert!(matches!(cfg.database.get_ssl_mode(), PgSslMode::VerifyFull));
    }
    #[test]
    fn environment_defaults_and_tls_are_explicit() {
        let cfg = parse(
            &[],
            &[
                ("PGHOST", "database.example"),
                ("PGPORT", "6544"),
                ("PGUSER", "runtime"),
                ("PGDATABASE", "coder"),
                ("CODER_DATABASE_MIGRATE", "false"),
                ("CODER_DB_MAX_CONNECTIONS", "23"),
            ],
        )
        .unwrap();
        assert_eq!(cfg.database.get_host(), "database.example");
        assert_eq!(cfg.database.get_username(), "runtime");
        assert_eq!(cfg.database.get_port(), 6544);
        assert!(matches!(cfg.database.get_ssl_mode(), PgSslMode::VerifyFull));
        assert!(!cfg.migrate);
        assert_eq!(cfg.maximum_connections, 23);
        assert!(matches!(
            parse(
                &[
                    "--database-url",
                    "postgresql://db.example/coder?sslmode=disable"
                ],
                &[]
            )
            .unwrap()
            .database
            .get_ssl_mode(),
            PgSslMode::Disable
        ));
    }
    #[test]
    fn invalid_inputs_fail_without_echoing_credentials() {
        for args in [
            vec![
                "--database-url",
                "postgres://user:private-secret@host/db?unsupported=private-secret",
            ],
            vec!["--database-url", "https://user:private-secret@host/db"],
            vec!["--db-host", "host", "--db-port", "0"],
            vec!["--db-host", "host", "--db-max-connections", "0"],
            vec!["--db-host", "host", "--db-connect-timeout", "301"],
            vec!["--db-host", "a", "--db-host", "b"],
            vec!["--db-password", "private-secret"],
            vec![
                "--origin",
                "https://user:private-secret@host/path",
                "--db-host",
                "host",
            ],
        ] {
            let error = parse(&args, &[])
                .err()
                .expect("invalid configuration accepted");
            assert!(!format!("{error:?} {error}").contains("private-secret"));
        }
    }
    #[test]
    fn files_preserve_password_whitespace_and_bound_secrets() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("password");
        std::fs::write(&file, b"  p@ss:/word  \r\n").unwrap();
        assert_eq!(
            secret(file.to_str().unwrap(), 16384).unwrap(),
            "  p@ss:/word  "
        );
        std::fs::write(&file, b"first\nsecond\n").unwrap();
        assert!(secret(file.to_str().unwrap(), 16384).is_err());
        std::fs::write(&file, vec![b'x'; 16385]).unwrap();
        assert!(secret(file.to_str().unwrap(), 16384).is_err());
    }
}
