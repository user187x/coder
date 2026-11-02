# Keep native Kubernetes resources on their existing provider and state schema.
provider "kubectl" {
  config_path       = var.use_kubeconfig ? "~/.kube/config" : null
  load_config_file  = var.use_kubeconfig
  apply_retry_count = 3
}

# Opt-in VM profile. Prepared HOME disks are independent of the VM lifecycle.
variable "workspace_vm_build_id" {
  type    = string
  default = ""
}
variable "workspace_vm_root_image" {
  type    = string
  default = ""
}
variable "workspace_vm_home_claim" {
  type        = string
  default     = ""
  description = "Independently retained Block-mode PVC containing an exact-sized prepared HOME device. Filesystem PVCs are forbidden."
}
variable "workspace_vm_organization_id" {
  type    = string
  default = ""
}
variable "workspace_vm_node" {
  type    = string
  default = ""
}
variable "workspace_vm_cpu_model" {
  type    = string
  default = "Haswell-noTSX"
}
variable "workspace_vm_reserved_memory_bytes" {
  type    = number
  default = 536870912
}
variable "workspace_vm_ca_pem" {
  type      = string
  default   = ""
  sensitive = true
}

data "kubernetes_persistent_volume_claim_v1" "vm_home" {
  count = var.workspace_vm_enabled && var.workspace_vm_home_claim != "" ? 1 : 0
  metadata {
    name      = var.workspace_vm_home_claim
    namespace = var.namespace
  }
}

data "kubernetes_resources" "legacy_vm_home" {
  count          = var.workspace_vm_enabled ? 1 : 0
  api_version    = "v1"
  kind           = "PersistentVolumeClaim"
  namespace      = var.namespace
  field_selector = "metadata.name=coder-${data.coder_workspace.me.id}-home"
}

data "kubernetes_resources" "existing_vm_home" {
  count          = var.workspace_vm_enabled && var.workspace_vm_home_claim == "" ? 1 : 0
  api_version    = "v1"
  kind           = "PersistentVolumeClaim"
  namespace      = var.namespace
  field_selector = "metadata.name=coder-vm-${data.coder_workspace.me.id}-home"
  lifecycle {
    postcondition {
      condition = alltrue([for claim in self.objects :
        try(claim.spec.volumeMode, "") == "Block" &&
        try(claim.metadata.labels["com.coder.workspace.id"], "") == data.coder_workspace.me.id &&
        try(claim.metadata.labels["com.coder.organization.id"], "") == var.workspace_vm_organization_id &&
        try(claim.metadata.labels["com.coder.user.id"], "") == data.coder_workspace_owner.me.id
      ])
      error_message = "An existing VM HOME must be an owned Block claim before it can be adopted."
    }
  }
}

import {
  for_each = var.workspace_vm_enabled && var.workspace_vm_home_claim == "" ? {
    for claim in data.kubernetes_resources.existing_vm_home[0].objects : claim.metadata.name => claim
  } : {}
  to = kubernetes_persistent_volume_claim_v1.vm_home[0]
  id = "${var.namespace}/${each.key}"
}

# A canceled initial apply may leave the retained VM before Terraform records its state.
data "kubernetes_resources" "existing_workspace_vm" {
  count          = var.workspace_vm_enabled ? 1 : 0
  api_version    = "kubevirt.io/v1"
  kind           = "VirtualMachine"
  namespace      = var.namespace
  field_selector = "metadata.name=coder-vm-${data.coder_workspace.me.id}"
  lifecycle {
    postcondition {
      condition = alltrue([for vm in self.objects :
        try(vm.metadata.labels["com.coder.workspace.id"], "") == data.coder_workspace.me.id &&
        try(vm.metadata.labels["com.coder.organization.id"], "") == var.workspace_vm_organization_id &&
        try(vm.metadata.labels["com.coder.user.id"], "") == data.coder_workspace_owner.me.id
      ])
      error_message = "An existing VM must belong to this workspace, organization and owner before adoption."
    }
  }
}

