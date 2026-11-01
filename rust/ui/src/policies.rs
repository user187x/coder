use crate::{
    api::{Api, UiError},
    models::{User, Workspace},
    views,
};
use axum::{
    Form,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
};
use maud::{Markup, html};
use reqwest::Method;
use serde_json::{Value, json};
use std::collections::HashMap;
type Result<T = Response> = std::result::Result<T, UiError>;
const LIMITS: [(&str, &str); 4] = [
    ("workspaces", "Workspaces"),
    ("cpu", "CPU cores"),
    ("memory", "Memory (GiB)"),
    ("disk", "Disk (GB)"),
];

fn text<'a>(form: &'a HashMap<String, String>, key: &str) -> &'a str {
    form.get(key).map(String::as_str).unwrap_or_default()
}
fn number(raw: &str) -> Result<Value> {
    if raw.is_empty() {
        return Ok(Value::Null);
    }
    let value = raw
        .parse::<f64>()
        .map_err(|_| UiError::bad_request("Enter a number, or leave the limit empty."))?;
    if !value.is_finite() {
        return Err(UiError::bad_request("Enter a finite number."));
    }
    Ok(json!(value))
}
pub(crate) fn schedule_values(values: &HashMap<String, String>) -> Result<Value> {
    let schedule = text(values, "autostart_schedule").trim();
    let raw = text(values, "ttl_minutes");
    let ttl = if raw.is_empty() {
        None
    } else {
        let minutes = raw
            .parse::<i64>()
            .map_err(|_| UiError::bad_request("Autostop must be a whole number of minutes."))?;
        Some(
            minutes
                .checked_mul(60000)
                .ok_or_else(|| UiError::bad_request("Autostop is too large."))?,
        )
    };
    Ok(json!({"autostart_schedule":if schedule.is_empty(){None}else{Some(schedule)},"ttl_ms":ttl}))
}
pub(crate) fn schedule_fields(values: &HashMap<String, String>) -> Markup {
    html! {
        label for="autostart_schedule" { "Automatic start" }
        input id="autostart_schedule" name="autostart_schedule" value=(text(values,"autostart_schedule")) maxlength="256" placeholder="CRON_TZ=America/New_York 0 9 * * MON-FRI";
        p.hint { "Weekly cron: minute, hour, *, *, weekdays. Leave empty to disable. Times use UTC unless CRON_TZ names an IANA time zone." }
        label for="ttl_minutes" { "Stop after (minutes)" }
        input id="ttl_minutes" name="ttl_minutes" type="number" min="1" max="43200" step="1" value=(text(values,"ttl_minutes")) placeholder="480";
        p.hint { "Leave empty to disable automatic stop. Administrators may require a start and stop schedule." }
    }
}

