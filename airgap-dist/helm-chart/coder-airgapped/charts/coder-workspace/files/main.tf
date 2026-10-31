terraform {
  required_providers {
    coder = {
      source = "coder/coder"
    }
    kubectl = {
      source  = "alekc/kubectl"
      version = "=2.4.1"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "=3.4.0"
    }
  }
}

provider "coder" {}

variable "use_kubeconfig" {
  type        = bool
  description = "Use host kubeconfig? (true/false)"
  default     = false
}

# The StorageClass of workspaces' home volumes ("" = the cluster's default). EKS clusters may have no default class:
# set it (coder-workspace.storageClass in the chart). Only new volumes use it: a volume's class never changes.
variable "home_storage_class" {
  type        = string
  description = "StorageClass of the home volumes (empty: the cluster's default)."
  default     = ""
}

variable "namespace" {
  type        = string
  description = "The Kubernetes namespace to create workspaces in: the platform's own (the template push sets it)."
  default     = "coder"
  validation {
    condition     = can(regex("^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$", var.namespace))
    error_message = "The namespace must be a Kubernetes namespace name (a DNS label)."
  }
}

# Admins' kubectl and k9s on this cluster (global.clusterAccess in the chart): each admin signs in as themselves with
# Keycloak's device login (kubelogin), so the cluster sees the person (keycloak:<user>).
# The workspace holds no long-lived credential; the sign-in lasts as long as the Keycloak session. "" = off.
variable "cluster_oidc_issuer" {
  type        = string
  description = "Keycloak issuer URL the cluster trusts for admins' kubectl sign-in (\"\" = off)."
  default     = ""
}

variable "cluster_oidc_client_id" {
  type        = string
  description = "Keycloak client of the kubectl sign-in (public, device login)."
  default     = "kubernetes"
}

variable "cluster_admin_roles" {
  type        = string
  description = "Coder roles (comma-separated) whose workspaces get the cluster kubeconfig."
  default     = "owner"
}

# code-server, the IDE in the browser: its app and the agent's own; false for a template whose apps take its place
# (one pushed with apps of its own beside this file).
variable "code_server" {
  type        = bool
  description = "The code-server app (the IDE in the browser)."
  default     = true
}

# The Memory parameter's default, in GB (one of its options): more for a template whose apps need it.
variable "default_memory" {
  type        = string
  description = "The Memory parameter's default, in GB."
  default     = "2"
}

# The apps a template made in Templates > Create new template has (its Desktop, File Browser and Terminal choices):
# the desktop (noVNC, and its X session), File Browser, and the dashboard's web terminal.
variable "desktop" {
  type        = bool
  description = "The Desktop app: the workspace's desktop in the browser (noVNC)."
  default     = true
}

variable "neko_browser" {
  type        = bool
  description = "Use the platform-controlled N.eko browser in Dataflow workspaces."
  default     = false
  validation {
    condition     = !var.neko_browser || fileexists("${path.module}/dataflow.tf")
    error_message = "N.eko is supported only by the Dataflow template."
  }
}

variable "file_browser" {
  type        = bool
  description = "The File Browser app."
  default     = true
}

variable "terminal" {
  type        = bool
  description = "The web terminal."
  default     = true
}

# The owner's Cloud Drive (the chart's userStorage): their own S3 storage, the same in each of their workspaces. The platform
# service makes each account's volume (PersistentVolumeClaim coder-safe-<owner id>); the pod waits for it if it is not
# there yet.
variable "user_storage" {
  type        = bool
  description = "Mount the owner's Cloud Drive (their own storage, S3) in the workspace."
  default     = false
}

variable "user_storage_path" {
  type        = string
  description = "Where the Cloud Drive is in the workspace (a link to its volume while the workspace is connected)."
  default     = "/home/coder/cloud-drive"
}

variable "workspace_tunnel_image" {
  type        = string
  description = "Platform image containing the private workspace overlay helper; empty disables it."
  default     = ""
}

# The workspace image; empty: the chart's (substituted for "codercom/enterprise-base:ubuntu" below).
variable "workspace_image" {
  type        = string
  description = "The workspace pods' image; empty: the template's default."
  default     = ""
}

# The Images view's registry as workspace pods pull from it (the chart's imageBuilder); empty: no Workspace image choice.
variable "images_registry" {
  type        = string
  description = "Where the Images view's images are pulled from, e.g. localhost:5000/coder-images."
  default     = ""
}

