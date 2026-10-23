#!/usr/bin/env bash
# Installs (or upgrades) the coder-airgapped chart. Re-runnable: existing Secrets/ConfigMaps are left alone unless
# --force-secrets is given.
#
#   ./install.sh -f my-values.yaml [options]
#
#   -f, --values FILE        values file(s) for the chart (repeatable; e.g. a copy of values-eks-airgap.example.yaml)
#   --ca FILE                CA bundle that signed the Gateway certificate     -> Secret tls-ca (ca.crt)
#   --oidc-ca FILE           CA of the OIDC provider (Keycloak)                -> Secret keycloaking-coder-ca (ca.crt)
#   --oidc-secret-file FILE  file holding the OIDC client secret               -> Secret keycloaking-coder-oidc (client-secret)
#   --tls-crt FILE --tls-key FILE   wildcard certificate                       -> Secret tls-wild-cert
#   --pull-secret REGISTRY   create Secret registry-pull from $REGISTRY_USERNAME / $REGISTRY_PASSWORD
#   --cnpg                   also install the CloudNativePG operator from prereqs/ (namespace cnpg-system);
#                            set CNPG_IMAGE to mirror ghcr.io/cloudnative-pg/cloudnative-pg:1.30.0
#   --namespace NS           default: coder (the workspace template only accepts "coder")
#   --release NAME           default: coder
#   --secret-name KEY=NAME   the Secret names, when global.secretNames renames them (repeatable):
#                            tlsCa, oidcCa, oidcClient, wildcardTls (defaults: tls-ca, keycloaking-coder-ca, ...)
#   --prepare-only           only the namespace, Secrets and default logo/avatar ConfigMaps: for Argo CD, which
#                            then installs the chart (argocd/coder-airgapped-application.yaml)
#   --force-secrets          replace the Secrets above when they already exist
#   --dry-run                render and validate against the cluster, change nothing
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
chart="${here}/coder-airgapped"
ns=coder release=coder
values=() ca="" oidc_ca="" oidc_secret="" tls_crt="" tls_key="" pull_registry="" cnpg=0 force=0 dry=0 prepare=0
declare -A sname=([tlsCa]=tls-ca [oidcCa]=keycloaking-coder-ca [oidcClient]=keycloaking-coder-oidc [wildcardTls]=tls-wild-cert)

while (($#)); do
	case "$1" in
	-f | --values) values+=(-f "$2"); shift 2 ;;
	--ca) ca="$2"; shift 2 ;;
	--oidc-ca) oidc_ca="$2"; shift 2 ;;
	--oidc-secret-file) oidc_secret="$2"; shift 2 ;;
	--tls-crt) tls_crt="$2"; shift 2 ;;
	--tls-key) tls_key="$2"; shift 2 ;;
	--pull-secret) pull_registry="$2"; shift 2 ;;
	--cnpg) cnpg=1; shift ;;
	--namespace) ns="$2"; shift 2 ;;
	--release) release="$2"; shift 2 ;;
	--force-secrets) force=1; shift ;;
	--secret-name)
		[[ "$2" == *=* && -n "${sname[${2%%=*}]+x}" ]] || { echo "--secret-name KEY=NAME, KEY one of: ${!sname[*]}" >&2; exit 2; }
		sname[${2%%=*}]="${2#*=}"; shift 2 ;;
	--prepare-only) prepare=1; shift ;;
	--dry-run) dry=1; shift ;;
	-h | --help) sed -n '2,/^set /p' "$0" | sed '$d'; exit 0 ;;
	*) echo "unknown option: $1" >&2; exit 2 ;;
	esac
done

log() { printf '\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33mWARN: %s\033[0m\n' "$*" >&2; }
die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

for bin in kubectl helm; do command -v "$bin" >/dev/null || die "$bin not found"; done
kubectl version --request-timeout=10s >/dev/null 2>&1 || die "kubectl cannot reach the cluster"
[[ "$ns" == coder ]] || warn "the workspace template only accepts namespace \"coder\" (got \"$ns\")"

# ---- prerequisites --------------------------------------------------------------------------------------------
if ((cnpg)) && ! ((dry)); then
	log "CloudNativePG operator (prereqs/cloudnative-pg-0.29.0.tgz)"
	img=()
	if [[ -n "${CNPG_IMAGE:-}" ]]; then img=(--set "image.repository=${CNPG_IMAGE%:*}" --set "image.tag=${CNPG_IMAGE##*:}"); fi
	helm upgrade --install cnpg "${here}/prereqs/cloudnative-pg-0.29.0.tgz" -n cnpg-system --create-namespace --wait "${img[@]}" >/dev/null
fi
missing=0
((prepare)) || for crd in clusters.postgresql.cnpg.io httproutes.gateway.networking.k8s.io middlewares.traefik.io; do
	kubectl get crd "$crd" >/dev/null 2>&1 || { warn "CRD $crd missing"; missing=1; }
done
((missing == 0)) || die "install the prerequisites first (README.md > Prerequisites; --cnpg installs CloudNativePG)"

# ---- namespace, Secrets, default images -----------------------------------------------------------------------
# Server-side apply: the default logo/avatar ConfigMaps (up to 1 MB) exceed client-side apply's 256 KB annotation.
apply() {
	local args=(apply --server-side --force-conflicts --field-manager=coder-airgapped-install -f -)
	if ((dry)); then kubectl "${args[@]}" --dry-run=server >/dev/null; else kubectl "${args[@]}" >/dev/null; fi
}
exists() { kubectl -n "$ns" get "$1" "$2" >/dev/null 2>&1; }

if ! kubectl get ns "$ns" >/dev/null 2>&1; then
	log "namespace $ns"
	((dry)) || kubectl create ns "$ns" >/dev/null