# Preserve VMs left in older experimental manifest states, then adopt by owned identity.
removed {
  from = kubernetes_manifest.workspace_vm
  lifecycle { destroy = false }
}

import {
  for_each = var.workspace_vm_enabled ? {
    for vm in data.kubernetes_resources.existing_workspace_vm[0].objects : vm.metadata.name => vm
  } : {}
  to = kubectl_manifest.workspace_vm[0]
  id = "kubevirt.io/v1//VirtualMachine//${each.key}//${var.namespace}"
}

locals {
  vm_name = "coder-vm-${data.coder_workspace.me.id}"
  vm_labels = {
    "com.coder.workspace.id"    = data.coder_workspace.me.id
    "com.coder.organization.id" = var.workspace_vm_organization_id
    "com.coder.user.id"         = data.coder_workspace_owner.me.id
  }
  vm_legacy_home_uid   = try(data.kubernetes_resources.legacy_vm_home[0].objects[0].metadata.uid, "")
  vm_migrated_home_uid = var.workspace_vm_home_claim != "" ? try(data.kubernetes_persistent_volume_claim_v1.vm_home[0].metadata[0].annotations["platform.coder/migrated-from-pvc-uid"], "") : try(data.kubernetes_resources.existing_vm_home[0].objects[0].metadata.annotations["platform.coder/migrated-from-pvc-uid"], "")
  vm_home_retained     = var.workspace_vm_home_claim != "" ? try(data.kubernetes_persistent_volume_claim_v1.vm_home[0].metadata[0].annotations["platform.coder/retained-vm-home"], "") == "true" : try(data.kubernetes_resources.existing_vm_home[0].objects[0].metadata.annotations["platform.coder/retained-vm-home"], "") == "true"
  vm_home_claim        = var.workspace_vm_home_claim != "" ? var.workspace_vm_home_claim : try(kubernetes_persistent_volume_claim_v1.vm_home[0].metadata[0].name, "")
  vm_cpu               = tonumber(data.coder_parameter.cpu.value)
  vm_memory_bytes      = tonumber(data.coder_parameter.memory.value) * 1073741824
  vm_runtime = {
    version               = 1
    build_id              = var.workspace_vm_build_id
    cluster_namespace     = var.namespace
    workspace_id          = data.coder_workspace.me.id
    organization_id       = var.workspace_vm_organization_id
    workspace_owner_id    = data.coder_workspace_owner.me.id
    cpu                   = local.vm_cpu
    memory_bytes          = local.vm_memory_bytes
    reserved_memory_bytes = var.workspace_vm_reserved_memory_bytes
    home_bytes            = try(tonumber(data.kubernetes_persistent_volume_claim_v1.vm_home[0].metadata[0].annotations["platform.coder/home-disk-bytes"]), tonumber(kubernetes_persistent_volume_claim_v1.vm_home[0].metadata[0].annotations["platform.coder/home-disk-bytes"]), tonumber(data.coder_parameter.home_disk_size.value) * 1000000000)
    home_initialize       = false
    home_device           = "/dev/disk/by-id/virtio-coder-home"
    workspace_image       = local.workspace_image
    trusted_ca_pem_base64 = base64encode(var.workspace_vm_ca_pem)
    agent = {
      token              = coder_agent.main.token
      url                = data.coder_workspace.me.access_url
      init_script_base64 = base64encode(coder_agent.main.init_script)
    }
    cloud_drive = { enabled = var.user_storage }
    tunnel      = { enabled = var.workspace_tunnel_image != "", port = 51871 }
  }
}

locals {
  vm_userdata = "#cloud-config\n${jsonencode({
    write_files = [{
      path        = "/etc/coder-workspace/runtime.json"
      owner       = "root:root"
      permissions = "0600"
      encoding    = "b64"
      content     = base64encode(jsonencode(local.vm_runtime))
    }]
    runcmd = [["systemctl", "start", "coder-workspace.service"]]
  })}"
}

