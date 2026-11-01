use axum::{
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Redirect, Response},
};
use reqwest::{Client, Method, Url};
use serde::{Serialize, de::DeserializeOwned};
use std::time::Duration;

#[derive(Clone)]
pub(crate) struct Api {
    client: Client,
    pub backend: Url,
    pub origin: Url,
    pub full_application: bool,
}

impl Api {
    pub fn new(backend: Url, origin: Url) -> Result<Self, reqwest::Error> {
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(20))
            .build()?;
        Ok(Self {
            client,
            backend,
            origin,
            full_application: true,
        })
    }

    pub fn external(&self, segments: &[&str]) -> String {
        let mut url = self.backend.clone();
        url.path_segments_mut()
            .expect("HTTP root URL")
            .clear()
            .extend(segments);
        url.to_string()
    }

    pub async fn get<T: DeserializeOwned>(
        &self,
        headers: &HeaderMap,
        segments: &[&str],
        query: &[(&str, String)],
    ) -> Result<T, UiError> {
        self.request::<T, ()>(headers, Method::GET, segments, query, None)
            .await
    }

    pub async fn send<T: DeserializeOwned, B: Serialize>(
        &self,
        headers: &HeaderMap,
        method: Method,
        segments: &[&str],
        body: &B,
    ) -> Result<T, UiError> {
        self.request(headers, method, segments, &[], Some(body))
            .await
    }

    pub async fn list<T: DeserializeOwned>(
        &self,
        headers: &HeaderMap,
        segments: &[&str],
    ) -> Result<Vec<T>, UiError> {
        Ok(self
            .get::<Option<Vec<T>>>(headers, segments, &[])
            .await?
            .unwrap_or_default())
    }

    async fn request<T: DeserializeOwned, B: Serialize>(
        &self,
        headers: &HeaderMap,
        method: Method,
        segments: &[&str],
        query: &[(&str, String)],
        body: Option<&B>,
    ) -> Result<T, UiError> {
        let mut url = self.backend.clone();
        url.path_segments_mut()
            .expect("HTTP root URL")
            .clear()
            .extend(["api", "v2"])
            .extend(segments);
        let mut request = self.client.request(method, url).query(query);
        if let Some(token) = session(headers) {
            request = request.header("Coder-Session-Token", token);
        }
        if let Some(body) = body {
            request = request.json(body);
        }
        let mut response = request.send().await.map_err(|_| {
            UiError::new(
                StatusCode::BAD_GATEWAY,
                "The Coder API could not be reached. Check CODER_UI_BACKEND and try again.",
            )
        })?;
        let status = response.status();
        const MAX_BYTES: usize = 8 * 1024 * 1024;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| {
            UiError::new(StatusCode::BAD_GATEWAY, "The API response was interrupted.")
        })? {
            if chunk.len() > MAX_BYTES - bytes.len() {
                return Err(UiError::new(
                    StatusCode::BAD_GATEWAY,
                    "The API response exceeded the UI size limit.",
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        if !status.is_success() {
            let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
            let message = body
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("The Coder API rejected this request.");
            let detail = body
                .get("detail")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let mut message = format!("{message} {detail}").trim().to_owned();
            if let Some(validations) = body.get("validations").and_then(|v| v.as_array()) {
                for validation in validations {
                    if let (Some(field), Some(detail)) =
                        (validation["field"].as_str(), validation["detail"].as_str())
                    {
                        message.push_str(&format!(" {field}: {detail}"));
                    }
                }
            }
            return Err(UiError::new(
                if status.is_client_error() {
                    status
                } else {
                    StatusCode::BAD_GATEWAY
                },
                message,
            ));
        }
        serde_json::from_slice(if bytes.is_empty() { b"null" } else { &bytes }).map_err(|_| {
            UiError::new(
                StatusCode::BAD_GATEWAY,
                "The Coder API returned an unexpected response format.",
            )
        })
    }
}

pub(crate) fn session(headers: &HeaderMap) -> Option<&str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|part| part.trim().split_once('='))
        .find_map(|(name, token)| {
            (name == crate::COOKIE_NAME && !token.is_empty()).then_some(token)
        })
}

#[derive(Debug)]
pub(crate) struct UiError {
    pub status: StatusCode,
    pub message: String,
}

impl UiError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }
}

impl IntoResponse for UiError {
    fn into_response(self) -> Response {
        if self.status == StatusCode::UNAUTHORIZED {
            return Redirect::to("/login").into_response();
        }
        (
            self.status,
            axum::response::Html(crate::views::error(&self.message).into_string()),
        )
            .into_response()
    }
}
