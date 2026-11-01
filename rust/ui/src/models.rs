//! Fields used by the Rust views, matching the corresponding `codersdk` JSON.

use serde::{Deserialize, Deserializer};

fn null_vec<'de, D, T>(de: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(de)?.unwrap_or_default())
}

#[derive(Deserialize)]
pub(crate) struct User {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub name: String,
    pub email: String,
    pub status: String,
    #[serde(default)]
    pub avatar_url: String,
    #[serde(default, deserialize_with = "null_vec")]
    pub roles: Vec<Role>,
}

#[derive(Deserialize)]
pub(crate) struct Role {
    pub name: String,
}

#[derive(Deserialize)]
pub(crate) struct UserList {
    #[serde(default, deserialize_with = "null_vec")]
    pub users: Vec<User>,
    pub count: usize,
}

#[derive(Deserialize)]
pub(crate) struct WorkspaceList {
    #[serde(default, deserialize_with = "null_vec")]
    pub workspaces: Vec<Workspace>,
    pub count: usize,
}

#[derive(Deserialize)]
pub(crate) struct Workspace {
    pub id: String,
    pub name: String,
    pub owner_name: String,
    pub template_display_name: String,
    pub template_name: String,
    pub latest_build: Build,
    pub favorite: bool,
    pub outdated: bool,
}

#[derive(Deserialize)]
pub(crate) struct Build {
    pub id: String,
    pub template_version_id: String,
    pub status: String,
    pub build_number: i32,
    #[serde(default, deserialize_with = "null_vec")]
    pub resources: Vec<Resource>,
}

#[derive(Deserialize)]
pub(crate) struct Resource {
    pub name: String,
    pub r#type: String,
    pub hide: bool,
    #[serde(default, deserialize_with = "null_vec")]
    pub agents: Vec<Agent>,
}

#[derive(Deserialize)]
pub(crate) struct Agent {
    pub name: String,
    pub status: String,
    pub operating_system: String,
    pub architecture: String,
}

#[derive(Deserialize)]
pub(crate) struct Template {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub organization_name: String,
    pub active_version_id: String,
    pub description: String,
    pub deprecated: bool,
    pub deprecation_message: String,
}

impl Template {
    pub fn title(&self) -> &str {
        if self.display_name.is_empty() {
            &self.name
        } else {
            &self.display_name
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct Parameter {
    pub name: String,
    #[serde(default)]
    pub display_name: String,
    pub description_plaintext: String,
    pub r#type: String,
    pub default_value: String,
    pub required: bool,
    #[serde(default, deserialize_with = "null_vec")]
    pub options: Vec<ParameterOption>,
}

#[derive(Deserialize)]
pub(crate) struct ParameterOption {
    pub name: String,
    pub value: String,
}

#[derive(Deserialize)]
pub(crate) struct Log {
    pub output: String,
    #[serde(rename = "log_level")]
    pub level: String,
    pub created_at: String,
}

#[derive(Deserialize)]
pub(crate) struct LoginResponse {
    pub session_token: String,
}

#[derive(Deserialize)]
pub(crate) struct AuthMethods {
    pub password: AuthMethod,
    #[serde(default)]
    pub terms_of_service_url: String,
}

#[derive(Deserialize)]
pub(crate) struct AuthMethod {
    pub enabled: bool,
}

#[derive(Deserialize)]
pub(crate) struct Secret {
    pub name: String,
    pub description: String,
    pub env_name: String,
    pub file_path: String,
    pub enabled: bool,
}
