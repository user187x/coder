//! Native admission checks for the release's per-user allocation quotas.
use crate::{App, Error, Result, auth, settings};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgConnection;
use std::collections::BTreeMap;
use uuid::Uuid;

const KEYS: [&str; 4] = ["workspaces", "cpu", "memory", "disk"];
#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Mode {
    #[default]
    Cumulative,
    Instance,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct Modes {
    cpu: Mode,
    memory: Mode,
    disk: Mode,
}
impl Modes {
    fn get(&self, key: &str) -> Mode {
        match key {
            "cpu" => self.cpu,
            "memory" => self.memory,
            "disk" => self.disk,
            _ => Mode::Cumulative,
        }
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct Limits {
    workspaces: Option<f64>,
    cpu: Option<f64>,
    memory: Option<f64>,
    disk: Option<f64>,
}
impl Limits {
    fn values(&self) -> BTreeMap<String, Option<f64>> {
        KEYS.into_iter()
            .zip([self.workspaces, self.cpu, self.memory, self.disk])
            .map(|(k, v)| (k.into(), v))
            .collect()
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct QuotaSettings {
    default: Limits,
    users: BTreeMap<String, BTreeMap<String, Option<f64>>>,
    exempt_admins: bool,
    resource_modes: Modes,
}
impl Default for QuotaSettings {
    fn default() -> Self {
        Self {
            default: Limits::default(),
            users: BTreeMap::new(),
            exempt_admins: true,
            resource_modes: Modes::default(),
        }
    }
}
impl QuotaSettings {
    fn validate(&self) -> Result<()> {
        if self.users.len() > 10000 {
            return Err(Error::bad("Too many user quota overrides."));
        }
        for (user, limits) in std::iter::once(("default", self.default.values()))
            .chain(self.users.iter().map(|(u, l)| (u.as_str(), l.clone())))
        {
            if user.is_empty()
                || user.len() > 64
                || !user
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._@-".contains(&c))
            {
                return Err(Error::bad("Invalid quota username."));
            }
            for (key, value) in limits {
                if !KEYS.contains(&key.as_str())
                    || value.is_some_and(|n| {
                        !n.is_finite()
                            || !(0.0..=1_000_000.0).contains(&n)
                            || (key == "workspaces" && n.fract() != 0.0)
                    })
                {
                    return Err(Error::bad(
                        "Quota limits must be between 0 and 1,000,000; workspaces must be a whole number.",
                    ));
                }
            }
        }
        Ok(())
    }
    fn limits(&self, username: &str) -> BTreeMap<String, Option<f64>> {
        let mut limits = self.default.values();
        if let Some(own) = self.users.get(username) {
            limits.extend(own.clone());
        }
        limits
    }
}

fn resources(params: &Value) -> Result<BTreeMap<String, f64>> {
    let mut values: BTreeMap<String, f64> = KEYS.into_iter().map(|k| (k.into(), 0.0)).collect();
    values.insert("workspaces".into(), 1.0);
    for p in params.as_array().into_iter().flatten() {
        let key = match p["name"].as_str() {
            Some("cpu") => "cpu",
            Some("memory") => "memory",
            Some("home_disk_size") => "disk",
            _ => continue,
        };
        let value = p["value"]
            .as_str()
            .unwrap_or_default()
            .parse::<f64>()
            .unwrap_or(0.0);
        if !value.is_finite() {
            return Err(Error::bad(
                "Workspace resource parameters must be finite numbers.",
            ));
        }
        values.insert(key.into(), value.max(0.0));
    }
    Ok(values)
}

pub(crate) async fn lock_owner(conn: &mut PgConnection, owner: Uuid) -> Result<()> {
    sqlx::query("SELECT id FROM coder_rust.users WHERE id=$1 FOR UPDATE")
        .bind(owner)
        .fetch_one(conn)
        .await?;
    Ok(())
}

async fn usage(
    conn: &mut PgConnection,
    owner: Uuid,
    exclude: Option<Uuid>,
    modes: &Modes,
) -> Result<BTreeMap<String, f64>> {
    let rows: Vec<Value> = sqlx::query_scalar("SELECT b.parameters FROM coder_rust.workspaces w JOIN coder_rust.builds b ON b.id=w.latest_build_id WHERE w.owner_id=$1 AND NOT w.deleted AND ($2::uuid IS NULL OR w.id<>$2)")
        .bind(owner).bind(exclude).fetch_all(conn).await?;
    let mut result: BTreeMap<String, f64> = KEYS.into_iter().map(|k| (k.into(), 0.0)).collect();
    for row in rows {
        for (key, value) in resources(&row)? {
            let entry = result.get_mut(&key).expect("known key");
            *entry = if modes.get(&key) == Mode::Instance {
                entry.max(value)
            } else {
                *entry + value
            };
        }
    }
    Ok(result)
}

/// The owner row must be locked before workspace/build rows in every admission
/// transaction. Pending builds reserve their requested allocation immediately.
pub(crate) async fn enforce(
    conn: &mut PgConnection,
    owner: Uuid,
    current: Option<Uuid>,
    params: &Value,
    previous: Option<&Value>,
) -> Result<()> {
    let want = resources(params)?;
    if let Some(previous) = previous {
        let old = resources(previous)?;
        if ["cpu", "memory", "disk"]
            .iter()
            .all(|key| want[*key] <= old[*key])
        {
            return Ok(());
        }
    }
    let settings: QuotaSettings = settings::read(conn, "user_quota").await?;
    let (username, admin): (String, bool) =
        sqlx::query_as("SELECT username,is_admin FROM coder_rust.users WHERE id=$1")
            .bind(owner)
            .fetch_one(&mut *conn)
            .await?;
    if settings.exempt_admins && admin {
        return Ok(());
    }
    let limits = settings.limits(&username);
    if limits.values().all(Option::is_none) {
        return Ok(());
    }
    // Admission uses summed allocations for cumulative modes, and just the new
    // allocation for instance modes, even if another instance exceeds its limit.
    let used = usage(conn, owner, current, &Modes::default()).await?;
    for key in KEYS {
        let after = if settings.resource_modes.get(key) == Mode::Instance {
            want[key]
        } else {
            used[key] + want[key]
        };
        if limits[key].is_some_and(|limit| after > limit) {
            return Err(Error(
                StatusCode::FORBIDDEN,
                format!(
                    "Workspace quota exceeded for {key}: requested allocation {after}, limit {}.",
                    limits[key].unwrap()
                ),
            ));
        }
    }
    Ok(())
}

async fn user_report(
    conn: &mut PgConnection,
    settings: &QuotaSettings,
    id: Uuid,
    username: &str,
    admin: bool,
) -> Result<Value> {
    let limits = settings.limits(username);
    let exempt = admin && settings.exempt_admins;
    let usage = usage(conn, id, None, &settings.resource_modes).await?;
    let left: BTreeMap<_, _> = KEYS
        .into_iter()
        .map(|key| (key, limits[key].map(|n| (n - usage[key]).max(0.0))))
        .collect();
    Ok(
        json!({"limited":!exempt && limits.values().any(Option::is_some),"exempt":exempt,"limits":limits,"baseLimits":limits,"effectiveLimits":limits,"usage":usage,"left":left,"atLimit":!exempt && left.values().any(|n|n.is_some_and(|n|n<=0.0)),"resourceModes":settings.resource_modes}),
    )
}

pub(crate) async fn me(State(app): State<App>, headers: HeaderMap) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let mut conn = app.pool.acquire().await?;
    let settings = settings::read(&mut conn, "user_quota").await?;
    Ok(Json(
        user_report(
            &mut conn,
            &settings,
            actor.id,
            &actor.username,
            actor.is_admin,
        )
        .await?,
    ))
}

pub(crate) async fn report(State(app): State<App>, headers: HeaderMap) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    actor.admin()?;
    let mut conn = app.pool.acquire().await?;
    let settings: QuotaSettings = settings::read(&mut conn, "user_quota").await?;
    let users: Vec<(Uuid, String, bool)> = sqlx::query_as(
        "SELECT id,username,is_admin FROM coder_rust.users ORDER BY username LIMIT 10000",
    )
    .fetch_all(&mut *conn)
    .await?;
    let mut reports = Vec::new();
    for (id, username, admin) in users {
        let mut report = user_report(&mut conn, &settings, id, &username, admin).await?;
        report["id"] = json!(id);
        report["username"] = json!(username);
        reports.push(report);
    }
    Ok(Json(
        json!({"settings":settings,"users":reports,"generatedAt":chrono::Utc::now()}),
    ))
}

pub(crate) async fn save(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<QuotaSettings>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    actor.admin()?;
    req.validate()?;
    let mut tx = app.pool.begin().await?;
    settings::write(&mut tx, "user_quota", &req).await?;
    let orgs: Vec<Uuid> =
        sqlx::query_scalar("SELECT organization_id FROM coder_rust.memberships WHERE user_id=$1")
            .bind(actor.id)
            .fetch_all(&mut *tx)
            .await?;
    for org in orgs {
        crate::rbac::audit(&mut tx, org, actor.id, "quota.update", None).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"settings":req})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_overrides_and_explicit_unlimited() {
        let s: QuotaSettings = serde_json::from_value(
            json!({"default":{"workspaces":2,"cpu":4},"users":{"alice":{"cpu":null}}}),
        )
        .unwrap();
        s.validate().unwrap();
        assert_eq!(s.limits("alice")["cpu"], None);
        assert_eq!(s.limits("alice")["workspaces"], Some(2.0));
        assert_eq!(s.limits("bob")["cpu"], Some(4.0));
        for v in [
            json!({"default":{"cpu":-1}}),
            json!({"default":{"workspaces":1.5}}),
            json!({"users":{"x":{"unknown":1}}}),
        ] {
            assert!(
                serde_json::from_value::<QuotaSettings>(v)
                    .unwrap()
                    .validate()
                    .is_err()
            );
        }
    }
    #[test]
    fn resource_parameters_are_finite() {
        assert_eq!(
            resources(&json!([{"name":"home_disk_size","value":"12.5"}])).unwrap()["disk"],
            12.5
        );
        assert!(resources(&json!([{"name":"cpu","value":"NaN"}])).is_err());
        assert!(resources(&json!([{"name":"memory","value":"1e999"}])).is_err());
    }
}
