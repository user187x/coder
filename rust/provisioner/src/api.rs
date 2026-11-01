use crate::Error;
use reqwest::{
    Client, Url,
    header::{HeaderMap, HeaderValue},
};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::time::Duration;
use uuid::Uuid;

#[derive(Clone)]
pub(crate) struct Api {
    client: Client,
    root: Url,
}
impl Api {
    pub fn new(root: &str, token: String) -> Result<Self, Error> {
        let root = Url::parse(root).map_err(|_| Error::Config("Invalid control-plane URL."))?;
        let local = root.host_str().is_some_and(|h| {
            h == "localhost"
                || h.parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        });
        if root.host_str().is_none()
            || !root.username().is_empty()
            || root.password().is_some()
            || root.path() != "/"
            || root.query().is_some()
            || root.fragment().is_some()
            || !(root.scheme() == "https" || (root.scheme() == "http" && local))
        {
            return Err(Error::Config(
                "Use an HTTPS root URL, or loopback HTTP, without credentials or a path.",
            ));
        }
        if token.is_empty() {
            return Err(Error::Config("A provisioner token is required."));
        }
        let mut value = HeaderValue::from_str(&token)
            .map_err(|_| Error::Config("Invalid provisioner token."))?;
        value.set_sensitive(true);
        let mut headers = HeaderMap::new();
        headers.insert("Coder-Provisioner-Token", value);
        let client = Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| Error::Network)?;
        Ok(Self { client, root })
    }
    pub async fn post<T: DeserializeOwned>(&self, path: &str, body: Value) -> Result<T, Error> {
        let mut url = self.root.clone();
        url.set_path(&format!("/api/v2/provisioner/jobs/{path}"));
        if path == "claim" {
            url.set_query(Some("driver=terraform"));
        }
        let mut response = self
            .client
            .post(url)
            .json(&body)
            .send()
            .await
            .map_err(|_| Error::Network)?;
        if !response.status().is_success() {
            return Err(Error::Api(response.status().as_u16()));
        }
        let mut bytes = Vec::new();
        while let Some(part) = response.chunk().await.map_err(|_| Error::Network)? {
            if part.len() > 8 * 1024 * 1024 - bytes.len() {
                return Err(Error::Protocol("Control-plane response exceeds 8 MiB."));
            }
            bytes.extend_from_slice(&part);
        }
        serde_json::from_slice(&bytes)
            .map_err(|_| Error::Protocol("Invalid control-plane response."))
    }
    pub async fn log(&self, job: &Job, message: &str) -> Result<(), Error> {
        self.post::<Value>(&format!("{}/logs",job.id),json!({"lease_token":job.lease_token,"entries":[{"log_level":"info","output":message}]})).await?;
        Ok(())
    }
    pub async fn checkpoint(
        &self,
        job: &Job,
        state: &mut Snapshot,
        value: Value,
        dirty: bool,
    ) -> Result<(), Error> {
        let result: Revision = self.post(&format!("{}/state",job.id),json!({"lease_token":job.lease_token,"revision":state.revision,"state":value,"dirty":dirty})).await?;
        state.revision = result.revision;
        state.state = value;
        state.dirty = dirty;
        Ok(())
    }
}

#[derive(Deserialize)]
pub(crate) struct Job {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub workspace_id: Uuid,
    pub transition: String,
    pub provisioner_spec: Value,
    pub parameters: Vec<Parameter>,
    pub parameter_schema: Vec<Schema>,
    pub environment: std::collections::BTreeMap<String, String>,
    pub lease_token: String,
}
#[derive(Deserialize)]
pub(crate) struct Parameter {
    pub name: String,
    pub value: String,
}
#[derive(Deserialize)]
pub(crate) struct Schema {
    pub name: String,
    pub r#type: String,
}
#[derive(Deserialize)]
pub(crate) struct Snapshot {
    pub revision: i64,
    pub dirty: bool,
    pub state: Value,
}
#[derive(Deserialize)]
struct Revision {
    revision: i64,
}