fi

secret_from() { # name, kubectl create secret args...
	local name="$1"; shift
	if exists secret "$name" && ! ((force)); then echo "    secret/$name exists (kept)"; return; fi
	kubectl -n "$ns" create secret "$@" --dry-run=client -o yaml | apply
	echo "    secret/$name $( ((force)) && echo replaced || echo created)"
}
log "Secrets"
[[ -z "$ca" ]] || secret_from "${sname[tlsCa]}" generic "${sname[tlsCa]}" --from-file=ca.crt="$ca"
[[ -z "$oidc_ca" ]] || secret_from "${sname[oidcCa]}" generic "${sname[oidcCa]}" --from-file=ca.crt="$oidc_ca"
[[ -z "$oidc_secret" ]] || secret_from "${sname[oidcClient]}" generic "${sname[oidcClient]}" --from-literal=client-secret="$(tr -d '\r\n' <"$oidc_secret")"
if [[ -n "$tls_crt" || -n "$tls_key" ]]; then
	[[ -n "$tls_crt" && -n "$tls_key" ]] || die "--tls-crt and --tls-key go together"
	secret_from "${sname[wildcardTls]}" tls "${sname[wildcardTls]}" --cert="$tls_crt" --key="$tls_key"
fi
if [[ -n "$pull_registry" ]]; then
	[[ -n "${REGISTRY_USERNAME:-}" && -n "${REGISTRY_PASSWORD:-}" ]] || die "--pull-secret needs REGISTRY_USERNAME and REGISTRY_PASSWORD"
	secret_from registry-pull docker-registry registry-pull --docker-server="$pull_registry" \
		--docker-username="$REGISTRY_USERNAME" --docker-password="$REGISTRY_PASSWORD"
	warn "add imagePullSecrets: [{name: registry-pull}] to your values (coder.coder.image.pullSecrets, uiUpdates, coder-workspace)"
fi
for k in tlsCa wildcardTls; do
	s="${sname[$k]}"
	((dry)) || exists secret "$s" || warn "secret/$s is missing: Coder will not start until it exists (see options above)"
done
# Keycloak's: Coder starts without them, with password sign-in only, and reads them when it next restarts.
for k in oidcCa oidcClient; do
	s="${sname[$k]}"
	((dry)) || exists secret "$s" ||
		warn "secret/$s is missing: Coder starts with password sign-in only; create it (see options above) and restart Coder for Keycloak sign-in"
done

log "Default logo / avatar ConfigMaps (defaults/)"
for kind in logo avatar; do
	f=$(ls "${here}/defaults/${kind}."* 2>/dev/null | head -n1 || true)
	[[ -n "$f" ]] || { echo "    no defaults/${kind}.*"; continue; }
	cm="coder-ui-updates-default-${kind}"
	# past a ConfigMap's 1 MiB (the animated logo): the service's image has it (build-ui-image.sh), no ConfigMap
	if (($(stat -c %s "$f") > 1000000)); then
		echo "    defaults/$(basename "$f"): in the service's image (over a ConfigMap's 1 MiB)"
		kubectl -n "$ns" delete configmap "$cm" --ignore-not-found >/dev/null
		continue
	fi
	if exists configmap "$cm" && ! ((force)); then echo "    configmap/$cm exists (kept)"; continue; fi
	kubectl -n "$ns" create configmap "$cm" --from-file="$(basename "$f")=$f" --dry-run=client -o yaml |
		kubectl label --local -f - app.kubernetes.io/name=coder-ui-updates app.kubernetes.io/part-of=coder -o yaml | apply
	echo "    configmap/$cm from $(basename "$f")"
done

# Pictures the logo and avatar editors offer: one ConfigMap per file (a ConfigMap holds at most 1 MiB), kept equal to
# defaults/gallery/ (sorted by name; slots past the last file are removed). At most 8 (gallerySlots in values.yaml).
log "Logo / avatar gallery ConfigMaps (defaults/gallery/)"
i=0
for f in "${here}"/defaults/gallery/*; do
	[[ -f "$f" ]] || continue
	i=$((i + 1)); ((i <= 8)) || { warn "defaults/gallery: more than 8 pictures, $(basename "$f") left out"; continue; }
	kubectl -n "$ns" create configmap "coder-ui-updates-gallery-${i}" --from-file="$(basename "$f")=$f" --dry-run=client -o yaml |
		kubectl label --local -f - app.kubernetes.io/name=coder-ui-updates app.kubernetes.io/part-of=coder -o yaml | apply
	echo "    configmap/coder-ui-updates-gallery-${i} from $(basename "$f")"
done
for ((j = i + 1; j <= 8; j++)); do
	if ! ((dry)) && exists configmap "coder-ui-updates-gallery-${j}"; then
		kubectl -n "$ns" delete configmap "coder-ui-updates-gallery-${j}" >/dev/null && echo "    configmap/coder-ui-updates-gallery-${j} removed"
	fi
done

if ((prepare)); then
	log "Prepared namespace $ns for Argo CD (Secrets: ${sname[*]})"
	exit 0
fi

# ---- the chart ------------------------------------------------------------------------------------------------
if ((dry)); then
	log "helm template | kubectl apply --dry-run=server"
	helm template "$release" "$chart" -n "$ns" "${values[@]}" | kubectl apply --dry-run=server -f - | sed 's/^/    /'
	exit 0
fi
log "helm upgrade --install $release ($ns)"
helm upgrade --install "$release" "$chart" -n "$ns" "${values[@]}" --wait --timeout 20m >/dev/null
log "Done"
helm -n "$ns" status "$release" | sed -n '/NOTES:/,$p'