locals {
  vm_home_request = jsonencode({
    version            = 1
    workspace_id       = data.coder_workspace.me.id
    organization_id    = var.workspace_vm_organization_id
    workspace_owner_id = data.coder_workspace_owner.me.id
    build_id           = var.workspace_vm_build_id
    home_bytes         = tonumber(data.coder_parameter.home_disk_size.value) * 1000000000
    node_name          = var.workspace_vm_node
  })
}

resource "kubernetes_secret_v1" "vm_home_request" {
  count = var.workspace_vm_enabled && var.workspace_vm_home_claim == "" ? 1 : 0
  metadata {
    name      = "coder-vm-home-request-${data.coder_workspace.me.id}-${substr(sha256(local.vm_home_request), 0, 16)}"
    namespace = var.namespace
    labels    = local.vm_labels
  }
  immutable = true
  data      = { request = local.vm_home_request }
  lifecycle { create_before_destroy = true }
}

resource "kubernetes_persistent_volume_claim_v1" "vm_home" {
  count = var.workspace_vm_enabled && var.workspace_vm_home_claim == "" ? 1 : 0
  metadata {
    name      = "coder-vm-${data.coder_workspace.me.id}-home"
    namespace = var.namespace
    labels    = local.vm_labels
    annotations = {
      "platform.coder/home-request"    = kubernetes_secret_v1.vm_home_request[0].metadata[0].name
      "platform.coder/home-disk-bytes" = tostring(tonumber(data.coder_parameter.home_disk_size.value) * 1000000000)
    }
  }
  wait_until_bound = true
  spec {
    access_modes       = ["ReadWriteOnce"]
    storage_class_name = "coder-vm-home"
    volume_mode        = "Block"
    resources { requests = { storage = "${tonumber(data.coder_parameter.home_disk_size.value) * 1000000000}" } }
  }
  timeouts { create = "10m" }
  lifecycle { ignore_changes = [metadata[0].annotations["platform.coder/home-disk-bytes"], metadata[0].annotations["platform.coder/retained-vm-home"], spec[0].resources, spec[0].volume_name] }
}

resource "kubernetes_secret_v1" "vm_boot" {
  count = var.workspace_vm_enabled ? 1 : 0
  metadata {
    name      = "${local.vm_name}-boot-${substr(sha256(local.vm_userdata), 0, 32)}"
    namespace = var.namespace
    labels    = local.vm_labels
  }
  lifecycle {
    create_before_destroy = true
  }
  immutable = true
  data      = { userdata = local.vm_userdata }
}

