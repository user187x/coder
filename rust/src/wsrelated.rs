//! Workspace related-data selections, ported from `codersdk/wsrelated`.
//!
//! An absent query parameter selects everything; an explicitly empty one selects
//! nothing. Callers distinguish these cases using `Config::from_query`.

use crate::InvalidInput;

// Preorder matches the Go encoder's stable field order. Every parent precedes
// its children, and all descendants share the parent's dotted prefix.
const PATHS: &[&str] = &[
    "template",
    "latest_build",
    "latest_build.job",
    "latest_build.job.queue_position",
    "latest_build.resources",
    "latest_build.resources.metadata",
    "latest_build.resources.agents",
    "latest_build.resources.agents.apps",
    "latest_build.resources.agents.apps.statuses",
    "latest_build.resources.agents.scripts",
    "latest_build.resources.agents.log_sources",
    "latest_build.template_version",
];

/// A validated selection of related workspace data, including selected ancestors.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Config {
    selected: u16,
}

impl Config {
    /// Selects every related object.
    pub fn all() -> Self {
        Self {
            selected: (1 << PATHS.len()) - 1,
        }
    }

    /// Selects the complete latest-build subtree, without the template.
    pub fn all_latest_build() -> Self {
        Self {
            selected: Self::all().selected & !1,
        }
    }

    /// Parses a query value, selecting everything when the parameter is absent.
    pub fn from_query(value: Option<&str>) -> Result<Self, InvalidInput> {
        match value {
            Some(value) => Self::parse(value),
            None => Ok(Self::all()),
        }
    }

    /// Parses comma-separated dotted paths with optional terminal wildcards.
    ///
    /// Surrounding whitespace and one trailing comma are allowed. Empty interior
    /// entries, unknown paths, and wildcards inside a path are rejected.
    pub fn parse(value: &str) -> Result<Self, InvalidInput> {
        let mut result = Self::default();
        let mut tokens = value.split(',').peekable();
        while let Some(raw) = tokens.next() {
            let token = raw.trim();
            if token.is_empty() {
                if tokens.peek().is_none() {
                    continue;
                }
                return Err(InvalidInput::new("empty include_related path"));
            }
            if token == "*" {
                result = Self::all();
                continue;
            }
            let (path, wildcard) = match token.strip_suffix(".*") {
                Some(path) => (path, true),
                None => (token, false),
            };
            if path.split('.').any(|s| s.is_empty() || s == "*") {
                return Err(InvalidInput::new(format!(
                    "invalid include_related path {token:?}"
                )));
            }
            if !PATHS.contains(&path) {
                return Err(InvalidInput::new(format!(
                    "unknown include_related path {token:?}"
                )));
            }
            for (i, candidate) in PATHS.iter().enumerate() {
                if *candidate == path
                    || is_descendant(path, candidate)
                    || (wildcard && is_descendant(candidate, path))
                {
                    result.selected |= 1 << i;
                }
            }
        }
        Ok(result)
    }

    /// Reports whether a known path is selected, including implied ancestors.
    pub fn contains(&self, path: &str) -> bool {
        PATHS
            .iter()
            .position(|p| *p == path)
            .is_some_and(|i| self.selected & (1 << i) != 0)
    }

    /// Reports whether workspace application statuses are selected.
    pub fn app_statuses(&self) -> bool {
        self.contains("latest_build.resources.agents.apps.statuses")
    }

    /// Encodes only selected nodes without selected descendants, in stable order.
    pub fn query_param(&self) -> String {
        PATHS
            .iter()
            .filter(|path| {
                self.contains(path)
                    && !PATHS
                        .iter()
                        .any(|child| is_descendant(child, path) && self.contains(child))
            })
            .copied()
            .collect::<Vec<_>>()
            .join(",")
    }
}

fn is_descendant(path: &str, ancestor: &str) -> bool {
    path.strip_prefix(ancestor)
        .is_some_and(|rest| rest.starts_with('.'))
}
