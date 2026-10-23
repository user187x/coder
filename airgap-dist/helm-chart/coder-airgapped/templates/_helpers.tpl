{{/* Labels of everything this chart creates itself (subcharts label their own objects). */}}
{{- define "ca.labels" -}}
app.kubernetes.io/part-of: coder
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "ca.uiLabels" -}}
app.kubernetes.io/name: coder-ui-updates
{{ include "ca.labels" . }}
{{- end -}}

{{/* Value of a generated secret key: the given value, else the one already in the cluster, else random. */}}
{{- define "ca.secretValue" -}}
{{- $given := index . 0 -}}{{- $ctx := index . 1 -}}{{- $name := index . 2 -}}{{- $key := index . 3 -}}
{{- if $given -}}
{{- $given -}}
{{- else -}}
{{- $existing := lookup "v1" "Secret" $ctx.Release.Namespace $name -}}
{{- if and $existing $existing.data (hasKey $existing.data $key) -}}
{{- index $existing.data $key | b64dec -}}
{{- else -}}
{{- randAlphaNum 24 -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* In-cluster URL of a Service in the release namespace. */}}
{{- define "ca.svcUrl" -}}
{{- printf "http://%s.%s.svc.cluster.local:%v" (index . 0) (index . 1).Release.Namespace (index . 2) -}}
{{- end -}}

{{/* ------------------------------------------------------------------------------------------------------------
Settings shared by every chart in the tree (named templates are global, so the subcharts' templated values call
these too). All derive from .Values.global; see values.yaml > global.
------------------------------------------------------------------------------------------------------------ */}}
{{- define "platform.coderHost" -}}
{{ .Values.global.coderHost | default (printf "coder.%s" .Values.global.domain) }}
{{- end -}}

{{- /* The Gateway the routes attach to: global.gateway.namespace, or this namespace when the chart brings Traefik
     itself (global.bundled.traefik), else "traefik". */ -}}
{{- define "platform.gatewayNamespace" -}}
{{- $g := .Values.global -}}
{{- if $g.gateway.namespace -}}{{ $g.gateway.namespace }}
{{- else if ($g.bundled | default dict).traefik -}}{{ .Release.Namespace }}
{{- else -}}traefik{{- end -}}
{{- end -}}

{{- define "platform.wildcardHost" -}}
{{- /* A single-label domain ("vm", "lab") cannot take the default "*.<domain>": browsers treat an unknown top-level
     name as a public suffix, so they refuse a wildcard certificate and cookies directly under it (subdomain apps and
     port forwarding break). */ -}}
{{- if and (not .Values.global.wildcardHost) (not (contains "." (toString .Values.global.domain))) -}}
{{- fail (printf "global.domain %q is a single label: browsers refuse a wildcard certificate and cookies directly under it, so the default wildcardHost \"*.%s\" cannot work. Set global.wildcardHost to a name below Coder's, e.g. \"*.coder.%s\" (and the Gateway's certificate for it)." (toString .Values.global.domain) (toString .Values.global.domain) (toString .Values.global.domain)) -}}
{{- end -}}
{{ .Values.global.wildcardHost | default (printf "*.%s" .Values.global.domain) }}
{{- end -}}

{{- define "platform.accessUrl" -}}
https://{{ include "platform.coderHost" . }}
{{- end -}}

{{- define "platform.oidcIssuer" -}}
{{ .Values.global.oidc.issuerUrl | default (printf "https://keycloak.%s/realms/master" .Values.global.domain) }}
{{- end -}}

{{- define "platform.firstUserEmail" -}}
{{ .Values.global.firstUser.email | default (printf "%s@%s" .Values.global.firstUser.username .Values.global.domain) }}
{{- end -}}

{{/* (list $ "ghcr.io/org/image:tag"): the reference as is, or global.registry/<path> (the source registry host
     dropped), which is where ../mirror-images.sh push puts it. */}}
{{- define "platform.image" -}}
{{- $ctx := index . 0 -}}{{- $ref := index . 1 -}}
{{- $reg := trimSuffix "/" ($ctx.Values.global.registry | default "") -}}
{{- if $reg -}}
{{- $parts := splitList "/" $ref -}}
{{- if and (gt (len $parts) 1) (or (contains "." (first $parts)) (contains ":" (first $parts)) (eq (first $parts) "localhost")) -}}
{{- $ref = join "/" (rest $parts) -}}
{{- end -}}
{{- printf "%s/%s" $reg $ref -}}
{{- else -}}
{{- $ref -}}
{{- end -}}
{{- end -}}

{{/* The Argo CD decorator install (values.yaml > global.decorator): which part of the platform this chart installs,
     and whether Coder is decorated by the customization layer (the fork's image and settings). Each gives "true" or
     "", so `if include ...` works, from the subcharts' templated values too (global). */}}
{{- define "platform.hasBase" -}}
{{- if has ((.Values.global.decorator | default dict).part | default "all") (list "all" "base") -}}true{{- end -}}
{{- end -}}

{{- define "platform.hasLayer" -}}
{{- if has ((.Values.global.decorator | default dict).part | default "all") (list "all" "layer") -}}true{{- end -}}
{{- end -}}

{{- define "platform.decorated" -}}
{{- $d := .Values.global.decorator | default dict -}}
{{- if or (eq ($d.part | default "all") "all") $d.layer -}}true{{- end -}}
{{- end -}}

{{/* (list $ "repo"|"tag"): Coder's server image: global.coderImages.fork when decorated, else .upstream (the repo
     with global.registry, as platform.image). */}}
{{- define "platform.coderImage" -}}
{{- $ctx := index . 0 -}}{{- $key := index . 1 -}}
{{- $imgs := $ctx.Values.global.coderImages -}}
{{- $img := ternary $imgs.fork $imgs.upstream (eq (include "platform.decorated" $ctx) "true") -}}
{{- if eq $key "repo" -}}{{ include "platform.image" (list $ctx $img.repo) }}{{- else -}}{{ $img.tag }}{{- end -}}
{{- end -}}

{{/* (list $ "default.registry.host"): global.registry when set, else the default. */}}
{{- define "platform.registryHost" -}}
{{- trimSuffix "/" ((index . 0).Values.global.registry | default (index . 1)) -}}
{{- end -}}

{{/* Renders the templated strings in this chart's own sections (the subcharts render theirs: platform patch),
     then applies global.imagePullSecrets. Called first by every template of this chart. */}}
{{- define "ca.walk" -}}
{{- $node := index . 0 -}}{{- $ctx := index . 1 -}}
{{- if kindIs "map" $node -}}
{{- range $k, $v := $node -}}
{{- if and (kindIs "string" $v) (contains "{{" $v) -}}
{{- $_ := set $node $k (tpl $v $ctx) -}}
{{- else if or (kindIs "map" $v) (kindIs "slice" $v) -}}
{{- include "ca.walk" (list $v $ctx) -}}
{{- end -}}
{{- end -}}
{{- else if kindIs "slice" $node -}}
{{- range $node -}}
{{- if or (kindIs "map" .) (kindIs "slice" .) -}}
{{- include "ca.walk" (list . $ctx) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "ca.values" -}}
{{- range $section := list "database" "secrets" "bootstrap" "uiUpdates" "imageBuilder" "metricsServer" "userStorage" -}}
{{- include "ca.walk" (list (index $.Values $section) $) -}}
{{- end -}}
{{- if and .Values.global.imagePullSecrets (not .Values.uiUpdates.imagePullSecrets) -}}
{{- $_ := set .Values.uiUpdates "imagePullSecrets" .Values.global.imagePullSecrets -}}
{{- end -}}
{{- end -}}
