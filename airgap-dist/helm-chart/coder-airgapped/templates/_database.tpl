{{- /* The database (CloudNativePG Cluster) and its pooler, as templates/database.yaml renders them - or, with the
     chart's own CloudNativePG (global.bundled.cloudnativePG), the database Job applies them once the operator's
     webhook answers (templates/database-apply.yaml). Context: the root. */ -}}
{{- define "platform.dbCluster" -}}
{{- $db := .Values.database }}
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: {{ $db.name }}
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "ca.labels" . | nindent 4 }}
  {{- if $db.keep }}
  annotations:
    helm.sh/resource-policy: keep
    # Argo CD ignores the Helm policy: never prune or delete the database with the Application.
    argocd.argoproj.io/sync-options: Prune=false,Delete=false
  {{- end }}
spec:
  instances: {{ $db.instances }}
  {{- with $db.imageName }}
  imageName: {{ . }}
  {{- end }}
  primaryUpdateStrategy: {{ $db.primaryUpdateStrategy }}
  storage:
    size: {{ $db.storage.size }}
    {{- /* an existing Cluster keeps its storage class (it cannot change); a new one takes the value, empty: the default */}}
    {{- $sc := $db.storage.storageClass }}
    {{- with (lookup "postgresql.cnpg.io/v1" "Cluster" .Release.Namespace $db.name) }}
    {{- $sc = .spec.storage.storageClass | default $sc }}
    {{- end }}
    {{- with $sc }}
    storageClass: {{ . }}
    {{- end }}
  {{- with $db.affinity }}
  affinity:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with $db.resources }}
  resources:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with $db.synchronous }}
  # Synchronous replication: a commit waits for a standby (database.synchronous).
  postgresql:
    synchronous:
      {{- toYaml . | nindent 6 }}
  {{- end }}
  {{- if $db.pooler.enabled }}
  # The pooler's Service names in the server certificate: its clients (code-server HA's relays) verify the host.
  certificates:
    serverAltDNSNames:
      {{- $pooler := printf "%s-pooler-rw" $db.name }}
      - {{ $pooler }}
      - {{ printf "%s.%s" $pooler .Release.Namespace }}
      - {{ printf "%s.%s.svc" $pooler .Release.Namespace }}
      - {{ printf "%s.%s.svc.cluster.local" $pooler .Release.Namespace }}
  {{- end }}
  {{- if and .Values.codeServerHA.enabled .Values.uiUpdates.enabled }}
  # code-server HA's relays (templates/code-server-ha.yaml): a login that may only call its schema's functions.
  managed:
    roles:
      - name: code_server_relay
        ensure: present
        login: true
        inherit: false
        connectionLimit: 500
        passwordSecret:
          name: coder-code-server-ha-relay
  {{- end }}
{{- end -}}

{{- define "platform.dbPooler" -}}
{{- $db := .Values.database }}
# PgBouncer for the platform's short clients (database.pooler): transaction mode, its own image (air gap), spread over
# nodes and zones, one pod down at a time.
apiVersion: postgresql.cnpg.io/v1
kind: Pooler
metadata:
  name: {{ $db.name }}-pooler-rw
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "ca.labels" . | nindent 4 }}
spec:
  cluster:
    name: {{ $db.name }}
  instances: {{ $db.pooler.instances }}
  type: rw
  pgbouncer:
    poolMode: transaction
    parameters:
      {{- range $k, $v := $db.pooler.parameters }}
      {{ $k }}: {{ $v | toString | quote }}
      {{- end }}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: coder-db-pooler
        app.kubernetes.io/part-of: coder
    spec:
      {{- with .Values.global.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      containers:
        - name: pgbouncer
          image: {{ $db.pooler.image }}
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                topologyKey: kubernetes.io/hostname
                labelSelector:
                  matchLabels: {app.kubernetes.io/name: coder-db-pooler}
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels: {app.kubernetes.io/name: coder-db-pooler}
{{- end -}}

{{- /* The database is applied by the database Job, not by Helm (the chart brings CloudNativePG itself). */ -}}
{{- define "platform.dbByJob" -}}
{{- if (.Values.global.bundled | default dict).cloudnativePG }}true{{ end -}}
{{- end -}}