resource "kubectl_manifest" "workspace_vm" {
  count             = var.workspace_vm_enabled ? 1 : 0
  server_side_apply = true
  field_manager     = "Terraform"
  # A new captured build may replace intent revoked by the root manager.
  # Admission still reserves physical starts and proof for that manager.
  force_conflicts  = true
  ignore_fields    = ["spec.runStrategy"]
  wait_for_rollout = false
  wait             = true
  delete_cascade   = "Foreground"
  yaml_body = jsonencode({
    apiVersion = "kubevirt.io/v1"
    kind       = "VirtualMachine"
    metadata   = { name = local.vm_name, namespace = var.namespace, labels = local.vm_labels, annotations = { "com.coder.agent.id" = coder_agent.main.id, "platform.coder/build-id" = var.workspace_vm_build_id, "platform.coder/desired-run-strategy" = data.coder_workspace.me.start_count > 0 ? "Always" : "Halted" } }
    spec = {
      runStrategy = "Halted"
      template = {
        metadata = { labels = local.vm_labels }
        spec = {
          nodeSelector                  = merge({ "platform.coder/vm-ready" = "true" }, var.workspace_vm_node == "" ? {} : { "kubernetes.io/hostname" = var.workspace_vm_node })
          tolerations                   = [{ key = "platform.coder/workspace-vm-host", operator = "Exists", effect = "NoSchedule" }]
          terminationGracePeriodSeconds = 30
          domain = {
            cpu    = { sockets = 1, cores = local.vm_cpu, threads = 1, maxSockets = 1, model = var.workspace_vm_cpu_model }
            memory = { guest = "${local.vm_memory_bytes}", maxGuest = "${local.vm_memory_bytes}" }
            resources = {
              requests = { cpu = "${local.vm_cpu}", memory = "${local.vm_memory_bytes}" }
              limits   = { cpu = "${local.vm_cpu}", memory = "${local.vm_memory_bytes}" }
            }
            devices = {
              disks = [
                { name = "root", disk = { bus = "virtio" } },
                { name = "home", serial = "coder-home", disk = { bus = "virtio" } },
                { name = "cloudinit", disk = { bus = "virtio" } }
              ]
              interfaces = [{ name = "default", masquerade = {} }]
            }
          }
          networks = [{ name = "default", pod = {} }]
          volumes = [
            { name = "root", containerDisk = { image = var.workspace_vm_root_image, imagePullPolicy = "IfNotPresent" } },
            { name = "home", persistentVolumeClaim = { claimName = local.vm_home_claim } },
            { name = "cloudinit", cloudInitNoCloud = { secretRef = { name = kubernetes_secret_v1.vm_boot[0].metadata[0].name } } }
          ]
        }
      }
    }
  })
  wait_for {
    field {
      key   = data.coder_workspace.me.start_count > 0 ? "status.ready" : "status.printableStatus"
      value = data.coder_workspace.me.start_count > 0 ? "true" : "Stopped"
    }
  }
  timeouts {
    create = "10m"
    update = "10m"
  }
  lifecycle {
    precondition {
      condition     = local.vm_legacy_home_uid == "" || (local.vm_home_retained && local.vm_migrated_home_uid == local.vm_legacy_home_uid)
      error_message = "An existing native HOME requires a verified offline migration before VM conversion. The prepared Block claim must record platform.coder/migrated-from-pvc-uid matching the original PVC UID."
    }
    precondition {
      condition     = var.workspace_vm_home_claim == "" ? true : data.kubernetes_persistent_volume_claim_v1.vm_home[0].spec[0].volume_mode == "Block" && lookup(data.kubernetes_persistent_volume_claim_v1.vm_home[0].metadata[0].annotations, "platform.coder/home-disk-bytes", "") == tostring(local.vm_runtime.home_bytes)
      error_message = "VM HOME must be a prepared exact-sized Block PVC. Filesystem-backed disk images may grow unexpectedly and are forbidden."
    }
    precondition {
      condition     = can(regex("@sha256:[a-f0-9]{64}$", var.workspace_vm_root_image))
      error_message = "The VM boot image must be pinned by digest."
    }
    precondition {
      condition = var.workspace_vm_home_claim != "coder-${data.coder_workspace.me.id}-home" && can(regex("^[0-9a-f-]{36}$", var.workspace_vm_organization_id)) && (var.workspace_vm_build_id == "" || can(regex("^[0-9a-f-]{36}$", var.workspace_vm_build_id)))
      # Template import plans have no build ID and never apply; admission requires it on real profiles.
      error_message = "VM mode requires an independent Block HOME disk and captured organization/build UUIDs."
    }
    precondition {
      condition     = !var.user_storage && !var.code_server_ha && var.workspace_tunnel_image == ""
      error_message = "VM Cloud Drive, external HA and tunnel adapters require validated guest support before enabling them."
    }
    precondition {
      condition     = local.vm_cpu >= 1 && floor(local.vm_cpu) == local.vm_cpu && local.vm_memory_bytes >= 1073741824 && var.workspace_vm_reserved_memory_bytes >= 536870912 && var.workspace_vm_reserved_memory_bytes < local.vm_memory_bytes && local.vm_memory_bytes % 1048576 == 0 && !contains(["host-model", "host-passthrough"], var.workspace_vm_cpu_model)
      error_message = "VM resources require whole vCPUs, MiB-aligned memory and an explicit generic CPU model."
    }
  }
}
