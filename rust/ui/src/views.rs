use crate::{api::Api, models::*};
use maud::{DOCTYPE, Markup, html};
use std::collections::HashMap;

pub(crate) fn page(title: &str, user: Option<&User>, api: Option<&Api>, body: Markup) -> Markup {
    html! {
        (DOCTYPE)
        html lang="en" {
            head {
                meta charset="utf-8";
                meta name="viewport" content="width=device-width, initial-scale=1";
                title { (title) " | Coder" }
                link rel="stylesheet" href="/style.css";
            }
            body {
                a.skip href="#main" { "Skip to content" }
                header {
                    a.brand href="/workspaces" aria-label="Coder home" { span.mark aria-hidden="true" { "C" } "coder" }
                    @if let Some(user) = user {
                        nav aria-label="Main navigation" {
                            a href="/workspaces" { "Workspaces" }
                            a href="/templates" { "Templates" }
                            @if user.roles.iter().any(|r| matches!(r.name.as_str(), "owner" | "user-admin")) {
                                a href="/users" { "Users" }
                            }
                        }
                        div.session {
                            a href="/settings/account" { (user.username) }
                            form method="post" action="/logout" { button.quiet type="submit" { "Sign out" } }
                        }
                    }
                }
                main id="main" { (body) }
                footer {
                    span { "Coder workspace dashboard" }
                    @if let Some(api) = api.filter(|api| api.full_application) {
                        a href=(api.external(&[])) { "Open full application" }
                    }
                }
            }
        }
    }
}

fn alert(message: Option<&str>) -> Markup {
    html! { @if let Some(message) = message { div.alert role="alert" { (message) } } }
}

pub(crate) fn error(message: &str) -> Markup {
    page(
        "Request failed",
        None,
        None,
        html! {
            section.narrow { p.eyebrow { "REQUEST FAILED" } h1 { "Something needs attention" }
                (alert(Some(message))) a.button href="/workspaces" { "Back to workspaces" }
            }
        },
    )
}

pub(crate) fn login(api: &Api, auth: &AuthMethods, email: &str, message: Option<&str>) -> Markup {
    let terms = safe_http_url(&auth.terms_of_service_url);
    page(
        "Sign in",
        None,
        Some(api),
        html! {
            section.login {
                a.back href="/setup" { "First-time setup" }
                p.eyebrow { "YOUR DEVELOPMENT ENVIRONMENT" }
                h1 { "Welcome back" }
                p.muted { "Sign in to your Coder deployment." }
                (alert(message))
                @if auth.password.enabled {
                    form.stack method="post" action="/login" {
                        input type="hidden" name="method" value="password";
                        label for="email" { "Email or username" }
                        input id="email" name="email" value=(email) autocomplete="username" required;
                        label for="password" { "Password" }
                        input id="password" name="password" type="password" autocomplete="current-password" required;
                        @if let Some(terms) = &terms {
                            label.check { input type="checkbox" name="accept_terms" value="yes" required; "I accept the " a href=(terms) { "terms of service" } }
                        }
                        button.primary type="submit" { "Sign in" }
                    }
                } @else { p { "Password sign-in is disabled. Use an existing session token below." } }
                details {
                    summary { "Sign in with a session token" }
                    p.muted { "Use a token from your deployment. The token stays in an HTTP-only session cookie." }
                    form.stack method="post" action="/login" {
                        input type="hidden" name="method" value="token";
                        label for="token" { "Session token" }
                        input id="token" name="session_token" type="password" autocomplete="off" required;
                        @if let Some(terms) = &terms {
                            label.check { input type="checkbox" name="accept_terms" value="yes" required; "I accept the " a href=(terms) { "terms of service" } }
                        }
                        button type="submit" { "Use token" }
                    }
                }
            @if api.full_application { p.muted { "For SSO, first sign in through the " a href=(api.external(&["login"])) { "full application" } "." } }
            }
        },
    )
}

pub(crate) fn setup(api: &Api, values: &HashMap<String, String>, message: Option<&str>) -> Markup {
    page(
        "Initial setup",
        None,
        Some(api),
        html! {
            section.login {
                p.eyebrow { "WELCOME TO CODER" } h1 { "Create your first account" }
                p.muted { "This account administers the deployment. Setup closes after the first account is created." }
                (alert(message))
                form.stack method="post" action="/setup" {
                    @for (field, label, kind) in [("email", "Email", "email"), ("username", "Username", "text"), ("name", "Full name", "text")] {
                        label for=(field) { (label) }
                        input id=(field) name=(field) type=(kind) value=(values.get(field).map(String::as_str).unwrap_or_default()) required[field != "name"];
                    }
                    label for="password" { "Password" }
                    input id="password" name="password" type="password" minlength="12" maxlength="1024" autocomplete="new-password" required;
                    button.primary type="submit" { "Create account" }
                }
            }
        },
    )
}