locals {
  default_image = var.workspace_image != "" ? var.workspace_image : "codercom/enterprise-base:ubuntu"
  # The Workspace image parameter's choice (data.coder_parameter.workspace_image), where the template offers one:
  # "template" - the template's own image, whatever it is at each start (so a template update brings its new image);
  # "custom" - the image entered below it; else an image of Templates › Images. A value from before the choices that
  # names an image of the template's own repository (the template's image as it was then) runs the template's image
  # now: an earlier one would not match the template's scripts.
  image_repository = replace(local.default_image, "/:[^:/]+$/", "")
  image_choice     = length(data.coder_parameter.workspace_image) > 0 ? data.coder_parameter.workspace_image[0].value : "template"
  workspace_image = (local.image_choice == "custom" ? try(data.coder_parameter.workspace_image_custom[0].value, local.default_image)
    : local.image_choice == "template" || local.image_choice == "" || startswith(local.image_choice, "${local.image_repository}:")
  ? local.default_image : local.image_choice)
  # The images the cluster keeps (data.kubernetes_config_map_v1.workspace_images): every version built or imported in
  # Templates › Images; and the template's earlier images the nodes keep - a workspace that chose the template's image
  # before the choices has one of those as its value, offered (as the template's image) so its update goes through.
  # Not try(): Coder's form reads the ConfigMap from the version's plan in a later pass, and try() would settle on none
  # first - the dropdown would never list them.
  images_kept = jsondecode(length(data.kubernetes_config_map_v1.workspace_images) > 0 ? lookup(
  coalesce(data.kubernetes_config_map_v1.workspace_images[0].data, {}), "images", "{}") : "{}")
  images_registry_choices = [for i in lookup(local.images_kept, "registry", []) : i
  if startswith(i.ref, "${var.images_registry}/")]
  images_earlier = [for ref in lookup(local.images_kept, "nodes", []) : ref
  if ref != local.default_image && replace(ref, "/:[^:/]+$/", "") == local.image_repository]
}

# What the platform service keeps of the images a workspace may run (the image builder's ConfigMap): {"registry":
# [{ref, name, version, description}], "nodes": [refs]}.
data "kubernetes_config_map_v1" "workspace_images" {
  count = var.images_registry != "" ? 1 : 0
  metadata {
    name      = "coder-workspace-images"
    namespace = var.namespace
  }
}

# The workspace's image: the template's own (it follows the template), one of the images built or imported in
# Templates › Images (each version the registry keeps), or another one entered by hand. A dropdown, so a workspace whose
# image was removed is offered what there is instead. Changed on a running workspace, it takes effect at its next start.
data "coder_parameter" "workspace_image" {
  count        = var.images_registry != "" ? 1 : 0
  name         = "workspace_image"
  display_name = "Workspace image"
  description  = "What the workspace runs. **The template's image** follows the template (recommended). The images built or imported in Templates › Images are listed by name and version; one built on the workspace image has everything this template runs. **Another image…** lets you enter any image the cluster can pull."
  type         = "string"
  form_type    = "dropdown"
  default      = "template"
  mutable      = true
  icon         = "/icon/docker.svg"
  option {
    name        = "The template's image"
    value       = "template"
    description = "${local.default_image}: kept up to date with the template."
    icon        = "/icon/docker.svg"
  }
  # The images built or imported in Templates › Images, the template's earlier images, then Another image…: one block,
  # so Coder's form keeps this order (it puts options it learns in a later pass - the ConfigMap's, from the version's
  # plan - after those it knew first).
  dynamic "option" {
    for_each = concat(
      [for i in local.images_registry_choices : {
        name        = "${i.name} : ${i.version}"
        value       = i.ref
        description = i.description != "" ? "Templates › Images: ${i.description}" : "Templates › Images (${i.ref})"
      }],
      [for ref in local.images_earlier : {
        name        = "The template's image (as before, ${regex(":([^:/]+)$", ref)[0]})"
        value       = ref
        description = "This workspace's choice from before: it runs the template's image now, ${local.default_image}."
      }],
      [{
        name        = "Another image…"
        value       = "custom"
        description = "An image from any registry the cluster can pull from: enter it below."
      }],
    )
    content {
      name        = option.value.name
      value       = option.value.value
      description = option.value.description
      icon        = "/icon/docker.svg"
    }
  }
}

