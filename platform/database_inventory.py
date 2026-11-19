"""Read-only, projected configuration for the resources that back Coder's database."""

from urllib.parse import quote


# These paths contain configuration and resource references. Never serialize a raw
# spec, env list, Secret, ConfigMap payload, or last-applied annotation.
CLUSTER_FIELDS = (
    "instances", "imageName", "imagePullPolicy", "primaryUpdateStrategy",
    "primaryUpdateMethod", "startDelay", "stopDelay", "smartShutdownTimeout",
    "switchoverDelay", "failoverDelay", "enableSuperuserAccess",
    "storage.size", "storage.storageClass", "storage.resizeInUseVolumes",
    "walStorage.size", "walStorage.storageClass", "walStorage.resizeInUseVolumes",
    "bootstrap.initdb.database", "bootstrap.initdb.owner",
    "bootstrap.initdb.secret.name", "bootstrap.initdb.encoding",
    "bootstrap.initdb.localeCollate", "bootstrap.initdb.localeCType",
    "backup.retentionPolicy", "backup.volumeSnapshot.className",
    "backup.volumeSnapshot.walClassName", "backup.volumeSnapshot.snapshotOwnerReference",
    "monitoring.enablePodMonitor", "affinity.enablePodAntiAffinity",
    "affinity.topologyKey", "affinity.podAntiAffinityType",
    "certificates.serverTLSSecret", "certificates.serverCASecret",
    "certificates.clientCASecret", "certificates.replicationTLSSecret",
    "postgresql.synchronous.method", "postgresql.synchronous.number",
    "postgresql.synchronous.dataDurability", "minSyncReplicas", "maxSyncReplicas",
    "resources.requests.cpu", "resources.requests.memory",
    "resources.limits.cpu", "resources.limits.memory",
)
POSTGRES_PARAMETERS = {
    "max_connections", "shared_buffers", "effective_cache_size", "work_mem",
    "maintenance_work_mem", "max_worker_processes", "max_parallel_workers",
    "max_parallel_workers_per_gather", "wal_level", "wal_keep_size",
    "max_wal_size", "min_wal_size", "max_wal_senders", "max_replication_slots",
    "wal_compression", "archive_mode", "checkpoint_timeout",
    "checkpoint_completion_target", "synchronous_commit", "statement_timeout",
    "idle_in_transaction_session_timeout", "log_min_duration_statement",
    "log_connections", "log_disconnections", "log_statement", "timezone",
    "shared_preload_libraries", "jit", "ssl_min_protocol_version",
}
POOLER_FIELDS = (
    "cluster.name", "type", "instances", "pgbouncer.poolMode",
    "pgbouncer.parameters.max_client_conn", "pgbouncer.parameters.default_pool_size",
    "pgbouncer.parameters.min_pool_size", "pgbouncer.parameters.reserve_pool_size",
    "pgbouncer.parameters.max_db_connections", "pgbouncer.parameters.max_user_connections",
)


def _value(obj, path):
    for key in path.split("."):
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj if isinstance(obj, (str, bool, int, float)) else None


def _fields(obj, paths, prefix="spec."):
    return {
        prefix + path: value for path in paths
        if (value := _value(obj, path)) is not None
    }


def _resource(kind, obj, values):
    meta = obj.get("metadata") or {}
    annotations = meta.get("annotations") or {}
    release = annotations.get("meta.helm.sh/release-name")
    release_namespace = annotations.get("meta.helm.sh/release-namespace")
    return {
        "kind": kind,
        "name": meta.get("name") or "Unknown",
        "namespace": meta.get("namespace"),
        "managedBy": f"Helm release {release} ({release_namespace or meta.get('namespace') or 'namespace unknown'})"
        if release else (meta.get("labels") or {}).get("app.kubernetes.io/managed-by"),
        "values": values,
    }


