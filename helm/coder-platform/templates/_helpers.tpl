{{/* Labels every object of the release carries. */}}
{{- define "cp.labels" -}}
app.kubernetes.io/part-of: coder-platform
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end }}

{{/* The Coder image. */}}
{{- define "cp.coderImage" -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- end }}

{{/* accessURL, validated. */}}
{{- define "cp.accessURL" -}}
{{- $url := required "accessURL is required, e.g. https://coder.example.com" .Values.accessURL | trimSuffix "/" }}
{{- if not (regexMatch "^https?://[^/]+$" $url) }}
{{- fail (printf "accessURL must be a scheme and host without a path, e.g. https://coder.example.com (got %q)" $url) }}
{{- end }}
{{- $url }}
{{- end }}

{{/* The host of accessURL. */}}
{{- define "cp.host" -}}
{{- regexReplaceAll "^https?://([^/:]+).*$" (include "cp.accessURL" .) "${1}" }}
{{- end }}

{{/* The wildcard host without a scheme (*.example.com), or empty. */}}
{{- define "cp.wildcardHost" -}}
{{- regexReplaceAll "^https?://" .Values.wildcardAccessURL "" | trimSuffix "/" }}
{{- end }}

{{/* The Secret and key holding Coder's PostgreSQL connection URL. */}}
{{- define "cp.dbSecretName" -}}
{{- if .Values.postgres.enabled }}coder-db{{ else }}{{ required "postgres.external.secretName is required when postgres.enabled is false" .Values.postgres.external.secretName }}{{ end }}
{{- end }}
{{- define "cp.dbSecretKey" -}}
{{- if .Values.postgres.enabled }}uri{{ else }}{{ .Values.postgres.external.secretKey | default "uri" }}{{ end }}
{{- end }}

{{/* The first admin's password Secret. */}}
{{- define "cp.firstUserSecret" -}}
{{- .Values.firstUser.existingSecret | default "coder-first-user" }}
{{- end }}

{{/* Namespaces workspaces run in: the release namespace and workspaces.namespaces. */}}
{{- define "cp.workspaceNamespaces" -}}
{{- $all := list .Release.Namespace }}
{{- range .Values.workspaces.namespaces }}{{ if not (has . $all) }}{{ $all = append $all . }}{{ end }}{{ end }}
{{- toJson $all }}
{{- end }}

{{/* Pod settings shared by every workload: pull secrets, node placement. */}}
{{- define "cp.podPlacement" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- range . }}
  - name: {{ . }}
  {{- end }}
{{- end }}
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/* A restricted container security context. */}}
{{- define "cp.containerSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: [ALL]
{{- end }}
