{{/*
coder-airgapped platform patch (platform.1), applied by development/tools/apply-platform-patch.py.
String values may hold templates, e.g. host: 'coder.{{ .Values.global.domain }}'. Every template of this chart starts
with an include of "traefik.platform.values", which renders those strings in place (idempotent, so the repeated calls
are harmless), then applies global.imagePullSecrets to .Values.deployment.imagePullSecrets when that is empty.
*/}}
{{- define "traefik.platform.walk" -}}
{{- $node := index . 0 -}}{{- $ctx := index . 1 -}}
{{- if kindIs "map" $node -}}
{{- range $k, $v := $node -}}
{{- if and (kindIs "string" $v) (and (contains "{{" $v) (or (contains ".Values.global" $v) (contains "\"platform." $v))) -}}
{{- $_ := set $node $k (tpl $v $ctx) -}}
{{- else if or (kindIs "map" $v) (kindIs "slice" $v) -}}
{{- include "traefik.platform.walk" (list $v $ctx) -}}
{{- end -}}
{{- end -}}
{{- else if kindIs "slice" $node -}}
{{- range $node -}}
{{- if or (kindIs "map" .) (kindIs "slice" .) -}}
{{- include "traefik.platform.walk" (list . $ctx) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "traefik.platform.values" -}}
{{- range $k, $v := .Values -}}
{{- if ne $k "global" -}}
{{- if and (kindIs "string" $v) (and (contains "{{" $v) (or (contains ".Values.global" $v) (contains "\"platform." $v))) -}}
{{- $_ := set $.Values $k (tpl $v $) -}}
{{- else if or (kindIs "map" $v) (kindIs "slice" $v) -}}
{{- include "traefik.platform.walk" (list $v $) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $g := .Values.global | default dict -}}
{{- if and $g.imagePullSecrets (not .Values.deployment.imagePullSecrets) -}}
{{- $_ := set .Values.deployment "imagePullSecrets" $g.imagePullSecrets -}}
{{- end -}}
{{- end -}}