async fn schedule_page(
    api: &Api,
    headers: &HeaderMap,
    id: &str,
    message: Option<&str>,
    submitted: Option<&HashMap<String, String>>,
) -> Result {
    let user: User = api.get(headers, &["users", "me"], &[]).await?;
    let w: Workspace = api.get(headers, &["workspaces", id], &[]).await?;
    if !w.can("schedule") {
        return Err(UiError::new(
            StatusCode::FORBIDDEN,
            "You cannot change this workspace's schedule.",
        ));
    }
    let mut values = HashMap::new();
    values.insert(
        "autostart_schedule".into(),
        w.autostart_schedule.clone().unwrap_or_default(),
    );
    values.insert(
        "ttl_minutes".into(),
        w.ttl_ms
            .map(|ms| (ms / 60000).to_string())
            .unwrap_or_default(),
    );
    if let Some(submitted) = submitted {
        values.extend(submitted.clone());
    }
    Ok(crate::html(views::page(
        "Workspace schedule",
        Some(&user),
        Some(api),
        html! {
            section.form-page {
                a.back href=(format!("/workspaces/{}",views::segment(id))) {"Back to workspace"}
                h1 {(w.name) " schedule"}
                @if let Some(message)=message {div.alert role="alert" {(message)}}
                form.stack method="post" action=(format!("/workspaces/{}/settings/schedule",views::segment(id))) {
                    (schedule_fields(&values)) button.primary type="submit" {"Save schedule"}
                }
                p.muted {"Schedule changes apply to future starts. The running build keeps its current deadline."}
                @if let Some(next)=&w.next_start_at {p {"Next start: " (next)}}
                @if let Some(deadline)=&w.latest_build.deadline {
                    p {"Current stop deadline: " (deadline)}
                    form.stack method="post" action=(format!("/workspaces/{}/extend",views::segment(id))) {
                        label for="deadline" {"New stop deadline (RFC 3339, including time zone)"}
                        input id="deadline" name="deadline" required placeholder="2026-11-01T18:00:00Z";
                        button type="submit" {"Update deadline"}
                    }
                }
            }
        },
    )))
}
pub(crate) async fn workspace_schedule(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result {
    schedule_page(&api, &headers, &id, None, None).await
}
pub(crate) async fn named_schedule(
    State(api): State<Api>,
    headers: HeaderMap,
    Path((owner, name)): Path<(String, String)>,
) -> Result {
    let w: Workspace = api
        .get(
            &headers,
            &[
                "users",
                owner.strip_prefix('@').unwrap_or(&owner),
                "workspace",
                &name,
            ],
            &[],
        )
        .await?;
    schedule_page(&api, &headers, &w.id, None, None).await
}
pub(crate) async fn save_schedule(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Form(values): Form<HashMap<String, String>>,
) -> Result {
    let body = schedule_values(&values)?;
    let result: Result<Value> = api
        .send(
            &headers,
            Method::PUT,
            &["workspaces", &id, "schedule"],
            &body,
        )
        .await;
    if let Err(error) = result {
        return Ok((
            error.status,
            schedule_page(&api, &headers, &id, Some(&error.message), Some(&values)).await?,
        )
            .into_response());
    }
    Ok(Redirect::to(&format!(
        "/workspaces/{}/settings/schedule",
        views::segment(&id)
    ))
    .into_response())
}
pub(crate) async fn extend(
    State(api): State<Api>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Form(values): Form<HashMap<String, String>>,
) -> Result {
    let result: Result<Value> = api
        .send(
            &headers,
            Method::PUT,
            &["workspaces", &id, "extend"],
            &json!({"deadline":text(&values,"deadline")}),
        )
        .await;
    if let Err(error) = result {
        return Ok((
            error.status,
            schedule_page(&api, &headers, &id, Some(&error.message), None).await?,
        )
            .into_response());
    }
    Ok(Redirect::to(&format!(
        "/workspaces/{}/settings/schedule",
        views::segment(&id)
    ))
    .into_response())
}

pub(crate) async fn personal(State(api): State<Api>, headers: HeaderMap) -> Result {
    let user: User = api.get(&headers, &["users", "me"], &[]).await?;
    let quota: Value = api.get(&headers, &["users", "me", "quota"], &[]).await?;
    let scheduler: Value = api
        .get(&headers, &["users", "me", "scheduler"], &[])
        .await?;
    Ok(crate::html(views::page(
        "Schedule and quota",
        Some(&user),
        Some(&api),
        html! {
            h1 {"Schedule and quota"}
            (usage(&quota))
            section.panel { h2 {"Workspace schedules"}
                @if scheduler["enforced"]==true {p {"A start and stop schedule is required. Mode: " (scheduler["mode"].as_str().unwrap_or("user"))}}
                @for w in scheduler["workspaces"].as_array().into_iter().flatten() {
                    div.resource {a href=(format!("/workspaces/{}/settings/schedule",views::segment(w["id"].as_str().unwrap_or_default()))) {(w["name"].as_str().unwrap_or_default())}
                        @if w["compliant"]==false {span.status.bad {(w["problem"].as_str().unwrap_or_default())}} @else {span.muted {"Schedule accepted"}}
                    }
                }
            }
        },
    )))
}
fn usage(report: &Value) -> Markup {
    html! {section.panel {h2 {"Allocation"}
        @if report["exempt"]==true {p.muted {"Administrators are exempt from quota limits."}}
        div.table-wrap {table {thead {tr {th {"Resource"} th {"Allocated"} th {"Limit"}}}
            tbody {@for (key,label) in LIMITS {tr {td {(label)} td {(report["usage"][key].as_f64().unwrap_or(0.0))}
                td {@if let Some(limit)=report["limits"][key].as_f64() {(limit)} @else {"Unlimited"}}
            }}}
        }}
    }}
}

async fn admin_page(api: &Api, headers: &HeaderMap, message: Option<&str>) -> Result {
    let user: User = api.get(headers, &["users", "me"], &[]).await?;
    let quota: Value = api.get(headers, &["deployment", "quota"], &[]).await?;
    let scheduler: Value = api.get(headers, &["deployment", "scheduler"], &[]).await?;
    let q = &quota["settings"];
    let s = &scheduler["settings"];
    Ok(crate::html(views::page(
        "User quota",
        Some(&user),
        Some(api),
        html! {
            h1 {"User quota"}
            @if let Some(message)=message {div.alert role="alert" {(message)}}
            section.panel.form-page {h2 {"Default limits"}
                form.stack method="post" action="/health/user-quota" {
                    input type="hidden" name="action" value="quota";
                    @for (key,label) in LIMITS {
                        label for=(key) {(label)} input id=(key) name=(key) type="number" min="0" max="1000000" step=(if key=="workspaces" {"1"} else {"any"}) value=(q["default"][key].as_f64().map(|n|n.to_string()).unwrap_or_default()) placeholder="Unlimited";
                        @if key!="workspaces" {label for=(format!("mode_{key}")) {(label) " limit applies to"}
                            select id=(format!("mode_{key}")) name=(format!("mode_{key}")) {option value="cumulative" selected[q["resourceModes"][key]!="instance"] {"All of a user's workspaces"} option value="instance" selected[q["resourceModes"][key]=="instance"] {"Each workspace"}}
                        }
                    }
                    label.check {input type="checkbox" name="exempt_admins" value="yes" checked[q["exemptAdmins"]==true]; "Exempt administrators"}
                    button.primary type="submit" {"Save default limits"}
                }
            }
            section.panel.form-page {h2 {"User override"}
                form.stack method="post" action="/health/user-quota" {
                    input type="hidden" name="action" value="user_quota";
                    label for="quota_user" {"User"} select id="quota_user" name="user" required {
                        @for user in quota["users"].as_array().into_iter().flatten() {option value=(user["username"].as_str().unwrap_or_default()) {(user["username"].as_str().unwrap_or_default())}}
                    }
                    @for (key,label) in LIMITS {
                        label for=(format!("policy_{key}")) {(label)}
                        select id=(format!("policy_{key}")) name=(format!("policy_{key}")) {option value="inherit" {"Use default"} option value="unlimited" {"Unlimited"} option value="limit" {"Set a limit"}}
                        label.sr for=(format!("limit_{key}")) {(label) " override value"}
                        input id=(format!("limit_{key}")) name=(key) type="number" min="0" max="1000000" step=(if key=="workspaces" {"1"} else {"any"});
                    }
                    p.hint {"This replaces the selected user's overrides for all four resources."}
                    button type="submit" {"Save user override"}
                }
            }
            section.panel {h2 {"Current allocation"}
                div.table-wrap {table {thead {tr {th {"User"} @for (_,label) in LIMITS {th {(label) " used / limit"}}}}
                    tbody {@for user in quota["users"].as_array().into_iter().flatten() {tr {
                        td {(user["username"].as_str().unwrap_or_default())}
                        @for (key,_) in LIMITS {td {(user["usage"][key].as_f64().unwrap_or(0.0)) " / " @if let Some(limit)=user["limits"][key].as_f64() {(limit)} @else {"Unlimited"}}}
                    }}}
                }}
            }
            section.panel.form-page {h2 {"Global Workspace Scheduler"}
                form.stack method="post" action="/health/user-quota" {
                    input type="hidden" name="action" value="scheduler";
                    label.check {input type="checkbox" name="enabled" value="yes" checked[s["enabled"]==true]; "Require workspace schedules"}
                    label for="scheduler_mode" {"Schedule"} select id="scheduler_mode" name="mode" {option value="user" selected[s["mode"]!="fixed"] {"Users choose"} option value="fixed" selected[s["mode"]=="fixed"] {"Administrator sets for everyone"}}
                    label for="fixed_start" {"Fixed start"} input id="fixed_start" name="start" type="time" value=(s["fixed"]["start"].as_str().unwrap_or("08:00")) required;
                    label for="fixed_stop" {"Fixed stop"} input id="fixed_stop" name="stop" type="time" value=(s["fixed"]["stop"].as_str().unwrap_or("18:00")) required;
                    fieldset {legend {"Fixed schedule weekdays"}
                        @for (day,label) in [(1,"Monday"),(2,"Tuesday"),(3,"Wednesday"),(4,"Thursday"),(5,"Friday"),(6,"Saturday"),(0,"Sunday")] {
                            label.check {input type="checkbox" name=(format!("day_{day}")) value="yes" checked[s["fixed"]["days"].as_array().is_some_and(|days|days.contains(&json!(day)))]; (label)}
                        }
                    }
                    label for="timezone" {"Time zone"} input id="timezone" name="timezone" value=(s["fixed"]["timezone"].as_str().unwrap_or("UTC")) required;
                    label for="maximum_hours" {"Maximum active hours"} input id="maximum_hours" name="max_hours" type="number" min="0.5" max="168" step="any" value=(s["maxActiveHours"].as_f64().map(|v|v.to_string()).unwrap_or_default()) placeholder="Unlimited";
                    label.check {input type="checkbox" name="ignore_admins" value="yes" checked[s["ignoreAdmins"]==true]; "Exempt administrators"}
                    label for="excluded_users" {"Excluded usernames, separated by spaces"}
                    textarea id="excluded_users" name="excluded_users" {(s["excludedUsers"].as_array().into_iter().flatten().filter_map(Value::as_str).collect::<Vec<_>>().join(" "))}
                    button.primary type="submit" {"Save scheduler"}
                }
                p.muted {"Existing schedules are listed below if they need correction. Running builds retain their current deadlines."}
            }
            section.panel {h2 {"Schedules requiring attention"}
                @for w in scheduler["noncompliant"].as_array().into_iter().flatten() {
                    div.resource {a href=(format!("/workspaces/{}/settings/schedule",views::segment(w["id"].as_str().unwrap_or_default()))) {(w["owner"].as_str().unwrap_or_default()) "/" (w["name"].as_str().unwrap_or_default())} span {(w["problem"].as_str().unwrap_or_default())}}
                }
            }
        },
    )))
}
pub(crate) async fn admin(State(api): State<Api>, headers: HeaderMap) -> Result {
    admin_page(&api, &headers, None).await
}
pub(crate) async fn save_admin(
    State(api): State<Api>,
    headers: HeaderMap,
    Form(form): Form<HashMap<String, String>>,
) -> Result {
    let action = text(&form, "action");
    let endpoint = if action == "scheduler" {
        "scheduler"
    } else {
        "quota"
    };
    let report: Value = api.get(&headers, &["deployment", endpoint], &[]).await?;
    let mut settings = report["settings"].clone();
    match action {
        "quota" => {
            for (key, _) in LIMITS {
                settings["default"][key] = number(text(&form, key))?;
                if key != "workspaces" {
                    settings["resourceModes"][key] = json!(text(&form, &format!("mode_{key}")));
                }
            }
            settings["exemptAdmins"] = json!(text(&form, "exempt_admins") == "yes");
        }
        "user_quota" => {
            let mut own = serde_json::Map::new();
            for (key, _) in LIMITS {
                match text(&form, &format!("policy_{key}")) {
                    "inherit" => {}
                    "unlimited" => {
                        own.insert(key.into(), Value::Null);
                    }
                    "limit" => {
                        if text(&form, key).is_empty() {
                            return Err(UiError::bad_request("Enter each selected limit."));
                        }
                        own.insert(key.into(), number(text(&form, key))?);
                    }
                    _ => return Err(UiError::bad_request("Unknown quota override policy.")),
                }
            }
            settings["users"][text(&form, "user")] = Value::Object(own);
        }
        "scheduler" => {
            settings = json!({"enabled":text(&form,"enabled")=="yes","mode":text(&form,"mode"),"fixed":{"start":text(&form,"start"),"stop":text(&form,"stop"),"days":(0..7).filter(|d|text(&form,&format!("day_{d}"))=="yes").collect::<Vec<_>>(),"timezone":text(&form,"timezone")},"maxActiveHours":number(text(&form,"max_hours"))?,"ignoreAdmins":text(&form,"ignore_admins")=="yes","excludedUsers":text(&form,"excluded_users").split_whitespace().collect::<Vec<_>>()});
        }
        _ => return Err(UiError::bad_request("Unknown policy action.")),
    }
    let result: Result<Value> = api
        .send(&headers, Method::POST, &["deployment", endpoint], &settings)
        .await;
    if let Err(error) = result {
        return Ok((
            error.status,
            admin_page(&api, &headers, Some(&error.message)).await?,
        )
            .into_response());
    }
    Ok(Redirect::to("/health/user-quota").into_response())
}
