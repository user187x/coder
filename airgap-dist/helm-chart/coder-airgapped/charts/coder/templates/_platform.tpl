{{/*
coder-airgapped platform patch (platform.1), applied by development/tools/apply-platform-patch.py.
String values may hold templates, e.g. host: 'coder.{{ .Values.global.domain }}'. Every template of this chart starts
with an include of "coder.platform.values", which renders those strings in place (idempotent, so the repeated calls
are harmless), then applies global.imagePullSecrets to .Values.coder.image.pullSecrets when that is empty.
Also appends coder.extraEnv (not an upstream value) to coder.env.
*/}}
{{- define "coder.platform.walk" -}}
{{- $node := index . 0 -}}{{- $ctx := index . 1 -}}
{{- if kindIs "map" $node -}}
{{- range $k, $v := $node -}}
{{- if and (kindIs "string" $v) (contains "{{" $v) -}}
{{- $_ := set $node $k (tpl $v $ctx) -}}
{{- else if or (kindIs "map" $v) (kindIs "slice" $v) -}}
{{- include "coder.platform.walk" (list $v $ctx) -}}
{{- end -}}
{{- end -}}
{{- else if kindIs "slice" $node -}}
{{- range $node -}}
{{- if or (kindIs "map" .) (kindIs "slice" .) -}}
{{- include "coder.platform.walk" (list . $ctx) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "coder.platform.values" -}}
{{- range $k, $v := .Values -}}
{{- if ne $k "global" -}}
{{- if and (kindIs "string" $v) (contains "{{" $v) -}}
{{- $_ := set $.Values $k (tpl $v $) -}}
{{- else if or (kindIs "map" $v) (kindIs "slice" $v) -}}
{{- include "coder.platform.walk" (list $v $) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $g := .Values.global | default dict -}}
{{- if and $g.imagePullSecrets (not .Values.coder.image.pullSecrets) -}}
{{- $_ := set .Values.coder.image "pullSecrets" $g.imagePullSecrets -}}
{{- end -}}
{{- if and .Values.coder.extraEnv (not (hasKey .Values.coder "platformExtraEnvMerged")) -}}
{{- $_ := set .Values.coder "env" (concat (.Values.coder.env | default list) .Values.coder.extraEnv) -}}
{{- $_ := set .Values.coder "platformExtraEnvMerged" true -}}
{{- end -}}
{{- end -}}