# Another image: shown only when chosen above. Not try(): Coder's form (its preview engine) evaluates the choice in
# passes, and try() would settle on "" in the first, before the choice is known - the field would never show; one() of
# the splat is null where the template offers no choice.
data "coder_parameter" "workspace_image_custom" {
  count        = one(data.coder_parameter.workspace_image[*].value) == "custom" ? 1 : 0
  name         = "workspace_image_custom"
  display_name = "Image to run"
  description  = "The image's full reference, as `docker pull` takes it: registry/repository:tag, or @sha256:digest. For example ${var.images_registry != "" ? "${var.images_registry}/my-image:3" : "registry.example.com/team/dev:1.0"} or ${local.default_image}. Built on the workspace image, it has everything this template runs; the cluster must be able to pull it."
  type         = "string"
  default      = local.default_image
  mutable      = true
  icon         = "/icon/docker.svg"
  validation {
    regex = "^[a-z0-9]+([._-][a-z0-9]+)*(:[0-9]+)?(/[a-z0-9]+([._-][a-z0-9]+)*)+(:[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?(@sha256:[0-9a-f]{64})?$"
    error = "An image reference such as registry.example.com/team/dev:1.0: lower-case registry and repository names, then a :tag (or @sha256:digest), no spaces."
  }
}

data "coder_parameter" "cpu" {
  name         = "cpu"
  display_name = "CPU"
  description  = "The number of CPU cores"
  default      = "2"
  icon         = "/icon/memory.svg"
  mutable      = true
  option {
    name  = "2 Cores"
    value = "2"
  }
  option {
    name  = "4 Cores"
    value = "4"
  }
  option {
    name  = "6 Cores"
    value = "6"
  }
  option {
    name  = "8 Cores"
    value = "8"
  }
  option {
    name  = "12 Cores"
    value = "12"
  }
  option {
    name  = "16 Cores"
    value = "16"
  }
}

data "coder_parameter" "memory" {
  name         = "memory"
  display_name = "Memory"
  description  = "The amount of memory in GB"
  default      = var.default_memory
  icon         = "/__icons/memory.svg" # files/icons/memory.svg (a memory module), served by templates/icons.yaml
  mutable      = true
  option {
    name  = "2 GB"
    value = "2"
  }
  option {
    name  = "4 GB"
    value = "4"
  }
  option {
    name  = "6 GB"
    value = "6"
  }
  option {
    name  = "8 GB"
    value = "8"
  }
  option {
    name  = "12 GB"
    value = "12"
  }
  option {
    name  = "16 GB"
    value = "16"
  }
  option {
    name  = "24 GB"
    value = "24"
  }
  option {
    name  = "32 GB"
    value = "32"
  }
}

data "coder_parameter" "home_disk_size" {
  name         = "home_disk_size"
  display_name = "Home disk size"
  description  = "The size of the home disk in GB"
  default      = "10"
  type         = "number"
  icon         = "/__icons/hard-drive.svg" # files/icons/hard-drive.svg, served by templates/icons.yaml
  mutable      = false
  validation {
    min = 1
    max = 99999
  }
}

# Where the terminal (the agent's sessions) and File Browser (its root) open; made at start if it is missing under the
# home. Changed on a running workspace, it takes effect at its next start.
data "coder_parameter" "start_directory" {
  name         = "start_directory"
  display_name = "Start folder"
  description  = "Where the terminal and File Browser open: an absolute path, made at start if it is missing under /home/coder. File Browser shows this folder and what is below it."
  type         = "string"
  default      = "/home/coder"
  icon         = "/icon/folder.svg"
  mutable      = true
  validation {
    regex = "^/([A-Za-z0-9._@+-]+/?)*$"
    error = "An absolute path of letters, digits and . _ - @ +, such as /home/coder/projects."
  }
}

# The desktop's look (where the template has the Desktop app): Serenade, Miserable_Xfce's theme with its floating dock
# and animations, or Classic, the plain XFCE - lighter on a slow connection, as the desktop reaches the browser over
# VNC. The workspace image's coder-desktop-theme puts it in the home at the next start (the user's own changes kept
# until the choice changes).
data "coder_parameter" "desktop_theme" {
  count        = var.desktop ? 1 : 0
  name         = "desktop_theme"
  display_name = "Desktop theme"
  description  = "How the desktop looks. Serenade: a dark theme with a floating dock and animations. Classic: plain XFCE, lighter on a slow connection. Changed, it applies at the next start."
  type         = "string"
  default      = "serenade"
  icon         = "/icon/desktop.svg"
  mutable      = true
  option {
    name        = "Serenade"
    value       = "serenade"
    description = "Dark theme with a floating dock and animations."
  }
  option {
    name        = "Classic"
    value       = "classic"
    description = "Plain XFCE, lighter on a slow connection."
  }
}

