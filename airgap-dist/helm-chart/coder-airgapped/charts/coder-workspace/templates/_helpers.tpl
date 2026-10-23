{{- define "coder-workspace.prefix" -}}
{{ .Values.namePrefix | default .Release.Name }}
{{- end -}}