def discover(kube, deployment, connection, cluster, instances, coder_namespace, deployment_name):
    resources, unavailable = [], []

    def q(value):
        return quote(value, safe="")

    def fetch(path, title, missing=False):
        status, obj = kube.call("GET", path)
        if status == 200 and isinstance(obj, dict):
            return obj
        if status != 404 or not missing:
            unavailable.append({"resource": title, "status": status})
        return {}

    db_fields = {
        "connection." + key: connection[key]
        for key in ("host", "port", "database", "user", "sslMode", "source")
        if connection.get(key) is not None
    }
    if deployment:
        db_fields.update(_fields(deployment.get("spec") or {}, ("replicas", "strategy.type")))
        resources.append(_resource("Deployment", deployment, db_fields))
    else:
        unavailable.append({"resource": f"Deployment {coder_namespace}/{deployment_name}", "status": None})

    meta = (cluster or {}).get("metadata") or {}
    cluster_name = meta.get("name")
    namespace = meta.get("namespace") or coder_namespace
    ns = q(namespace)
    cnpg = f"/apis/postgresql.cnpg.io/v1/namespaces/{ns}"
    core = f"/api/v1/namespaces/{ns}"
    spec = (cluster or {}).get("spec") or {}
    if cluster_name:
        values = _fields(spec, CLUSTER_FIELDS)
        values.update(_fields(spec, ("postgresql.parameters." + key for key in sorted(POSTGRES_PARAMETERS))))
        values.update(_fields(cluster.get("status") or {}, ("phase", "currentPrimary", "readyInstances"), "status."))
        resources.append(_resource("Cluster", cluster, values))

    host = connection.get("host") or ""
    host_parts = host.split(".")
    services = set()
    if host and (len(host_parts) <= 2 or len(host_parts) > 2 and host_parts[2] == "svc"):
        endpoint_namespace = host_parts[1] if len(host_parts) > 1 else coder_namespace
        services.add((endpoint_namespace, host_parts[0]))
    if cluster_name:
        services.update((namespace, f"{cluster_name}-{suffix}") for suffix in ("rw", "ro", "r", "pooler-rw", "pooler-ro"))
    for svc_namespace, name in sorted(services):
        svc = fetch(f"/api/v1/namespaces/{q(svc_namespace)}/services/{q(name)}",
                    f"Service {svc_namespace}/{name}", missing=True)
        if not svc:
            continue
        svc_spec = svc.get("spec") or {}
        values = _fields(svc_spec, ("type", "clusterIP", "externalName", "sessionAffinity", "internalTrafficPolicy"))
        for index, port in enumerate(svc_spec.get("ports") or []):
            values.update(_fields(port, ("name", "port", "targetPort", "protocol", "appProtocol"), f"spec.ports[{index}]."))
        resources.append(_resource("Service", svc, values))
        owner = next((ref for ref in (svc.get("metadata") or {}).get("ownerReferences") or []
                      if ref.get("kind") == "Pooler" and ref.get("name")), None)
        if owner or (cluster_name and name.startswith(f"{cluster_name}-pooler-")):
            pooler_name = owner["name"] if owner else name
            pooler = fetch(f"/apis/postgresql.cnpg.io/v1/namespaces/{q(svc_namespace)}/poolers/{q(pooler_name)}",
                           f"Pooler {svc_namespace}/{pooler_name}")
            if pooler:
                resources.append(_resource("Pooler", pooler, _fields(pooler.get("spec") or {}, POOLER_FIELDS)))

    storage_classes = {spec["storage"]["storageClass"]} if _value(spec, "storage.storageClass") else set()
    if _value(spec, "walStorage.storageClass"):
        storage_classes.add(spec["walStorage"]["storageClass"])
    for instance in instances:
        name = instance["name"]
        pod = fetch(f"{core}/pods/{q(name)}", f"Pod {namespace}/{name}")
        if pod:
            pod_spec = pod.get("spec") or {}
            values = _fields(pod_spec, ("nodeName", "serviceAccountName", "priorityClassName", "restartPolicy"))
            for index, container in enumerate(pod_spec.get("containers") or []):
                values.update(_fields(container, ("name", "image", "imagePullPolicy", "resources.requests.cpu",
                                                  "resources.requests.memory", "resources.limits.cpu",
                                                  "resources.limits.memory"), f"spec.containers[{index}]."))
            values.update(_fields(pod.get("status") or {}, ("phase", "podIP"), "status."))
            resources.append(_resource("Pod", pod, values))
        for volume in (instance.get("pvc"), instance.get("walPvc")):
            if not volume or not volume.get("name"):
                continue
            claim_name = volume["name"]
            claim = fetch(f"{core}/persistentvolumeclaims/{q(claim_name)}", f"PersistentVolumeClaim {namespace}/{claim_name}")
            if not claim:
                continue
            claim_spec = claim.get("spec") or {}
            values = _fields(claim_spec, ("volumeName", "storageClassName", "volumeMode", "resources.requests.storage"))
            values.update(_fields(claim.get("status") or {}, ("phase", "capacity.storage"), "status."))
            resources.append(_resource("PersistentVolumeClaim", claim, values))
            if claim_spec.get("storageClassName"):
                storage_classes.add(claim_spec["storageClassName"])
            volume_name = claim_spec.get("volumeName")
            if volume_name:
                pv = fetch(f"/api/v1/persistentvolumes/{q(volume_name)}", f"PersistentVolume {volume_name}")
                if pv:
                    resources.append(_resource("PersistentVolume", pv, _fields(pv.get("spec") or {}, (
                        "capacity.storage", "persistentVolumeReclaimPolicy", "storageClassName",
                        "volumeMode", "csi.driver",
                    ))))
    for name in sorted(storage_classes):
        storage_class = fetch(f"/apis/storage.k8s.io/v1/storageclasses/{q(name)}", f"StorageClass {name}")
        if storage_class:
            resources.append(_resource("StorageClass", storage_class, _fields(storage_class, (
                "provisioner", "reclaimPolicy", "allowVolumeExpansion", "volumeBindingMode",
            ), "")))

    if cluster_name:
        scheduled = fetch(f"{cnpg}/scheduledbackups", f"ScheduledBackups in {namespace}")
        for backup in scheduled.get("items") or []:
            backup_spec = backup.get("spec") or {}
            if _value(backup_spec, "cluster.name") == cluster_name:
                resources.append(_resource("ScheduledBackup", backup, _fields(backup_spec, (
                    "cluster.name", "schedule", "suspend", "immediate", "method", "backupOwnerReference",
                ))))
    return {"resources": resources, "unavailable": unavailable}