# NVIDIA GPUs for the workspace (nvidia.com/gpu, from the cluster's NVIDIA device plugin). Every template has the
# parameter, disabled (styling), so the workspace's settings show the GPU switch greyed out: no template runs its
# workspaces on GPUs, and its value is never used.
data "coder_parameter" "gpus" {
  name         = "gpus"
  display_name = "GPUs"
  description  = "NVIDIA GPUs: not offered by this template."
  default      = "0"
  icon         = "/icon/memory.svg"
  mutable      = true
  styling      = jsonencode({ disabled = true })
  option {
    name  = "None (CPU)"
    value = "0"
  }
  option {
    name  = "1 GPU"
    value = "1"
  }
  option {
    name  = "2 GPUs"
    value = "2"
  }
  option {
    name  = "4 GPUs"
    value = "4"
  }
}

provider "kubernetes" {
  config_path = var.use_kubeconfig == true ? "~/.kube/config" : null
}

data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

locals {
  # The owner is an admin (one of cluster_admin_roles) and the cluster sign-in is on.
  cluster_admin = var.cluster_oidc_issuer != "" && length(setintersection(
    toset([for r in data.coder_workspace_owner.me.rbac_roles : r.name]),
    toset([for r in split(",", var.cluster_admin_roles) : trimspace(r) if trimspace(r) != ""]),
  )) > 0
  cluster_kubeconfig = "/home/coder/.kube/coder-cluster.yaml"
  # The host the workspace's agent reaches Coder on (Lock Down's Network keeps it).
  coder_host = regex("^[a-z]+://([^/:]+)", data.coder_workspace.me.access_url)[0]
  # Its pods named after whose and what it is: coder-<username>-<template name>-<workspace name>, in Kubernetes'
  # letters (lowercase, digits, single dashes), cut to 52 characters - its ReplicaSet and pods add their hashes after
  # it - with a piece of the workspace's id after a cut name, so two long names stay apart. (Its home volume keeps its
  # name, coder-<workspace id>-home: renamed, its files would be lost.)
  pod_name_full = trim(replace(replace(lower(join("-", [
    "coder", data.coder_workspace_owner.me.name, data.coder_workspace.me.template_name, data.coder_workspace.me.name
  ])), "/[^a-z0-9-]+/", "-"), "/-+/", "-"), "-")
  pod_name = length(local.pod_name_full) <= 52 ? local.pod_name_full : join("-", [
    trim(substr(local.pod_name_full, 0, 45), "-"), substr(data.coder_workspace.me.id, 0, 6)
  ])
}

variable "workspace_vm_enabled" {
  type    = bool
  default = false
}
# code-server as a global singleton (the chart's codeServerHA): not in the workspace, but one instance per workspace
# across every cluster that shares Coder's database, kept by the code-server-replicator; a relay in this pod
# (127.0.0.1:13337, where code-server's app looks) takes its connections there. Off unless a template turns it on.
variable "code_server_ha" {
  type        = bool
  description = "code-server as a global singleton kept by the code-server-replicator (high availability), not in the workspace."
  default     = false
}

variable "code_server_ha_image" {
  type        = string
  description = "The relay's image (the chart's platform service image); empty: no high availability."
  default     = ""
}

variable "code_server_ha_db_ca_secret" {
  type        = string
  description = "The Secret with the CA of Coder's database (the relay checks it)."
  default     = "coder-db-ca"
}

locals {
  code_server_ha = !var.workspace_vm_enabled && var.code_server_ha && var.code_server_ha_image != ""
}