pub(crate) fn workspaces(
    api: &Api,
    user: &User,
    data: &WorkspaceList,
    q: &str,
    offset: usize,
) -> Markup {
    page(
        "Workspaces",
        Some(user),
        Some(api),
        html! {
            div.heading { div { p.eyebrow { "DEVELOPMENT" } h1 { "Workspaces" } p.muted { "Your environments, ready when you are." } }
                a.button.primary href="/templates" { "Create workspace" }
            }
            form.search method="get" action="/workspaces" role="search" {
                label.sr for="search" { "Search workspaces" }
                input id="search" name="q" value=(q) placeholder="Search by name, owner, or status...";
                button type="submit" { "Search" }
                a.quiet href="/workspaces" { "Reset" }
            }
            div.table-wrap {
                table aria-label="Workspaces" {
                    thead { tr { th { "Workspace" } th { "Template" } th { "Status" } th { "Owner" } } }
                    tbody {
                        @for w in &data.workspaces {
                            tr {
                                td { a.strong href=(format!("/workspaces/{}", segment(&w.id))) { (w.name) } @if w.favorite { span.tag { "Favorite" } } }
                                td { @if w.template_display_name.is_empty() { (w.template_name) } @else { (w.template_display_name) } }
                                td { (status(&w.latest_build.status)) @if w.outdated { span.tag { "Update available" } } }
                                td { (w.owner_name) }
                            }
                        }
                    }
                }
                @if data.workspaces.is_empty() {
                    section.empty { h2 { "No workspaces found" } p.muted { "Try a different search, or create an environment from a template." } }
                }
            }
            (pagination("/workspaces", q, offset, data.workspaces.len(), data.count))
        },
    )
}

fn pagination(path: &str, q: &str, offset: usize, shown: usize, count: usize) -> Markup {
    let query = reqwest::Url::parse_with_params("http://localhost", [("q", q)])
        .expect("fixed URL")
        .query()
        .unwrap_or_default()
        .to_owned();
    html! {
        div.pagination { span.muted { (count) " total" }
            div.actions {
                @if offset > 0 { a.button href=(format!("{path}?{query}&offset={}", offset.saturating_sub(25))) { "Previous" } }
                @if offset.saturating_add(shown) < count { a.button href=(format!("{path}?{query}&offset={}", offset.saturating_add(25))) { "Next" } }
            }
        }
    }
}

fn status(value: &str) -> Markup {
    let class = match value {
        "running" | "connected" | "active" => "status good",
        "failed" | "suspended" => "status bad",
        _ => "status",
    };
    html! { span class=(class) { span.dot aria-hidden="true" {} (value) } }
}

fn action(id: &str, value: &str, text: &str) -> Markup {
    html! { form method="post" action=(format!("/workspaces/{}/actions", segment(id))) {
        input type="hidden" name="action" value=(value);
        button type="submit" { (text) }
    } }
}

