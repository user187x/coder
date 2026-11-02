{{/*
coder-airgapped platform patch (platform.1), applied by development/tools/apply-platform-patch.py.
String values may hold templates, e.g. host: 'coder.{{ .Values.global.domain }}'. Every template of this chart starts
with an include of "coder-workspace.platform.values", which renders those strings in place (idempotent, so the repeated calls
are harmless), then applies global.imagePullSecrets to .Values.imagePullSecrets when that is empty.
*/}}
{{- define "coder-workspace.platform.walk" -}}
{{- $node := index . 0 -}}{{- $ctx := index . 1 -}}
{{- if kindIs "map" $node -}}
{{- range $k, $v := $node -}}
{{- if and (kindIs "string" $v) (contains "{{" $v) -}}
{{- $_ := set $node $k (tpl $v $ctx) -}}
{{- else if or (kindIs "map" $v) (kindIs "slice" $v) -}}
{{- include "coder-workspace.platform.walk" (list $v $ctx) -}}
{{- end -}}
{{- end -}}
{{- else if kindIs "slice" $node -}}
{{- range $node -}}
{{- if or (kindIs "map" .) (kindIs "slice" .) -}}
{{- include "coder-workspace.platform.walk" (list . $ctx) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "coder-workspace.platform.values" -}}
{{- range $k, $v := .Values -}}
{{- if ne $k "global" -}}
{{- if and (kindIs "string" $v) (contains "{{" $v) -}}
{{- $_ := set $.Values $k (tpl $v $) -}}
{{- else if or (kindIs "map" $v) (kindIs "slice" $v) -}}
{{- include "coder-workspace.platform.walk" (list $v $) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $g := .Values.global | default dict -}}
{{- if and $g.imagePullSecrets (not .Values.imagePullSecrets) -}}
{{- $_ := set .Values "imagePullSecrets" $g.imagePullSecrets -}}
{{- end -}}
{{- end -}}