resource "coder_agent" "main" {
  os   = "linux"
  arch = "amd64"
  # The terminal's and SSH sessions' starting directory (the Start folder parameter; the startup script makes it).
  dir = data.coder_parameter.start_directory.value

  display_apps {
    web_terminal = var.terminal
    vscode       = false
    ssh_helper   = false
  }

  # Admins' terminals, k9s and apps find the cluster sign-in first, then their own ~/.kube/config.
  env = local.cluster_admin ? { KUBECONFIG = "${local.cluster_kubeconfig}:/home/coder/.kube/config" } : {}

  startup_script = templatefile("${path.module}/scripts/startup.sh", {
    owner_name             = data.coder_workspace_owner.me.name
    workspace_name         = data.coder_workspace.me.name
    namespace              = var.namespace
    cluster_admin          = local.cluster_admin
    cluster_kubeconfig     = local.cluster_kubeconfig
    cluster_oidc_issuer    = var.cluster_oidc_issuer
    cluster_oidc_client_id = var.cluster_oidc_client_id
    code_server            = var.code_server
    start_directory        = data.coder_parameter.start_directory.value
    neko_browser           = var.neko_browser
    desktop                = var.desktop
    desktop_theme          = var.desktop ? data.coder_parameter.desktop_theme[0].value : "classic"
    file_browser           = var.file_browser
    # coder-filebrowser: File Browser started with every Cloud Drive here as a source of its own
    filebrowser = base64encode(file("${path.module}/scripts/filebrowser.sh"))
    # btop's disk: the home volume's own size where volumes are folders of the node's disk (startup.sh builds it)
    home_statfs = base64encode(file("${path.module}/scripts/home-statfs.c"))
    # and the Disk metric's measurement (scripts/metadata.sh's disk), which startup.sh keeps fresh for it
    platform_metadata = base64encode(file("${path.module}/scripts/metadata.sh"))
  })

}

resource "coder_app" "novnc" {
  count        = var.desktop ? 1 : 0
  agent_id     = coder_agent.main.id
  slug         = "novnc"
  display_name = "Desktop"
  # Coder's own icon (served by the dashboard; the noVNC logo was on the internet)
  icon = "/icon/desktop.svg"
  # Serve workspace HTML on an isolated origin; noVNC connects relative to that app host.
  url       = "http://localhost:6901?autoconnect=true&resize=remote&compression=0&path=websockify"
  subdomain = true
  share     = "owner"

  healthcheck {
    url       = "http://localhost:6901/"
    interval  = 5
    threshold = 3
  }
}

# FileBrowser Quantum (scripts/startup.sh starts it under the app's path, which its health check is under too). Coder
# strips the app's path from a request and joins the rest to this URL's path, so the URL carries the full path back
# (FileBrowser Quantum redirects anything outside it there: with a bare URL, an endless redirect).
resource "coder_app" "filebrowser" {
  count        = var.file_browser ? 1 : 0
  agent_id     = coder_agent.main.id
  slug         = "filebrowser"
  display_name = "File Browser"
  icon         = "/__icons/filebrowser-quantum.png" # files/icons/filebrowser-quantum.png, served by templates/icons.yaml
  url          = "http://localhost:13339/@${data.coder_workspace_owner.me.name}/${data.coder_workspace.me.name}.main/apps/filebrowser/"
  subdomain    = false
  share        = "owner"

  healthcheck {
    url       = "http://localhost:13339/@${data.coder_workspace_owner.me.name}/${data.coder_workspace.me.name}.main/apps/filebrowser/health"
    interval  = 5
    threshold = 3
  }
}

resource "coder_app" "code-server" {
  count        = var.code_server ? 1 : 0
  agent_id     = coder_agent.main.id
  slug         = "code-server"
  display_name = "code-server"
  icon         = "/icon/code.svg"
  url          = "http://localhost:13337?folder=/home/coder"
  subdomain    = true
  share        = "owner"

  healthcheck {
    url       = "http://localhost:13337/healthz"
    interval  = 3
    threshold = 10
  }
}

moved {
  from = kubernetes_persistent_volume_claim_v1.home
  to   = kubernetes_persistent_volume_claim_v1.home[0]
}

