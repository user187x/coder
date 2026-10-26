{{- define "platform.nekoValidate" -}}
{{- $media := .Values.global.nekoMedia | default dict -}}
{{- if not (kindIs "bool" $media.enabled) -}}
{{- fail "global.nekoMedia.enabled must be a boolean" -}}
{{- end -}}
{{- if $media.enabled -}}
{{- $_ := required "Neko requires an operator-created descriptor key Secret" $media.descriptorKeySecretName -}}
{{- $_ := required "Neko requires an explicit LAN/VPN advertised IPv4 address" $media.advertiseIP -}}
{{- $octet := "(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])" -}}
{{- $ipv4 := printf "^(%s\\.){3}%s$" $octet $octet -}}
{{- if not (regexMatch $ipv4 $media.advertiseIP) -}}
{{- fail "Neko advertised address must be a canonical IPv4 address" -}}
{{- end -}}
{{- if not (regexMatch "^[0-9a-f]{64}$" ($media.clientManifestSHA256 | default "")) -}}
{{- fail "Neko requires the qualified client manifest SHA256" -}}
{{- end -}}
{{- range $name := list "clientCIDRs" "peerCIDRs" "relayCIDRs" "guestImages" -}}
{{- $items := index $media $name -}}
{{- if or (not (kindIs "slice" $items)) (not $items) -}}
{{- fail (printf "Neko requires an explicit %s allowlist" $name) -}}
{{- end -}}
{{- if gt (len $items) (ternary 32 16 (eq $name "guestImages")) -}}
{{- fail (printf "Neko %s allowlist exceeds its bound" $name) -}}
{{- end -}}
{{- range $item := $items -}}
{{- if not (kindIs "string" $item) -}}
{{- fail (printf "Neko %s entries must be strings" $name) -}}
{{- end -}}
{{- if eq $name "guestImages" -}}
{{- if not (regexMatch "^[^[:space:]@]+@sha256:[0-9a-f]{64}$" $item) -}}
{{- fail "Neko guest images must be pinned by SHA256 digest" -}}
{{- end -}}
{{- else -}}
{{- $parts := splitList "/" $item -}}
{{- if ne (len $parts) 2 -}}
{{- fail (printf "Neko %s requires canonical IPv4 CIDRs" $name) -}}
{{- end -}}
{{- if or (not (regexMatch $ipv4 (index $parts 0))) (not (regexMatch "^(8|9|[12][0-9]|3[0-2])$" (index $parts 1))) -}}
{{- fail (printf "Neko %s requires bounded IPv4 CIDRs with prefix length 8 through 32" $name) -}}
{{- end -}}
{{- $bytes := splitList "." (index $parts 0) -}}
{{- $number := add (mul (int (index $bytes 0)) 16777216) (mul (int (index $bytes 1)) 65536) (mul (int (index $bytes 2)) 256) (int (index $bytes 3)) -}}
{{- $block := int64 1 -}}
{{- range until (sub 32 (int (index $parts 1)) | int) -}}
{{- $block = mul $block 2 -}}
{{- end -}}
{{- if ne (mod $number $block) 0 -}}
{{- fail (printf "Neko %s CIDRs must use their network address" $name) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- range $name := list "portMin" "portMax" "maxLeases" "packetsPerSecond" "lifetimeMilliseconds" -}}
{{- $value := index $media $name -}}
{{- if or (not (or (kindIs "int" $value) (kindIs "int64" $value) (kindIs "float64" $value))) (not (regexMatch "^[0-9]+$" (toString $value))) -}}
{{- fail (printf "Neko %s must be an integer number" $name) -}}
{{- end -}}
{{- end -}}
{{- $minimum := int $media.portMin -}}{{- $maximum := int $media.portMax -}}
{{- $count := add1 (sub $maximum $minimum) -}}
{{- if or (lt $minimum 30000) (gt $maximum 32767) (lt $count 2) (gt $count 128) (ne (mod $count 2) 0) (lt (int $media.maxLeases) 1) (gt (int $media.maxLeases) (div $count 2)) -}}
{{- fail "Neko requires an even, bounded NodePort pool with two ports per lease" -}}
{{- end -}}
{{- if not (has $media.service.type (list "NodePort" "LoadBalancer")) -}}
{{- fail "Neko media service must be an explicitly routed NodePort or internal LoadBalancer" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "platform.nekoCoderValues" -}}
{{- include "platform.nekoValidate" . -}}
{{- $media := .Values.global.nekoMedia -}}
{{- if and $media.enabled (not (hasKey .Values.coder "platformNekoMerged")) -}}
{{- $config := dict "enabled" true "advertise_ip" $media.advertiseIP "client_cidrs" $media.clientCIDRs "peer_cidrs" $media.peerCIDRs "port_min" $media.portMin "port_max" $media.portMax "max_leases" $media.maxLeases "packets_per_second" $media.packetsPerSecond "lifetime_ms" $media.lifetimeMilliseconds "descriptor_origin" (printf "http://coder-ui-updates.%s.svc.cluster.local" .Release.Namespace) "descriptor_key_file" "/run/coder-neko/descriptor-key" "client_directory" $media.clientDirectory "client_manifest_sha256" $media.clientManifestSHA256 -}}
{{- $env := list (dict "name" "CODER_NEKO_MEDIA_CONFIG" "value" ($config | toJson)) (dict "name" "CODER_NEKO_MEDIA_BIND_IP" "valueFrom" (dict "fieldRef" (dict "fieldPath" "status.podIP"))) -}}
{{- $_ := set .Values.coder "env" (concat (.Values.coder.env | default list) $env) -}}
{{- $_ := set .Values.coder "volumeMounts" (concat (.Values.coder.volumeMounts | default list) (list (dict "name" "neko-media-key" "mountPath" "/run/coder-neko" "readOnly" true))) -}}
{{- $_ := set .Values.coder "volumes" (concat (.Values.coder.volumes | default list) (list (dict "name" "neko-media-key" "secret" (dict "secretName" $media.descriptorKeySecretName "defaultMode" 288)))) -}}
{{- $context := .Values.coder.podSecurityContext | default dict -}}
{{- if not (hasKey $context "fsGroup") -}}
{{- $_ := set $context "fsGroup" (.Values.coder.securityContext.runAsGroup | default .Values.coder.securityContext.runAsUser | default 1000) -}}
{{- end -}}
{{- $_ := set .Values.coder "podSecurityContext" $context -}}
{{- $_ := set .Values.coder "platformNekoMerged" true -}}
{{- end -}}
{{- end -}}
