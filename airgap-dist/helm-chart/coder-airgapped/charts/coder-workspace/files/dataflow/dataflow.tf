# The DATAFLOW template's own part (the chart pushes it beside main.tf, and with scripts/apache_nifi.sh and
# scripts/apache_airflow.sh, for that template only): Apache NiFi and Apache Airflow in place of code-server (main.tf's
# code_server = false), with the built-in web terminal.

# NiFi shares the dashboard origin so its SAMEORIGIN policy permits workspace panels.
# Coder authenticates the request and supplies its app path in X-Forwarded-Prefix.
resource "coder_app" "nifi" {
  agent_id     = coder_agent.main.id
  slug         = "nifi"
  display_name = "Apache NiFi"
  icon         = "/__icons/nifi.svg" # files/icons/nifi.svg, served by templates/icons.yaml
  # The root: Coder joins the app URL's path to every request, and NiFi serves at /nifi and /nifi-api (its root
  # redirects to its UI, under the app's path).
  url       = "http://127.0.0.1:8080"
  subdomain = false
  share     = "owner"

  # The dashboard's panel shows the port and protocol it is checked on.
  healthcheck {
    url       = "http://127.0.0.1:8080/nifi-api/flow/about"
    interval  = 5
    threshold = 60
  }
}

# Application origins use the configured wildcard, which may differ from Coder's dashboard host.
variable "apps_wildcard_host" {
  type        = string
  description = "The configured Coder wildcard app hostname, including its leading *."
  default     = ""
  validation {
    condition     = var.apps_wildcard_host == "" || can(regex("^\\*\\.[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.apps_wildcard_host))
    error_message = "The app wildcard must be a hostname beginning with *. and must not contain a scheme, port or path."
  }
}

locals {
  app_port            = try(regex("^https?://[^/]+(:[0-9]+)(?:/|$)", data.coder_workspace.me.access_url)[0], "")
  app_scheme          = startswith(data.coder_workspace.me.access_url, "https://") ? "https" : "http"
  nifi_path           = "/@${data.coder_workspace_owner.me.name}/${data.coder_workspace.me.name}.main/apps/nifi"
  nifi_access_host    = trimsuffix(replace(replace(data.coder_workspace.me.access_url, "https://", ""), "http://", ""), "/")
  airflow_access_host = replace(var.apps_wildcard_host, "*", "airflow--main--${data.coder_workspace.me.name}--${data.coder_workspace_owner.me.name}")
}

# NiFi and Airflow at every start, each in a script of its own (the workspace's Logs show them by name): their homes
# in ~/.nifi and ~/airflow, with NiFi under the dashboard and Airflow on its app host.
resource "coder_script" "nifi" {
  agent_id     = coder_agent.main.id
  display_name = "Apache NiFi"
  icon         = "/__icons/nifi.svg" # files/icons/nifi.svg, served by templates/icons.yaml
  run_on_start = true
  script = templatefile("${path.module}/scripts/apache_nifi.sh", {
    path        = local.nifi_path
    access_host = local.nifi_access_host
  })
}

resource "coder_script" "airflow" {
  agent_id     = coder_agent.main.id
  display_name = "Apache Airflow"
  icon         = "/icon/airflow.svg" # Coder's own icon
  run_on_start = true
  script = templatefile("${path.module}/scripts/apache_airflow.sh", {
    path        = ""
    access_host = "${local.airflow_access_host}${local.app_port}"
    scheme      = local.app_scheme
  })
}

resource "coder_app" "airflow" {
  agent_id     = coder_agent.main.id
  slug         = "airflow"
  display_name = "Apache Airflow"
  icon         = "/icon/airflow.svg" # Coder's own icon
  # Airflow owns the root of its isolated application origin.
  url       = "http://localhost:8090/"
  subdomain = true
  share     = "owner"

  healthcheck {
    url       = "http://localhost:8090/api/v2/monitor/health"
    interval  = 5
    threshold = 60
  }
}

# Before 1.40.1 these were in main.tf with a count (one per DATAFLOW workspace): the same objects.
moved {
  from = coder_app.nifi[0]
  to   = coder_app.nifi
}

moved {
  from = coder_script.nifi[0]
  to   = coder_script.nifi
}

moved {
  from = coder_script.airflow[0]
  to   = coder_script.airflow
}

moved {
  from = coder_app.airflow[0]
  to   = coder_app.airflow
}

# Media is relayed by Coder; the guest serves only the authenticated signaling backend.
resource "coder_app" "neko" {
  count        = var.neko_browser ? 1 : 0
  agent_id     = coder_agent.main.id
  slug         = "neko"
  display_name = "N.eko"
  icon         = "/__icons/chromium.svg"
  url          = "http://127.0.0.1:9080"
  subdomain    = true
  share        = "owner"
  lifecycle {
    precondition {
      condition     = var.apps_wildcard_host != ""
      error_message = "N.eko requires the configured apps_wildcard_host."
    }
  }
  healthcheck {
    url       = "http://127.0.0.1:9080/health"
    interval  = 10
    threshold = 3
  }
}