resource "kubernetes_persistent_volume_claim_v1" "home" {
  count = var.workspace_vm_enabled ? 0 : 1
  metadata {
    name      = "coder-${data.coder_workspace.me.id}-home"
    namespace = var.namespace
    labels = {
      "app.kubernetes.io/name"     = "coder-pvc"
      "app.kubernetes.io/instance" = "coder-pvc-${data.coder_workspace.me.id}"
      "app.kubernetes.io/part-of"  = "coder"
      "com.coder.resource"         = "true"
      "com.coder.workspace.id"     = data.coder_workspace.me.id
      "com.coder.workspace.name"   = data.coder_workspace.me.name
      "com.coder.user.id"          = data.coder_workspace_owner.me.id
      "com.coder.user.username"    = data.coder_workspace_owner.me.name
    }
    annotations = {
      "com.coder.user.email" = data.coder_workspace_owner.me.email
    }
  }
  wait_until_bound = false

  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = var.home_storage_class != "" ? var.home_storage_class : null
    resources {
      requests = {
        storage = "${data.coder_parameter.home_disk_size.value}G"
      }
    }
  }

  # The parameter is the size the workspace was created with; the disk can grow later (the workspace's ⋮ menu >
  # Expand disk, done by the platform service), so later builds leave the volume's size alone. The storage class
  # is fixed when the volume is made: a change of home_storage_class must never replace (empty) existing homes.
  lifecycle {
    ignore_changes = [spec[0].resources, spec[0].storage_class_name]
  }
}

locals {
  # The workspace's hostname: the owner's name and the workspace's (e.g. admin-xxx), not the pod's (coder-<id>-<hash>);
  # a DNS label: lowercase letters, digits and hyphens, at most 63 characters.
  hostname = trim(substr(replace(lower("${data.coder_workspace_owner.me.name}-${data.coder_workspace.me.name}"), "/[^a-z0-9-]/", "-"), 0, 63), "-")
}

