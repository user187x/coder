//! Persistent schedules and a transactionally serialized lifecycle reconciler.
use crate::{App, Error, Result, auth, quotas, settings, weekly::Weekly, workspaces};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Duration, NaiveTime, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

#[derive(Clone, Copy, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Mode {
    #[default]
    User,
    Fixed,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
struct Fixed {
    start: String,
    stop: String,
    days: Vec<u32>,
    timezone: String,
}
impl Default for Fixed {
    fn default() -> Self {
        Self {
            start: "08:00".into(),
            stop: "18:00".into(),
            days: vec![1, 2, 3, 4, 5],
            timezone: "UTC".into(),
        }
    }
}
impl Fixed {
    fn schedule(&self) -> Result<Schedule> {
        let parse = |s: &str| {
            if s.len() != 5 {
                return Err(Error::bad("Use HH:MM for start and stop times."));
            }
            NaiveTime::parse_from_str(s, "%H:%M")
                .map_err(|_| Error::bad("Use HH:MM for start and stop times."))
        };
        let start = parse(&self.start)?;
        let stop = parse(&self.stop)?;
        if start == stop
            || self.days.is_empty()
            || self.days.len() > 7
            || self.days.iter().any(|d| *d > 6)
        {
            return Err(Error::bad(
                "Select distinct start/stop times and weekdays from 0 to 6.",
            ));
        }
        let mut days = self.days.clone();
        days.sort();
        days.dedup();
        let days = if days.len() == 7 {
            "*".into()
        } else {
            days.iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(",")
        };
        let spec = Weekly::parse(&format!(
            "CRON_TZ={} {} {} * * {days}",
            self.timezone,
            start.minute(),
            start.hour()
        ))?;
        let minutes = (i64::from(stop.num_seconds_from_midnight())
            - i64::from(start.num_seconds_from_midnight()))
            / 60;
        Ok(Schedule {
            autostart_schedule: Some(spec.canonical),
            ttl_ms: Some(if minutes > 0 { minutes } else { minutes + 1440 } * 60000),
        })
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Rules {
    enabled: bool,
    mode: Mode,
    fixed: Fixed,
    max_active_hours: Option<f64>,
    ignore_admins: bool,
    excluded_users: Vec<String>,
}
impl Default for Rules {
    fn default() -> Self {
        Self {
            enabled: false,
            mode: Mode::User,
            fixed: Fixed::default(),
            max_active_hours: None,
            ignore_admins: true,
            excluded_users: vec![],
        }
    }
}
impl Rules {
    fn validate(&mut self) -> Result<()> {
        if self.max_active_hours == Some(0.0) {
            self.max_active_hours = None;
        }
        if self
            .max_active_hours
            .is_some_and(|h| !h.is_finite() || !(0.5..=168.0).contains(&h))
        {
            return Err(Error::bad(
                "Maximum active hours must be between 0.5 and 168.",
            ));
        }
        let fixed = self.fixed.schedule()?;
        if self.mode == Mode::Fixed
            && self
                .max_active_hours
                .is_some_and(|h| fixed.ttl_ms.unwrap() as f64 > h * 3600000.0)
        {
            return Err(Error::bad(
                "The fixed schedule exceeds the maximum active hours.",
            ));
        }
        if self.excluded_users.len() > 10000
            || self.excluded_users.iter().any(|u| {
                u.is_empty()
                    || u.len() > 64
                    || !u
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"._@-".contains(&c))
            })
        {
            return Err(Error::bad("Invalid excluded usernames."));
        }
        Ok(())
    }
    fn exemption(&self, username: &str, admin: bool) -> &'static str {
        if !self.enabled {
            "the scheduler is off"
        } else if self.excluded_users.iter().any(|u| u == username) {
            "excluded"
        } else if self.ignore_admins && admin {
            "admins are not required"
        } else {
            ""
        }
    }
    fn problem(&self, s: &Schedule, part: &str) -> Result<Option<String>> {
        if self.mode == Mode::Fixed {
            let fixed = self.fixed.schedule()?;
            if (part != "ttl" && s.autostart_schedule != fixed.autostart_schedule)
                || (part != "autostart" && s.ttl_ms != fixed.ttl_ms)
            {
                return Ok(Some(
                    "An administrator sets every workspace's schedule.".into(),
                ));
            }
        } else if part != "ttl" && s.autostart_schedule.is_none() {
            return Ok(Some("Every workspace needs a start time.".into()));
        }
        if part != "autostart" {
            if s.ttl_ms.is_none() {
                return Ok(Some("Every workspace needs a stop time.".into()));
            }
            if self
                .max_active_hours
                .is_some_and(|h| s.ttl_ms.unwrap() as f64 > h * 3600000.0)
            {
                return Ok(Some(
                    "The workspace exceeds the maximum active hours.".into(),
                ));
            }
        }
        Ok(None)
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Schedule {
    pub autostart_schedule: Option<String>,
    pub ttl_ms: Option<i64>,
}
impl Schedule {
    fn normalize(mut self) -> Result<Self> {
        self.autostart_schedule = self
            .autostart_schedule
            .filter(|s| !s.trim().is_empty())
            .map(|s| Weekly::parse(&s).map(|s| s.canonical))
            .transpose()?;
        self.ttl_ms = match self.ttl_ms {
            None | Some(0) => None,
            Some(ms) if (1..=43200).contains(&(ms / 60000)) => Some(ms / 60000 * 60000),
            _ => {
                return Err(Error::bad(
                    "Autostop must be between one minute and 30 days.",
                ));
            }
        };
        Ok(self)
    }
    pub fn next(&self, now: DateTime<Utc>) -> Result<Option<DateTime<Utc>>> {
        self.autostart_schedule
            .as_deref()
            .map(Weekly::parse)
            .transpose()?
            .map(|s| s.next(now))
            .transpose()
    }
}

async fn owner_rules(conn: &mut PgConnection, owner: Uuid) -> Result<(Rules, bool)> {
    let rules: Rules = settings::read(conn, "scheduler").await?;
    let (name, admin): (String, bool) =
        sqlx::query_as("SELECT username,is_admin FROM coder_rust.users WHERE id=$1")
            .bind(owner)
            .fetch_one(conn)
            .await?;
    let enforced = rules.exemption(&name, admin).is_empty();
    Ok((rules, enforced))
}

pub(crate) async fn prepare(
    conn: &mut PgConnection,
    owner: Uuid,
    s: Schedule,
    part: &str,
) -> Result<Schedule> {
    let (rules, enforced) = owner_rules(conn, owner).await?;
    let s = if enforced && rules.mode == Mode::Fixed && part == "create" {
        rules.fixed.schedule()?
    } else {
        s
    };
    let s = s.normalize()?;
    if enforced {
        if let Some(problem) = rules.problem(&s, part)? {
            return Err(Error(StatusCode::FORBIDDEN, problem));
        }
    }
    Ok(s)
}

pub(crate) async fn on_build(
    conn: &mut PgConnection,
    workspace: Uuid,
    transition: &str,
) -> Result<()> {
    if transition == "stop" {
        let raw: Option<String> =
            sqlx::query_scalar("SELECT autostart_schedule FROM coder_rust.workspaces WHERE id=$1")
                .bind(workspace)
                .fetch_one(&mut *conn)
                .await?;
        let next = Schedule {
            autostart_schedule: raw,
            ttl_ms: None,
        }
        .next(Utc::now())?;
        sqlx::query("UPDATE coder_rust.workspaces SET next_start_at=$1 WHERE id=$2")
            .bind(next)
            .bind(workspace)
            .execute(conn)
            .await?;
    }
    Ok(())
}

pub(crate) async fn on_complete(
    conn: &mut PgConnection,
    workspace: Uuid,
    build: Uuid,
) -> Result<()> {
    let (owner, ttl): (Uuid, Option<i64>) =
        sqlx::query_as("SELECT owner_id,ttl_ms FROM coder_rust.workspaces WHERE id=$1")
            .bind(workspace)
            .fetch_one(&mut *conn)
            .await?;
    let (rules, enforced) = owner_rules(conn, owner).await?;
    let now: DateTime<Utc> =
        sqlx::query_scalar("SELECT completed_at FROM coder_rust.builds WHERE id=$1")
            .bind(build)
            .fetch_one(&mut *conn)
            .await?;
    let max = if enforced {
        rules
            .max_active_hours
            .map(|h| now + Duration::milliseconds((h * 3600000.0) as i64))
    } else {
        None
    };
    let deadline = match (ttl.map(|ms| now + Duration::milliseconds(ms)), max) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    };
    sqlx::query("UPDATE coder_rust.builds SET deadline=$1,max_deadline=$2 WHERE id=$3")
        .bind(deadline)
        .bind(max)
        .bind(build)
        .execute(conn)
        .await?;
    Ok(())
}

async fn update(
    app: &App,
    headers: &HeaderMap,
    id: Uuid,
    s: Schedule,
    part: &str,
) -> Result<StatusCode> {
    let actor = auth::actor(app, headers).await?;
    let w = workspaces::authorized_action(app, &actor, id, "workspace.schedule").await?;
    let mut tx = app.pool.begin().await?;
    quotas::lock_owner(&mut tx, w.owner_id).await?;
    let (old_start,old_ttl):(Option<String>,Option<i64>)=sqlx::query_as("SELECT autostart_schedule,ttl_ms FROM coder_rust.workspaces WHERE id=$1 AND NOT deleted FOR UPDATE").bind(id).fetch_one(&mut *tx).await?;
    let requested = Schedule {
        autostart_schedule: if part == "ttl" {
            old_start
        } else {
            s.autostart_schedule
        },
        ttl_ms: if part == "autostart" {
            old_ttl
        } else {
            s.ttl_ms
        },
    };
    let schedule = prepare(&mut tx, w.owner_id, requested, part).await?;
    let next = schedule.next(Utc::now())?;
    sqlx::query("UPDATE coder_rust.workspaces SET autostart_schedule=$1,ttl_ms=$2,next_start_at=$3 WHERE id=$4")
        .bind(schedule.autostart_schedule).bind(schedule.ttl_ms).bind(next).bind(id).execute(&mut *tx).await?;
    crate::rbac::audit(
        &mut tx,
        w.organization_id,
        actor.id,
        "workspace.schedule",
        Some(id),
    )
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Autostart {
    schedule: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Ttl {
    ttl_ms: Option<i64>,
}
pub(crate) async fn autostart(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<Autostart>,
) -> Result<StatusCode> {
    update(
        &app,
        &headers,
        id,
        Schedule {
            autostart_schedule: req.schedule,
            ttl_ms: None,
        },
        "autostart",
    )
    .await
}
pub(crate) async fn ttl(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<Ttl>,
) -> Result<StatusCode> {
    update(
        &app,
        &headers,
        id,
        Schedule {
            autostart_schedule: None,
            ttl_ms: req.ttl_ms,
        },
        "ttl",
    )
    .await
}
pub(crate) async fn put(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<Schedule>,
) -> Result<StatusCode> {
    update(&app, &headers, id, req, "both").await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Extend {
    deadline: DateTime<Utc>,
}
pub(crate) async fn extend(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<Extend>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    let w = workspaces::authorized_action(&app, &actor, id, "workspace.schedule").await?;
    let mut tx = app.pool.begin().await?;
    quotas::lock_owner(&mut tx, w.owner_id).await?;
    sqlx::query("SELECT id FROM coder_rust.workspaces WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    let build=sqlx::query_as::<_,workspaces::Build>("SELECT b.* FROM coder_rust.builds b JOIN coder_rust.workspaces w ON w.latest_build_id=b.id WHERE w.id=$1 FOR UPDATE OF b").bind(id).fetch_one(&mut *tx).await?;
    let now = Utc::now();
    if build.status != "running" || build.deadline.is_none() {
        return Err(Error::conflict(
            "Only a running workspace with autostop can be extended.",
        ));
    }
    if req.deadline < now + Duration::minutes(29)
        || req.deadline > now + Duration::days(30)
        || build.max_deadline.is_some_and(|max| req.deadline > max)
    {
        return Err(Error::bad(
            "Deadline must be at least 30 minutes away, within 30 days, and within the maximum deadline.",
        ));
    }
    sqlx::query("UPDATE coder_rust.builds SET deadline=$1 WHERE id=$2")
        .bind(req.deadline)
        .bind(build.id)
        .execute(&mut *tx)
        .await?;
    crate::rbac::audit(
        &mut tx,
        w.organization_id,
        actor.id,
        "workspace.extend",
        Some(id),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"message":"Workspace deadline updated.","deadline":req.deadline}),
    ))
}

pub(crate) async fn save(
    State(app): State<App>,
    headers: HeaderMap,
    Json(mut req): Json<Rules>,
) -> Result {
    let actor = auth::actor(&app, &headers).await?;
    actor.admin()?;
    req.validate()?;
    let mut tx = app.pool.begin().await?;
    settings::write(&mut tx, "scheduler", &req).await?;
    let orgs: Vec<Uuid> =
        sqlx::query_scalar("SELECT organization_id FROM coder_rust.memberships WHERE user_id=$1")
            .bind(actor.id)
            .fetch_all(&mut *tx)
            .await?;
    for org in orgs {
        crate::rbac::audit(&mut tx, org, actor.id, "scheduler.update", None).await?;
    }
    tx.commit().await?;
    Ok(Json(json!({"settings":req})))
}

pub(crate) async fn report(State(app): State<App>, headers: HeaderMap) -> Result {
    report_for(&app, &headers, false).await
}
pub(crate) async fn me(State(app): State<App>, headers: HeaderMap) -> Result {
    report_for(&app, &headers, true).await
}
async fn report_for(app: &App, headers: &HeaderMap, own: bool) -> Result {
    let actor = auth::actor(app, headers).await?;
    if !own {
        actor.admin()?;
    }
    let mut conn = app.pool.acquire().await?;
    let rules: Rules = settings::read(&mut conn, "scheduler").await?;
    #[derive(sqlx::FromRow)]
    struct Row {
        id: Uuid,
        name: String,
        owner: String,
        admin: bool,
        autostart_schedule: Option<String>,
        ttl_ms: Option<i64>,
    }
    let rows=sqlx::query_as::<_,Row>("SELECT w.id,w.name,u.username AS owner,u.is_admin AS admin,w.autostart_schedule,w.ttl_ms FROM coder_rust.workspaces w JOIN coder_rust.users u ON u.id=w.owner_id WHERE NOT w.deleted AND ($1::uuid IS NULL OR w.owner_id=$1) ORDER BY u.username,w.name LIMIT 10000")
        .bind(if own {Some(actor.id)} else {None}).fetch_all(&mut *conn).await?;
    let count = rows.len();
    let mut exempt = 0;
    let mut workspaces = Vec::new();
    let mut noncompliant = Vec::new();
    for row in rows {
        let enforced = rules.exemption(&row.owner, row.admin).is_empty();
        if !enforced {
            exempt += 1;
        }
        let s = Schedule {
            autostart_schedule: row.autostart_schedule,
            ttl_ms: row.ttl_ms,
        };
        let problem = if enforced {
            rules.problem(&s, "both")?.unwrap_or_default()
        } else {
            String::new()
        };
        let value = json!({"id":row.id,"name":row.name,"owner":row.owner,"autostart_schedule":s.autostart_schedule,"ttl_ms":s.ttl_ms,"compliant":problem.is_empty(),"problem":problem});
        if !problem.is_empty() {
            noncompliant.push(value.clone());
        }
        workspaces.push(value);
    }
    if own {
        let reason = rules.exemption(&actor.username, actor.is_admin);
        let mut value = json!({"enforced":reason.is_empty(),"reason":reason,"mode":rules.mode,"maxActiveHours":rules.max_active_hours,"workspaces":workspaces});
        if rules.mode == Mode::Fixed {
            let mut fixed = json!(rules.fixed);
            let schedule = rules.fixed.schedule()?;
            fixed["autostart_schedule"] = json!(schedule.autostart_schedule);
            fixed["ttl_ms"] = json!(schedule.ttl_ms);
            value["fixed"] = fixed;
        }
        Ok(Json(value))
    } else {
        let users: Vec<String> = sqlx::query_scalar(
            "SELECT username FROM coder_rust.users ORDER BY username LIMIT 10000",
        )
        .fetch_all(&mut *conn)
        .await?;
        Ok(Json(
            json!({"settings":rules,"workspaces":count,"exempt":exempt,"noncompliant":noncompliant,"users":users,"fixedSchedule":rules.fixed.schedule()?,"generatedAt":Utc::now()}),
        ))
    }
}

pub(crate) async fn reconcile(pool: &PgPool) -> Result<usize> {
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT now()").fetch_one(pool).await?;
    let candidates:Vec<(Uuid,Uuid)>=sqlx::query_as("SELECT w.id,w.owner_id FROM coder_rust.workspaces w JOIN coder_rust.builds b ON b.id=w.latest_build_id WHERE NOT w.deleted AND ((b.status='running' AND b.deadline<=$1) OR (b.status='stopped' AND w.next_start_at<=$1)) ORDER BY w.id LIMIT 256")
        .bind(now).fetch_all(pool).await?;
    let mut queued = 0;
    for (id, owner) in candidates {
        let mut tx = pool.begin().await?;
        // Same lock order as manual builds and completion. Multiple replicas may
        // scan the same candidate; only one may consume its due occurrence.
        if sqlx::query("SELECT id FROM coder_rust.users WHERE id=$1 FOR UPDATE SKIP LOCKED")
            .bind(owner)
            .fetch_optional(&mut *tx)
            .await?
            .is_none()
        {
            continue;
        }
        let Some(w) = sqlx::query_as::<_, workspaces::Workspace>(&format!(
            "{} WHERE w.id=$1 AND NOT w.deleted FOR UPDATE OF w SKIP LOCKED",
            workspaces::WORKSPACE
        ))
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        else {
            continue;
        };
        let build = sqlx::query_as::<_, workspaces::Build>(
            "SELECT * FROM coder_rust.builds WHERE id=$1 FOR UPDATE",
        )
        .bind(w.latest_build_id)
        .fetch_one(&mut *tx)
        .await?;
        let transition = if build.status == "running" && build.deadline.is_some_and(|d| d <= now) {
            "stop"
        } else if build.status == "stopped" && w.next_start_at.is_some_and(|n| n <= now) {
            "start"
        } else {
            continue;
        };
        if transition == "start" {
            let next = Schedule {
                autostart_schedule: w.autostart_schedule.clone(),
                ttl_ms: w.ttl_ms,
            }
            .next(now)?;
            sqlx::query("UPDATE coder_rust.workspaces SET next_start_at=$1 WHERE id=$2")
                .bind(next)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            let allowed:bool=sqlx::query_scalar("SELECT coder_rust.permitted($1,$2,'workspace.start',$3,true) AND coder_rust.permitted($1,$2,'template.use',$4,true)")
                .bind(owner).bind(w.organization_id).bind(id).bind(w.template_id).fetch_one(&mut *tx).await?;
            if !allowed {
                tx.commit().await?;
                continue;
            }
            if let Err(error) = prepare(
                &mut tx,
                owner,
                Schedule {
                    autostart_schedule: w.autostart_schedule.clone(),
                    ttl_ms: w.ttl_ms,
                },
                "both",
            )
            .await
            {
                if !error.0.is_client_error() {
                    return Err(error);
                }
                tx.commit().await?;
                continue;
            }
        }
        if crate::state::metadata(&mut tx, id).await?.1 {
            tx.commit().await?;
            continue;
        }
        let mut version = build.template_version_id;
        let mut parameters = build.parameters.clone();
        if transition == "start" {
            let (active,required):(Uuid,bool)=sqlx::query_as("SELECT active_version_id,require_active_version FROM coder_rust.templates WHERE id=$1 AND NOT deleted FOR SHARE").bind(w.template_id).fetch_one(&mut *tx).await?;
            if required || w.automatic_updates == "always" {
                version = active;
            }
            match crate::catalog::validate_parameters(
                &mut tx,
                version,
                None,
                Some(parameters.clone()),
            )
            .await
            {
                Ok(value) => parameters = value,
                Err(error) if error.0.is_client_error() => {
                    sqlx::query("INSERT INTO coder_rust.build_logs(build_id,log_level,output) VALUES($1,'error','Autostart skipped: template parameters need attention.')").bind(build.id).execute(&mut *tx).await?;
                    tx.commit().await?;
                    continue;
                }
                Err(error) => return Err(error),
            }
            if let Err(error) = quotas::enforce(
                &mut tx,
                owner,
                Some(id),
                &parameters,
                Some(&build.parameters),
            )
            .await
            {
                if error.0.is_server_error() {
                    return Err(error);
                }
                sqlx::query("INSERT INTO coder_rust.build_logs(build_id,log_level,output) VALUES($1,'error','Autostart skipped: active template allocation exceeds quota.')").bind(build.id).execute(&mut *tx).await?;
                tx.commit().await?;
                continue;
            }
        }
        let next = Uuid::new_v4();
        workspaces::insert_build(
            &mut tx,
            next,
            w.organization_id,
            id,
            build.build_number + 1,
            version,
            transition,
            parameters,
            false,
        )
        .await?;
        let reason = if transition == "start" {
            "autostart"
        } else {
            "autostop"
        };
        sqlx::query("UPDATE coder_rust.builds SET reason=$1 WHERE id=$2")
            .bind(reason)
            .bind(next)
            .execute(&mut *tx)
            .await?;
        crate::rbac::audit(&mut tx, w.organization_id, owner, reason, Some(id)).await?;
        tx.commit().await?;
        queued += 1;
    }
    Ok(queued)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ttl_and_overnight_fixed_schedule() {
        for ms in [Some(-1), Some(59999), Some(2592060000)] {
            assert!(
                Schedule {
                    autostart_schedule: None,
                    ttl_ms: ms
                }
                .normalize()
                .is_err()
            );
        }
        assert_eq!(
            Schedule {
                autostart_schedule: None,
                ttl_ms: Some(60001)
            }
            .normalize()
            .unwrap()
            .ttl_ms,
            Some(60000)
        );
        assert_eq!(
            Schedule {
                autostart_schedule: None,
                ttl_ms: Some(0)
            }
            .normalize()
            .unwrap()
            .ttl_ms,
            None
        );
        let fixed = Fixed {
            start: "22:00".into(),
            stop: "06:00".into(),
            ..Fixed::default()
        };
        assert_eq!(fixed.schedule().unwrap().ttl_ms, Some(8 * 3600000));
        let mut rules = Rules {
            enabled: true,
            mode: Mode::Fixed,
            max_active_hours: Some(1.0),
            ..Rules::default()
        };
        assert!(rules.validate().is_err());
        assert!(!rules.exemption("admin", true).is_empty());
        assert!(rules.exemption("member", false).is_empty());
    }
}
