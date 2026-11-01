//! Workspace query syntax from the fork's 1.5.1 searchquery.Workspaces.
//! Unsupported filters fail explicitly rather than silently broadening results.

use crate::{Error, Result};
use std::collections::BTreeMap;
use uuid::Uuid;

#[derive(Default, Debug)]
pub(crate) struct Filter {
    pub name: String,
    pub owner: String,
    pub user: String,
    pub template: String,
    pub organization: String,
    pub status: String,
    pub outdated: Option<bool>,
    pub ids: Vec<Uuid>,
}

fn split(input: &str, delimiter: char, keep_quotes: bool) -> Result<Vec<String>> {
    let mut quoted = false;
    let mut parts = Vec::new();
    let mut part = String::new();
    for ch in input.chars() {
        if ch == '"' {
            quoted = !quoted;
            if keep_quotes {
                part.push(ch);
            }
        } else if ch == delimiter && !quoted {
            if !part.is_empty() {
                parts.push(std::mem::take(&mut part));
            }
        } else {
            part.push(ch);
        }
    }
    if quoted {
        return Err(Error::bad("Unclosed quote in workspace search."));
    }
    if !part.is_empty() {
        parts.push(part);
    }
    Ok(parts)
}

fn insert(values: &mut BTreeMap<String, String>, key: &str, value: &str) -> Result<()> {
    if value.is_empty() || values.insert(key.into(), value.into()).is_some() {
        return Err(Error::bad(
            "Workspace filters require one nonempty value per key.",
        ));
    }
    Ok(())
}

impl Filter {
    pub fn parse(query: &str) -> Result<Self> {
        if query.len() > 2048 {
            return Err(Error::bad("Workspace search exceeds 2048 bytes."));
        }
        let mut values = BTreeMap::new();
        let mut names = Vec::new();
        for token in split(&query.to_lowercase(), ' ', true)? {
            if token.starts_with(':') || token.ends_with(':') {
                return Err(Error::bad("Search terms cannot start or end with ':'."));
            }
            let parts = split(&token, ':', false)?;
            match parts.as_slice() {
                [_] => names.push(token),
                [key, value] => insert(&mut values, key, value)?,
                _ => {
                    return Err(Error::bad(
                        "Search terms may contain only one unquoted ':'.",
                    ));
                }
            }
        }
        if !names.is_empty() {
            match split(&names.join(" "), '/', false)?.as_slice() {
                [name] => insert(&mut values, "name", name)?,
                [owner, name] => {
                    insert(&mut values, "owner", owner)?;
                    insert(&mut values, "name", name)?;
                }
                _ => {
                    return Err(Error::bad(
                        "Workspace names may contain only one unquoted '/'.",
                    ));
                }
            }
        }
        let mut result = Self::default();
        for (key, value) in values {
            match key.as_str() {
                "name" => result.name = value,
                "owner" => result.owner = value,
                "user" => result.user = value,
                "template" => result.template = value,
                "organization" => result.organization = value,
                "status" => {
                    if !matches!(
                        value.as_str(),
                        "pending"
                            | "starting"
                            | "running"
                            | "stopping"
                            | "stopped"
                            | "deleting"
                            | "deleted"
                            | "failed"
                            | "canceling"
                            | "canceled"
                    ) {
                        return Err(Error::bad("Unknown workspace status."));
                    }
                    result.status = value;
                }
                "outdated" => {
                    result.outdated = Some(match value.as_str() {
                        "true" | "1" | "t" => true,
                        "false" | "0" | "f" => false,
                        _ => return Err(Error::bad("outdated must be a boolean.")),
                    })
                }
                "id" => {
                    result.ids = value
                        .split(',')
                        .map(|v| {
                            Uuid::parse_str(v).map_err(|_| {
                                Error::bad("id must contain comma-separated workspace UUIDs.")
                            })
                        })
                        .collect::<Result<_>>()?;
                }
                _ => {
                    return Err(Error::bad(format!(
                        "Workspace filter '{key}' is not implemented in the Rust runtime."
                    )));
                }
            }
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_search_forms() {
        let f = Filter::parse(
            "OWNER:Me template:\"Linux Dev\" name:\"my workspace\" status:RUNNING outdated:false",
        )
        .unwrap();
        assert_eq!(
            (
                f.owner.as_str(),
                f.template.as_str(),
                f.name.as_str(),
                f.status.as_str(),
                f.outdated
            ),
            ("me", "linux dev", "my workspace", "running", Some(false))
        );
        let f = Filter::parse("Alice/dev box organization:default").unwrap();
        assert_eq!(
            (f.owner.as_str(), f.name.as_str(), f.organization.as_str()),
            ("alice", "dev box", "default")
        );
        assert_eq!(Filter::parse("user:me").unwrap().user, "me");
    }

    #[test]
    fn rejects_ambiguous_or_unimplemented_queries() {
        for query in [
            "owner:a owner:b",
            "name:",
            ":bad",
            "status:invented",
            "outdated:yes",
            "id:bad",
            "name:\"unclosed",
            "one/two/three",
            "owner:me alice/dev",
            "has-agent:connected",
            "name:a:b",
        ] {
            assert!(Filter::parse(query).is_err(), "{query}");
        }
    }
}