resource "kubernetes_deployment_v1" "main" {
  count = var.workspace_vm_enabled ? 0 : data.coder_workspace.me.start_count
  depends_on = [
    kubernetes_persistent_volume_claim_v1.home
  ]
  wait_for_rollout = false
  metadata {
    name      = local.pod_name
    namespace = var.namespace
    labels = {
      "app.kubernetes.io/name"     = "coder-workspace"
      "app.kubernetes.io/instance" = "coder-workspace-${data.coder_workspace.me.id}"
      "app.kubernetes.io/part-of"  = "coder"
      "com.coder.resource"         = "true"
      "com.coder.workspace.id"     = data.coder_workspace.me.id
      "com.coder.workspace.name"   = data.coder_workspace.me.name
      "com.coder.user.id"          = data.coder_workspace_owner.me.id
      "com.coder.user.username"    = data.coder_workspace_owner.me.name
    }
    annotations = {
      "com.coder.user.email" = data.coder_workspace_owner.me.email
    }
  }

  spec {
    replicas = 1
    selector {
      match_labels = {
        "app.kubernetes.io/name"     = "coder-workspace"
        "app.kubernetes.io/instance" = "coder-workspace-${data.coder_workspace.me.id}"
        "app.kubernetes.io/part-of"  = "coder"
        "com.coder.resource"         = "true"
        "com.coder.workspace.id"     = data.coder_workspace.me.id
        "com.coder.workspace.name"   = data.coder_workspace.me.name
        "com.coder.user.id"          = data.coder_workspace_owner.me.id
        "com.coder.user.username"    = data.coder_workspace_owner.me.name
      }
    }
    strategy {
      type = "Recreate"
    }

    template {
      metadata {
        labels = {
          "app.kubernetes.io/name"     = "coder-workspace"
          "app.kubernetes.io/instance" = "coder-workspace-${data.coder_workspace.me.id}"
          "app.kubernetes.io/part-of"  = "coder"
          "com.coder.resource"         = "true"
          "com.coder.workspace.id"     = data.coder_workspace.me.id
          "com.coder.workspace.name"   = data.coder_workspace.me.name
          "com.coder.user.id"          = data.coder_workspace_owner.me.id
          "com.coder.user.username"    = data.coder_workspace_owner.me.name
        }
        annotations = local.code_server_ha ? { "platform.coder/code-server-ha" = "on" } : {}
      }
      spec {
        hostname = local.hostname
        security_context {
          run_as_user     = 1000
          fs_group        = 1000
          run_as_non_root = true
        }

        # Trust the local PKI: append the cluster root CA (secret "tls-ca") to the
        # image's stock bundle so curl, the agent, git and apt can reach
        # https://coder.xxx.com while public sites still verify.
        init_container {
          name              = "trust-local-ca"
          image             = local.workspace_image
          image_pull_policy = "IfNotPresent"
          resources {
            requests = { cpu = "1", memory = "64Mi" }
            limits   = { cpu = "1", memory = "64Mi" }
          }
          command = [
            "sh", "-c",
            "cat /etc/ssl/certs/ca-certificates.crt /local-ca/ca.crt > /ca-bundle/ca-certificates.crt",
          ]
          volume_mount {
            name       = "local-ca"
            mount_path = "/local-ca"
            read_only  = true
          }
          volume_mount {
            name       = "ca-bundle"
            mount_path = "/ca-bundle"
          }
        }

        volume {
          name = "workspace-tunnel-run"
          empty_dir {
            medium = "Memory"
          }
        }

        dynamic "container" {
          for_each = var.workspace_tunnel_image != "" ? [1] : []
          content {
            name              = "workspace-tunnel"
            image             = var.workspace_tunnel_image
            image_pull_policy = "IfNotPresent"
            command           = ["/usr/local/bin/workspace-tunnel-native"]
            security_context {
              run_as_user                = 0
              run_as_non_root            = false
              allow_privilege_escalation = false
              read_only_root_filesystem  = true
              capabilities {
                drop = ["ALL"]
                add  = ["NET_ADMIN"]
              }
            }
            env {
              name  = "CODER_AGENT_TOKEN"
              value = coder_agent.main.token
            }
            env {
              name  = "WORKSPACE_TUNNEL_URL"
              value = "${trimsuffix(data.coder_workspace.me.access_url, "/")}/__coder-ui/api/workspace-tunnels/agent/sync"
            }
            env {
              name = "POD_IP"
              value_from {
                field_ref {
                  field_path = "status.podIP"
                }
              }
            }
            volume_mount {
              name       = "workspace-tunnel-run"
              mount_path = "/run"
            }
            volume_mount {
              name       = "ca-bundle"
              mount_path = "/etc/ssl/certs/ca-certificates.crt"
              sub_path   = "ca-certificates.crt"
              read_only  = true
            }
            resources {
              requests = { cpu = "25m", memory = "64Mi" }
              limits   = { cpu = "500m", memory = "128Mi" }
            }
          }
        }

        container {
          name  = "dev"
          image = local.workspace_image
          # The workspace image is versioned (a new build gets a new tag), and offline there is nothing to pull from.
          image_pull_policy = "IfNotPresent"
          # No core dumps from the agent or anything it starts (terminals, the desktop, apps).
          command = ["sh", "-c", join("\n", ["ulimit -c 0", coder_agent.main.init_script])]
          security_context {
            run_as_user = "1000"
          }
          volume_mount {
            name       = "ca-bundle"
            mount_path = "/etc/ssl/certs/ca-certificates.crt"
            sub_path   = "ca-certificates.crt"
            read_only  = true
          }
          env {
            name  = "CODER_AGENT_TOKEN"
            value = coder_agent.main.token
          }
          env {
            name  = "CODER_AGENT_TAILNET_LISTEN_PORT"
            value = "41641"
          }
          # The home volume's size as Kubernetes has it (it can grow after creation), for the Home Disk metric.
          env {
            name  = "CODER_HOME_DISK_SIZE"
            value = kubernetes_persistent_volume_claim_v1.home[0].spec[0].resources[0].requests["storage"]
          }
          resources {
            requests = {
              "cpu"    = "${data.coder_parameter.cpu.value}"
              "memory" = "${data.coder_parameter.memory.value}Gi"
            }
            limits = {
              "cpu"    = "${data.coder_parameter.cpu.value}"
              "memory" = "${data.coder_parameter.memory.value}Gi"
            }
          }
          volume_mount {
            mount_path = "/home/coder"
            name       = "home"
            read_only  = false
          }
          # Firefox's tabs share memory through /dev/shm; a pod's default 64 MiB makes them crash.
          volume_mount {
            mount_path = "/dev/shm"
            name       = "dshm"
          }
        }

        volume {
          name = "dshm"
          empty_dir {
            medium     = "Memory"
            size_limit = "1Gi"
          }
        }

        volume {
          name = "home"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim_v1.home[0].metadata.0.name
            read_only  = false
          }
        }

        volume {
          name = "local-ca"
          secret {
            secret_name = "tls-ca"
            items {
              key  = "ca.crt"
              path = "ca.crt"
            }
          }
        }

        volume {
          name = "ca-bundle"
          empty_dir {}
        }

        affinity {
          pod_anti_affinity {
            preferred_during_scheduling_ignored_during_execution {
              weight = 1
              pod_affinity_term {
                topology_key = "kubernetes.io/hostname"
                label_selector {
                  match_expressions {
                    key      = "app.kubernetes.io/name"
                    operator = "In"
                    values   = ["coder-workspace"]
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