pub(crate) fn workspace(
    api: &Api,
    user: &User,
    w: &Workspace,
    logs: &[Log],
    log_error: Option<&str>,
    message: Option<&str>,
) -> Markup {
    let full = api.external(&[&format!("@{}", w.owner_name), &w.name]);
    page(
        &w.name,
        Some(user),
        Some(api),
        html! {
            a.back href="/workspaces" { "Back to workspaces" }
            div.heading {
                div { p.eyebrow { (w.owner_name) " / " (w.template_name) } h1 { (w.name) } (status(&w.latest_build.status)) }
                div.actions {
                    (action(&w.id, "favorite", if w.favorite { "Unfavorite" } else { "Favorite" }))
                    @match w.latest_build.status.as_str() {
                    "running" => { (action(&w.id, "stop", "Stop")) (action(&w.id, "restart", "Restart on active version")) }
                        "stopped" | "failed" | "canceled" => { (action(&w.id, "start", "Start")) }
                        "starting" | "pending" | "stopping" => { (action(&w.id, "cancel", "Cancel build")) }
                        _ => {}
                    }
                @if api.full_application { a.button.primary href=(&full) { "Open workspace" } }
                }
            }
            (alert(message))
            div.notice { "Refresh to see the latest build status. " a href=(format!("/workspaces/{}", segment(&w.id))) { "Refresh now" } }
            section.panel {
                h2 { "Resources & agents" }
                @for resource in w.latest_build.resources.iter().filter(|r| !r.hide) {
                    div.resource { div { strong { (resource.name) } p.muted { (resource.r#type) } }
                        @for agent in &resource.agents {
                            div { strong { (agent.name) } " " (status(&agent.status))
                                p.muted { (agent.operating_system) " / " (agent.architecture) }
                            }
                        }
                    }
                }
                @if w.latest_build.resources.is_empty() { p.muted { "No resources reported for this build." } }
            @if api.full_application {
                p.muted { "Open the workspace for application links, the live terminal, and IDE connections." }
            } @else {
                p.muted { "Terminal, workspace application, and IDE connections are not yet implemented in the Rust core." }
            }
            }
            section.panel {
                div.heading.small { h2 { "Build logs" } span.muted { "Build #" (w.latest_build.build_number) } }
                (alert(log_error))
                @if logs.is_empty() { p.muted { "No logs available yet." } }
                pre.logs aria-label="Build logs" { @for log in logs { (log.created_at) " [" (log.level) "] " (log.output) "\n" } }
            }
            details.danger { summary { "Delete workspace" }
                p { "Deleting a workspace destroys the resources managed by its template." }
                a.button href=(format!("/workspaces/{}/delete", segment(&w.id))) { "Review deletion" }
            }
        },
    )
}

pub(crate) fn delete_workspace(
    api: &Api,
    user: &User,
    w: &Workspace,
    message: Option<&str>,
) -> Markup {
    page(
        "Delete workspace",
        Some(user),
        Some(api),
        html! {
            section.narrow { p.eyebrow { "DESTRUCTIVE ACTION" } h1 { "Delete " (w.name) "?" }
                p { "This queues a delete build. Resources managed by the template will be destroyed." }
                (alert(message))
                form.stack method="post" action=(format!("/workspaces/{}/delete", segment(&w.id))) {
                    label for="confirm" { "Type " strong { (w.name) } " to confirm" }
                    input id="confirm" name="name" autocomplete="off" required;
                    button.destructive type="submit" { "Delete workspace" }
                    a href=(format!("/workspaces/{}", segment(&w.id))) { "Cancel" }
                }
            }
        },
    )
}

pub(crate) fn templates(api: &Api, user: &User, templates: &[Template]) -> Markup {
    page(
        "Templates",
        Some(user),
        Some(api),
        html! {
            div.heading { div { p.eyebrow { "BUILD YOUR ENVIRONMENT" } h1 { "Templates" } p.muted { "Choose a starting point for your next workspace." } } }
            div.cards { @for t in templates {
                a.template-card href=(format!("/templates/{}", segment(&t.id))) {
                    p.eyebrow { (t.organization_name) } h2 { (t.title()) } p.muted { (t.description) }
                    @if t.deprecated { span.tag { "Deprecated" } } @else { span.card-link { "View template" } }
                }
            } }
            @if templates.is_empty() { section.empty { h2 { "No templates available" } p.muted { "Ask an administrator for access to a template." } } }
        },
    )
}

pub(crate) fn template(api: &Api, user: &User, t: &Template) -> Markup {
    page(
        t.title(),
        Some(user),
        Some(api),
        html! {
            a.back href="/templates" { "Back to templates" }
            div.heading { div { p.eyebrow { (t.organization_name) } h1 { (t.title()) } p.muted { (t.description) } }
                @if !t.deprecated { a.button.primary href=(format!("/templates/{}/workspace", segment(&t.id))) { "Create workspace" } }
            }
            @if t.deprecated { (alert(Some(&t.deprecation_message))) }
            section.panel { h2 { "Template details" } p { "Name: " (t.name) } p { "Organization: " (t.organization_name) }
            @if api.full_application { a href=(api.external(&["templates", &t.organization_name, &t.name])) { "Open template documentation and settings" } }
            }
        },
    )
}

pub(crate) fn new_workspace(
    api: &Api,
    user: &User,
    t: &Template,
    params: &[Parameter],
    values: &HashMap<String, String>,
    message: Option<&str>,
) -> Markup {
    page(
        "Create workspace",
        Some(user),
        Some(api),
        html! {
            section.form-page {
                a.back href=(format!("/templates/{}", segment(&t.id))) { "Back to template" }
                p.eyebrow { (t.title()) } h1 { "Create workspace" }
                (alert(message))
                form.stack method="post" action=(format!("/templates/{}/workspace", segment(&t.id))) {
                    label for="name" { "Workspace name" }
                    input id="name" name="name" value=(values.get("name").map(String::as_str).unwrap_or_default()) pattern="[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*" maxlength="32" required;
                    input type="hidden" name="version" value=(&t.active_version_id);
                    @for (index, p) in params.iter().enumerate() {
                        @let field = format!("parameter_{index}");
                        @let value = values.get(&field).unwrap_or(&p.default_value);
                        label for=(&field) { @if p.display_name.is_empty() { (p.name) } @else { (p.display_name) } }
                        @if !p.options.is_empty() {
                            select id=(&field) name=(&field) required[p.required] {
                                @if p.required && value.is_empty() { option value="" selected disabled { "Choose an option" } }
                                @for option in &p.options { option value=(&option.value) selected[&option.value == value] { (option.name) } }
                            }
                        } @else if p.r#type == "bool" {
                            select id=(&field) name=(&field) { option value="true" selected[value == "true"] { "True" } option value="false" selected[value != "true"] { "False" } }
                        } @else {
                            input id=(&field) name=(&field) type=(if p.r#type == "number" { "number" } else { "text" }) step="any" value=(value) required[p.required];
                        }
                        p.hint { (p.description_plaintext) @if p.r#type == "list(string)" { " Enter a JSON array of strings." } }
                    }
                    button.primary type="submit" { "Create workspace" }
                }
            }
        },
    )
}

pub(crate) fn account(
    api: &Api,
    user: &User,
    username: &str,
    name: &str,
    message: Option<&str>,
) -> Markup {
    page(
        "Account",
        Some(user),
        Some(api),
        html! {
            section.form-page { (settings_nav()) h1 { "Account" } p.muted { (user.email) }
                (alert(message))
                form.stack method="post" action="/settings/account" {
                    label for="username" { "Username" } input id="username" name="username" value=(username) maxlength="32" required;
                    label for="name" { "Full name" } input id="name" name="name" value=(name) maxlength="128";
                    button.primary type="submit" { "Save profile" }
                }
            }
        },
    )
}

fn settings_nav() -> Markup {
    html! { nav.tabs aria-label="Account settings" { a href="/settings/account" { "Profile" } a href="/settings/secrets" { "Secrets" } } }
}

pub(crate) fn secrets(
    api: &Api,
    user: &User,
    secrets: &[Secret],
    values: &HashMap<String, String>,
    message: Option<&str>,
    file_delivery: bool,
) -> Markup {
    page(
        "Secrets",
        Some(user),
        Some(api),
        html! {
            (settings_nav()) h1 { "Secrets" } p.muted { "Credentials for your workspace environments. Stored values are never shown." }
            (alert(message))
            div.table-wrap { table aria-label="User secrets" {
                thead { tr { th { "Name" } th { "Destination" } th { "Status" } } }
                tbody { @for secret in secrets { tr {
                    td { strong { (secret.name) } p.muted { (secret.description) } }
                    td { (secret.env_name) @if !secret.file_path.is_empty() { br; (secret.file_path) } }
                    td { @if secret.enabled { "Enabled" } @else { "Disabled" } }
                } } }
            } @if secrets.is_empty() { section.empty { "No secrets stored yet." } } }
            section.panel.form-page { h2 { "Add secret" }
                form.stack method="post" action="/settings/secrets" {
                    @for (field, label) in [("name", "Name"), ("description", "Description"), ("env_name", "Environment variable")] {
                        label for=(field) { (label) }
                        input id=(field) name=(field) value=(values.get(field).map(String::as_str).unwrap_or_default()) required[field == "name"];
                    }
                    label for="value" { "Value" } textarea id="value" name="value" autocomplete="off" required {}
                    @if file_delivery { label for="file_path" { "File path (optional)" } input id="file_path" name="file_path" value=(values.get("file_path").map(String::as_str).unwrap_or_default()) placeholder="~/.credentials"; }
                    label.check { input type="checkbox" name="enabled" value="yes" checked[values.get("enabled").is_none_or(|v| v == "yes")]; "Inject into workspaces" }
                    button.primary type="submit" { "Add secret" }
                }
            }
        },
    )
}

pub(crate) fn users(api: &Api, user: &User, data: &UserList, q: &str, offset: usize) -> Markup {
    page(
        "Users",
        Some(user),
        Some(api),
        html! {
            h1 { "Users" }
            form.search method="get" action="/users" role="search" {
                label.sr for="search" { "Search users" } input id="search" name="q" value=(q) placeholder="Search users..."; button type="submit" { "Search" }
            }
            div.table-wrap { table aria-label="Users" {
                thead { tr { th { "Username" } th { "Name" } th { "Email" } th { "Status" } } }
                tbody { @for u in &data.users { tr { td { (u.username) } td { (u.name) } td { (u.email) } td { (status(&u.status)) } } } }
            } @if data.users.is_empty() { section.empty { "No users found." } } }
            (pagination("/users", q, offset, data.users.len(), data.count))
        },
    )
}

fn safe_http_url(value: &str) -> Option<String> {
    reqwest::Url::parse(value)
        .ok()
        .filter(|u| matches!(u.scheme(), "http" | "https") && u.host_str().is_some())
        .map(|u| u.to_string())
}

pub(crate) fn segment(value: &str) -> String {
    let mut url = reqwest::Url::parse("http://localhost").expect("fixed URL");
    url.path_segments_mut()
        .expect("fixed URL")
        .clear()
        .push(value);
    url.path()[1..].to_owned()
}
