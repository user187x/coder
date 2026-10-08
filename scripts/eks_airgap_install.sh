#!/usr/bin/env bash

# Stands up this repository's Coder (helm/coder-platform: Coder with its dashboard, PostgreSQL, the platform and
# banner services, and the first admin) on a new, minimal Amazon EKS cluster whose nodes have no internet access.
#
# Run `eks_airgap_install.sh help` for usage. Every answer can be given ahead of time as an environment variable or
# in a config file (KEY=value lines, see `help`), so the script also runs unattended with --yes.

set -euo pipefail

if ((BASH_VERSINFO[0] < 4)); then
	echo "bash 4 or newer is required (on macOS: brew install bash)." >&2
	exit 1
fi

readonly CODER_REPO_URL="https://github.com/user187x/coder.git"
readonly ARGOCD_HELM_REPO="https://argoproj.github.io/argo-helm"
readonly NAMESPACE="coder-platform"
readonly RELEASE="coder-platform"
readonly TAG_KEY="coder-airgap"
readonly CHART_REPO_URL="http://coder-charts.argocd.svc.cluster.local"
# Interface endpoints EKS nodes need without internet access: EC2 (VPC CNI, EBS CSI), ECR (images), STS and EKS.
readonly INTERFACE_ENDPOINTS="ec2 ecr.api ecr.dkr sts eks"
# Zone IDs where EKS doesn't place control planes.
readonly EKS_UNSUPPORTED_ZONE_IDS=" use1-az3 usw1-az2 cac1-az3 "
readonly PHASES="images network iam cluster nodes addons platform template lockdown"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMAND=""
CONFIG_FILE=""
BUNDLE_FILE="${BUNDLE_FILE:-}"
OUTPUT_FILE=""
FROM_PHASE=""
ASSUME_YES=0
WORK_DIR="${WORK_DIR:-}"
TMP_DIR=""
CONFIG_KEYS=()

# Images the install uses, as paths relative to the registry (set from the artifacts' manifest).
IMG_CODER="" IMG_POSTGRES="" IMG_PLATFORM="" IMG_BANNER="" IMG_SETUP="" IMG_WORKSPACE="" IMG_ARGOCD="" IMG_REDIS=""
IMG_EXTRA="" CHART_FILE="" CHART_VERSION="" APP_VERSION="" ARGOCD_CHART_FILE="" CODE_SERVER_RESOLVED=""
BUNDLE_ARCH="" ACCOUNT_ID="" PARTITION="" REGISTRY="" VPC_CIDR_ACTUAL=""
# EKS defaults; the minikube command changes them.
STORAGE_CLASS="" WORKSPACE_PULL_POLICY=Always MINIKUBE_PROFILE="${MINIKUBE_PROFILE:-}"

usage() {
	cat <<'EOF'
Stands up this repository's Coder on a new, minimal EKS cluster with no internet access from the cluster.

Usage:
  eks_airgap_install.sh install [--config FILE] [--bundle FILE] [--from PHASE] [--yes]
  eks_airgap_install.sh bundle  [--config FILE] [--output FILE] [--yes]
  eks_airgap_install.sh destroy [--config FILE] [--work-dir DIR] [--yes]
  eks_airgap_install.sh minikube [--profile NAME] [--bundle FILE] [--yes]
  eks_airgap_install.sh destroy --profile NAME

Commands:
  install   Asks for what it needs, then creates the network, EKS cluster, node group, ECR images and Coder.
            Safe to run again: finished resources are reused, so a failed run resumes where it stopped.
  bundle    On a machine with internet access: downloads and builds everything the install needs into one
            file (images, charts, Terraform providers, code-server). Use it when the machine that runs
            `install` can reach AWS but not the internet: copy the file across and pass --bundle.
  destroy   Deletes everything `install` created (asks before deleting the ECR images), or with --profile,
            everything `minikube` installed.
  minikube  Tries the same install on a running local minikube cluster: the same images (loaded into the nodes
            under names no registry serves, so nothing can come from the internet), Helm by default, the same
            template. No AWS needed. Uses the local-path StorageClass (minikube addon storage-provisioner-rancher).

Options:
  --config FILE   KEY=value answers (the install writes its own to <work dir>/config.env)
  --bundle FILE   install from a bundle instead of downloading
  --output FILE   where `bundle` writes (default: ./coder-eks-airgap-<version>-<arch>.tar)
  --from PHASE    skip the phases before PHASE: images network iam cluster nodes addons platform template lockdown
  --work-dir DIR  where config, state, kubeconfig and logs go (default: ./coder-eks-<cluster>, or
                  ./coder-minikube-<profile>)
  --profile NAME  the minikube profile (default: the current kubectl context's profile)
  -y, --yes       never prompt: use defaults and given answers, fail on missing required answers

What the cluster looks like:
  - Private subnets only: no internet gateway, no NAT gateway. Nodes reach AWS through VPC endpoints
    (ec2, ecr.api, ecr.dkr, sts, eks, and an S3 gateway) and pull every image from ECR.
  - The API endpoint is private. During the install it's also public for your address only, so this machine can
    reach it; ENDPOINT_ACCESS=public-then-private (the default) turns the public side off at the end.
  - One managed node group (Amazon Linux 2023), the EBS CSI driver, a default gp3 StorageClass.
  - Coder with telemetry, update checks, STUN and the template builder off, a Coder image whose Terraform installs
    providers from a mirror built into it, and a Kubernetes workspace template whose image has code-server.

Needs: AWS CLI v2 with credentials that may create VPC, IAM, EKS, EC2 and ECR resources; kubectl; helm 3.8+;
docker with buildx (bundle and online installs); curl; tar; git when the chart isn't next to this script.

Answers (environment variables or config file keys; the prompts show defaults):
  AWS_REGION CLUSTER_NAME K8S_VERSION ARCH INSTANCE_TYPE NODE_COUNT NODE_DISK_GB
  VPC_MODE (new|existing) VPC_CIDR AZ_COUNT VPC_ID SUBNET_IDS
  ENDPOINT_ACCESS (public-then-private|public-restricted|private) ADMIN_CIDR API_PRIVATE_CIDRS EXTRA_ADMIN_ARNS
  ECR_PREFIX TF_PROVIDERS WORKSPACE_IMAGE CODE_SERVER_VERSION EXTRA_IMAGES CHART_REF ARGOCD_CHART_VERSION
  INSTALL_METHOD (argocd|helm) EXPOSE (internal-lb|port-forward) ACCESS_URL WILDCARD_ACCESS_URL
  ADMIN_USERNAME ADMIN_EMAIL OIDC_ENABLED OIDC_ISSUER_URL OIDC_CLIENT_ID OIDC_CLIENT_SECRET OIDC_SIGN_IN_TEXT
  CA_PEM_FILE CREATE_TEMPLATE
EOF
}

# ---- Output -----------------------------------------------------------------------------------------------------

log() { printf '\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n' "$*" >&2; }
info() { printf '    %s\n' "$*" >&2; }
warn() { printf '\033[1;33mWARNING:\033[0m %s\n' "$*" >&2; }
die() {
	printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2
	exit 1
}
section() { printf '\n\033[1m-- %s --\033[0m\n' "$*" >&2; }

need_cmd() {
	local c
	for c in "$@"; do
		command -v "$c" >/dev/null 2>&1 || die "'$c' is required but not installed."
	done
}

cleanup() {
	if [[ -n $TMP_DIR && -d $TMP_DIR ]]; then
		rm -rf "$TMP_DIR"
	fi
}
trap cleanup EXIT

sha256() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$@"
	else
		shasum -a 256 "$@"
	fi
}

# ---- Answers, config and state ----------------------------------------------------------------------------------

# interactive reports whether the script may prompt.
interactive() { ((ASSUME_YES == 0)) && [[ -t 0 ]]; }

# ask VAR QUESTION DEFAULT [REGEX] sets VAR from the environment or config, the prompt, or DEFAULT, and checks it
# against REGEX. A REGEX that rejects "" makes the answer required.
ask() {
	local var=$1 question=$2 def=${3-} re=${4-} answer
	CONFIG_KEYS+=("$var")
	if [[ -n ${!var+x} ]]; then
		answer=${!var}
	elif interactive; then
		while :; do
			read -r -p "$question [${def}]: " answer || die "No answer for $var."
			answer=${answer:-$def}
			answer=$(normalize_yes_no "$re" "$answer")
			if [[ -z $re || $answer =~ $re ]]; then
				break
			fi
			warn "'$answer' isn't valid here (expected $re)."
		done
	else
		answer=$def
	fi
	answer=$(normalize_yes_no "$re" "$answer")
	if [[ -n $re && ! $answer =~ $re ]]; then
		die "$var='$answer' isn't valid (expected $re). Set it in the environment or the config file."
	fi
	printf -v "$var" '%s' "$answer"
}

normalize_yes_no() {
	if [[ $1 == '^(yes|no)$' ]]; then
		case "${2,,}" in
		y | yes | true) echo yes ;;
		n | no | false) echo no ;;
		*) echo "$2" ;;
		esac
	else
		echo "$2"
	fi
}

ask_secret() {
	local var=$1 question=$2 answer
	if [[ -n ${!var:-} ]]; then
		return
	fi
	interactive || die "$var is required. Set it in the environment."
	read -r -s -p "$question: " answer || die "No answer for $var."
	echo >&2
	[[ -n $answer ]] || die "$var can't be empty."
	printf -v "$var" '%s' "$answer"
}

# load_kv FILE sets each KEY=value from FILE unless KEY is already set, so the environment wins over files.
load_kv() {
	local line key
	[[ -f $1 ]] || return 0
	while IFS= read -r line || [[ -n $line ]]; do
		[[ $line =~ ^[A-Z_][A-Z0-9_]*= ]] || continue
		key=${line%%=*}
		if [[ -z ${!key+x} ]]; then
			eval "$line"
		fi
	done <"$1"
}

save_config() {
	local key file=$WORK_DIR/config.env
	{
		echo "# Answers for eks_airgap_install.sh (secrets are never written here)."
		for key in $(printf '%s\n' "${CONFIG_KEYS[@]}" | awk '!seen[$0]++'); do
			printf '%s=%q\n' "$key" "${!key}"
		done
	} >"$file"
}

state_set() {
	local file=$WORK_DIR/state.env
	touch "$file"
	grep -v "^$1=" "$file" >"$file.tmp" || true
	printf '%s=%q\n' "$1" "$2" >>"$file.tmp"
	mv "$file.tmp" "$file"
	printf -v "$1" '%s' "$2"
}

state_load() {
	if [[ -f $WORK_DIR/state.env ]]; then
		# shellcheck disable=SC1091
		source "$WORK_DIR/state.env"
	fi
}

# ---- AWS helpers ------------------------------------------------------------------------------------------------

awsr() { aws --region "$AWS_REGION" --output text "$@"; }

# tagspec TYPE NAME [EXTRA] is an EC2 --tag-specifications value tagging the resource as this install's.
tagspec() {
	printf 'ResourceType=%s,Tags=[{Key=Name,Value=%s},{Key=%s,Value=%s}%s]' "$1" "$2" "$TAG_KEY" "$CLUSTER_NAME" "${3:+,$3}"
}

json_list() {
	local out="" item
	for item in "$@"; do
		out+="${out:+,}\"$item\""
	done
	printf '%s' "$out"
}

# retry N DELAY CMD... runs CMD until it succeeds, N times at most.
retry() {
	local n=$1 delay=$2 i
	shift 2
	for ((i = 1; i <= n; i++)); do
		if "$@"; then
			return 0
		fi
		((i < n)) && info "Retrying in ${delay}s ($i/$n)..." && sleep "$delay"
	done
	return 1
}

# wait_until SECONDS DESCRIPTION CMD... polls CMD every 10 seconds.
wait_until() {
	local timeout=$1 what=$2 deadline
	shift 2
	deadline=$((SECONDS + timeout))
	until "$@"; do
		((SECONDS < deadline)) || return 1
		info "Waiting for $what..."
		sleep 10
	done
}

image_ref() { printf '%s/%s%s' "$REGISTRY" "${ECR_PREFIX:+$ECR_PREFIX/}" "$1"; }

# ---- Preflight and questions ------------------------------------------------------------------------------------

preflight_aws() {
	need_cmd aws kubectl helm curl tar
	aws --version 2>&1 | grep -q '^aws-cli/2' || die "AWS CLI v2 is required ($(aws --version 2>&1))."
	export AWS_PAGER=""
	local arn
	arn=$(awsr sts get-caller-identity --query Arn) || die "AWS credentials don't work (aws sts get-caller-identity)."
	ACCOUNT_ID=$(awsr sts get-caller-identity --query Account)
	PARTITION=$(cut -d: -f2 <<<"$arn")
	[[ $PARTITION == aws || $PARTITION == aws-us-gov ]] || die "Partition $PARTITION isn't supported."
	REGISTRY="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
	info "AWS identity: $arn"
}

preflight_docker() {
	need_cmd docker
	docker info >/dev/null 2>&1 || die "Docker isn't running, or this user can't use it."
	docker buildx version >/dev/null 2>&1 || die "docker buildx is required."
}

check_helm() {
	local v
	v=$(helm version --template '{{.Version}}' 2>/dev/null) || die "helm doesn't run."
	[[ $v =~ ^v([0-9]+)\.([0-9]+) ]] || die "Unrecognized helm version $v."
	if ((BASH_REMATCH[1] == 3 && BASH_REMATCH[2] < 8)); then
		die "helm 3.8 or newer is required (found $v)."
	fi
}

# ask_artifact_questions asks what goes into the images (online installs and bundles).
ask_artifact_questions() {
	section "Images"
	ask ARCH "Node CPU architecture (amd64 or arm64)" amd64 '^(amd64|arm64)$'
	ask INSTALL_METHOD "Deploy Coder with Argo CD (the way this fork ships) or plain Helm (argocd/helm)" argocd '^(argocd|helm)$'
	ask TF_PROVIDERS "Terraform providers to build into Coder (source[@version], space-separated)" \
		"coder/coder hashicorp/kubernetes" '^[A-Za-z0-9._/@ -]+$'
	ask WORKSPACE_IMAGE "Workspace base image (code-server is added to it)" "codercom/example-base:ubuntu" '^[^ ]+:[^ ]+$'
	ask CODE_SERVER_VERSION "code-server version for the workspace image" latest '^(latest|[0-9]+\.[0-9]+\.[0-9]+)$'
	ask EXTRA_IMAGES "Extra images to copy for your own templates (space-separated, optional)" "" '^[^,]*$'
	ask ARGOCD_CHART_VERSION "Argo CD Helm chart version" 10.9.6 '^[0-9]+\.[0-9]+\.[0-9]+$'
}

configure_install() {
	section "AWS"
	local default_region=${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}
	ask AWS_REGION "AWS region" "${default_region:-us-east-1}" '^[a-z]{2}(-gov)?-[a-z]+-[0-9]$'
	preflight_aws

	section "Cluster"
	local default_version
	default_version=$(awsr eks describe-cluster-versions --default-only --query 'clusterVersions[0].clusterVersion' 2>/dev/null || true)
	[[ $default_version =~ ^1\.[0-9]+$ ]] || default_version=""
	ask K8S_VERSION "Kubernetes version" "$default_version" '^1\.[0-9]+$'

	if [[ -n $BUNDLE_FILE ]]; then
		extract_bundle
		ARCH=$BUNDLE_ARCH
		CONFIG_KEYS+=(ARCH)
		info "Node architecture from the bundle: $ARCH"
	else
		ask ARCH "Node CPU architecture (amd64 or arm64)" amd64 '^(amd64|arm64)$'
	fi
	local default_type=t3.large
	[[ $ARCH == arm64 ]] && default_type=t4g.large
	ask INSTANCE_TYPE "Node instance type" "$default_type" '^[a-z0-9-]+\.[a-z0-9]+$'
	ask NODE_COUNT "Number of nodes" 2 '^[1-9][0-9]?$'
	ask NODE_DISK_GB "Node root volume size in GiB" 50 '^[0-9]{2,4}$'

	section "Network"
	ask VPC_MODE "Create a new VPC, or use an existing one (new/existing)" new '^(new|existing)$'
	if [[ $VPC_MODE == new ]]; then
		ask VPC_CIDR "VPC CIDR (a /16; private subnets get /19s)" 10.42.0.0/16 '^([0-9]{1,3}\.){3}[0-9]{1,3}/16$'
		ask AZ_COUNT "Number of availability zones (2 or 3)" 2 '^[23]$'
		VPC_CIDR_ACTUAL=$VPC_CIDR
	else
		ask VPC_ID "Existing VPC ID" "" '^vpc-[0-9a-f]+$'
		ask SUBNET_IDS "Private subnet IDs in at least two zones (space-separated)" "" '^subnet-[0-9a-f]+( subnet-[0-9a-f]+)+$'
		VPC_CIDR_ACTUAL=$(awsr ec2 describe-vpcs --vpc-ids "$VPC_ID" --query 'Vpcs[0].CidrBlock') || die "VPC $VPC_ID not found."
	fi
	info "Ways to reach the Kubernetes API:"
	info "  public-then-private  public for your address during the install, private only afterwards (recommended)"
	info "  public-restricted    public for your address, and private, from now on"
	info "  private              private only: run this script from inside the VPC (existing VPC only)"
	ask ENDPOINT_ACCESS "Kubernetes API access" public-then-private '^(public-then-private|public-restricted|private)$'
	if [[ $ENDPOINT_ACCESS == private && $VPC_MODE == new ]]; then
		die "A private-only API needs this script to run inside the VPC, so it needs VPC_MODE=existing. Use public-then-private instead."
	fi
	if [[ $ENDPOINT_ACCESS != private ]]; then
		local my_ip
		my_ip=$(curl -fsS --max-time 10 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)
		ask ADMIN_CIDR "CIDR allowed to reach the public API endpoint" "${my_ip:+$my_ip/32}" '^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$'
	fi
	ask API_PRIVATE_CIDRS "CIDRs allowed to reach the private API endpoint (bastions, VPN; space-separated)" \
		"$VPC_CIDR_ACTUAL" '^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}( ([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2})*$'
	ask EXTRA_ADMIN_ARNS "Other IAM roles or users to make cluster admins (ARNs, space-separated, optional)" "" '^(arn:[^ ]+( arn:[^ ]+)*)?$'

	if [[ -z $BUNDLE_FILE ]]; then
		ask_artifact_questions
	else
		section "Images"
		ask INSTALL_METHOD "Deploy Coder with Argo CD (the way this fork ships) or plain Helm (argocd/helm)" \
			"$([[ -n $IMG_ARGOCD ]] && echo argocd || echo helm)" '^(argocd|helm)$'
		[[ $INSTALL_METHOD == helm || -n $IMG_ARGOCD ]] || die "The bundle has no Argo CD images; build it with INSTALL_METHOD=argocd or install with helm."
	fi
	ask ECR_PREFIX "ECR repository prefix" "$CLUSTER_NAME" '^[a-z0-9]+([._/-][a-z0-9]+)*$'

	section "Coder"
	info "How people reach Coder:"
	info "  internal-lb   an internal load balancer in the VPC (reach it over VPN, Direct Connect or a bastion)"
	info "  port-forward  only through kubectl port-forward"
	ask EXPOSE "Expose Coder with" internal-lb '^(internal-lb|port-forward)$'
	if [[ $EXPOSE == internal-lb ]]; then
		ask ACCESS_URL "Access URL, if you'll point your own DNS name at the load balancer (empty = its address)" "" '^(https?://[^/ ]+)?$'
	else
		ask ACCESS_URL "Access URL (empty = Coder's in-cluster address)" "" '^(https?://[^/ ]+)?$'
	fi
	ask WILDCARD_ACCESS_URL "Wildcard host for workspace apps, e.g. *.coder.example.com (optional)" "" '^(\*\.[^/ ]+)?$'
	ask ADMIN_USERNAME "First admin's username" admin '^[a-zA-Z0-9][a-zA-Z0-9-]{0,31}$'
	ask ADMIN_EMAIL "First admin's e-mail" admin@example.com '^[^@ ]+@[^@ ]+$'
	ask OIDC_ENABLED "Sign in with Keycloak or another OpenID Connect provider (yes/no)" no '^(yes|no)$'
	if [[ $OIDC_ENABLED == yes ]]; then
		[[ $EXPOSE == internal-lb || -n $ACCESS_URL ]] || die "OpenID Connect needs an access URL, which port-forward doesn't have."
		ask OIDC_ISSUER_URL "Issuer URL, e.g. https://keycloak.example.com/realms/master" "" '^https?://[^ ]+$'
		ask OIDC_CLIENT_ID "Client ID" coder '^[^ ]+$'
		ask OIDC_SIGN_IN_TEXT "Sign-in button text" "Sign in with Keycloak" '.+'
		info "Give the client this redirect URI: <access URL>/api/v2/users/oidc/callback"
	fi
	ask CA_PEM_FILE "PEM file of a private CA to trust (Keycloak's or the access URL's issuer; optional)" "" '^[^ ]*$'
	if [[ -n $CA_PEM_FILE ]]; then
		if [[ ! -f $CA_PEM_FILE ]] || ! grep -q 'BEGIN CERTIFICATE' "$CA_PEM_FILE"; then
			die "$CA_PEM_FILE isn't a PEM certificate file."
		fi
	fi
	ask CREATE_TEMPLATE "Create the air-gapped Kubernetes workspace template (yes/no)" yes '^(yes|no)$'
}

confirm_plan() {
	log "Plan"
	info "Account $ACCOUNT_ID, region $AWS_REGION, cluster $CLUSTER_NAME (Kubernetes $K8S_VERSION)"
	if [[ $VPC_MODE == new ]]; then
		info "New VPC $VPC_CIDR across $AZ_COUNT zones: private subnets only, no internet or NAT gateway"
	else
		info "Existing VPC $VPC_ID, subnets $SUBNET_IDS (missing VPC endpoints are created)"
	fi
	info "VPC endpoints: ${INTERFACE_ENDPOINTS// /, }, s3 (gateway)"
	info "$NODE_COUNT x $INSTANCE_TYPE nodes ($ARCH, ${NODE_DISK_GB} GiB), EBS CSI driver, default gp3 StorageClass"
	info "API endpoint: $ENDPOINT_ACCESS${ADMIN_CIDR:+ (public: $ADMIN_CIDR)}"
	info "Images in ECR under $REGISTRY/${ECR_PREFIX}"
	info "Coder via $INSTALL_METHOD, exposed by $EXPOSE${ACCESS_URL:+ at $ACCESS_URL}"
	info "Billable: the EKS control plane, the nodes and their volumes, $(wc -w <<<"$INTERFACE_ENDPOINTS" | tr -d ' ') interface"
	info "          endpoints per zone, ECR storage$([[ $EXPOSE == internal-lb ]] && echo ', and the internal load balancer')"
	if interactive; then
		local go
		read -r -p "Create these resources? (yes/no) [no]: " go || go=no
		[[ $go == yes || $go == y ]] || die "Stopped; nothing was created. Your answers are in $WORK_DIR/config.env."
	fi
}

# ---- Artifacts: images, charts, providers -----------------------------------------------------------------------

# mirror_path REF is where REF goes in ECR, relative to the prefix: the registry host is dropped.
mirror_path() {
	local ref=$1 first=${1%%/*}
	[[ $ref != *@* ]] || die "Image $ref: use a tag, not a digest."
	if [[ $ref == */* && ($first == *.* || $first == *:* || $first == localhost) ]]; then
		ref=${ref#*/}
	fi
	[[ $ref == */* ]] || ref=library/$ref
	[[ ${ref##*/} == *:* ]] || ref=$ref:latest
	printf '%s' "$ref"
}

# mirror_image SRC PATH copies SRC for the nodes' architecture to the local image airgap.local/PATH.
mirror_image() {
	info "Image $1"
	printf 'FROM %s\n' "$1" | docker buildx build --quiet --platform "linux/$ARCH" --provenance=false \
		--load -t "airgap.local/$2" - >/dev/null || die "Copying $1 failed."
}

locate_chart() {
	if [[ -z ${CHART_REF:-} && -f $SCRIPT_DIR/../helm/coder-platform/Chart.yaml ]]; then
		printf '%s' "$SCRIPT_DIR/../helm/coder-platform"
		return
	fi
	need_cmd git
	git clone --quiet --depth 1 --branch "${CHART_REF:-main}" "$CODER_REPO_URL" "$TMP_DIR/coder" ||
		die "Cloning $CODER_REPO_URL at ${CHART_REF:-main} failed."
	printf '%s' "$TMP_DIR/coder/helm/coder-platform"
}

# chart_value TGZ BLOCK KEY prints a two-level value from the chart's values.yaml, e.g. postgres image.
chart_value() {
	helm show values "$1" | awk -v blk="$2" -v key="$3" '
		$0 ~ "^" blk ":" { inb = 1; next }
		inb && /^[^ #]/ { inb = 0 }
		inb && $0 ~ "^  " key ":" { sub("^  " key ":[ ]*", ""); sub(/[ ]+#.*/, ""); gsub(/"/, ""); if (!done) { print; done = 1 } }'
}

# rendered_images prints the images a rendered chart uses.
rendered_images() { awk '/^[ -]*image: /{ gsub(/"/, "", $NF); print $NF }' | sort -u; }

# build_artifacts OUT downloads and builds everything into OUT and the local Docker image store.
build_artifacts() {
	local out=$1 chart_src src tag cs_version role path img
	rm -rf "$out"
	mkdir -p "$out/charts" "$out/build"
	TMP_DIR=${TMP_DIR:-$(mktemp -d)}

	log "Packaging the coder-platform chart"
	chart_src=$(locate_chart)
	helm package "$chart_src" -d "$out/charts" >/dev/null
	CHART_FILE=$(cd "$out/charts" && ls coder-platform-*.tgz)
	CHART_VERSION=$(helm show chart "$out/charts/$CHART_FILE" | awk '/^version:/{ print $2 }')
	APP_VERSION=$(helm show chart "$out/charts/$CHART_FILE" | awk '/^appVersion:/{ gsub(/"/, "", $2); print $2 }')
	info "Chart $CHART_VERSION, Coder $APP_VERSION"

	log "Building the Coder image with the Terraform provider mirror"
	src="$(chart_value "$out/charts/$CHART_FILE" image repository):$APP_VERSION"
	write_coder_image_context "$out/build/coder" "$src"
	IMG_CODER="coder-platform-airgap:$APP_VERSION"
	docker buildx build --platform "linux/$ARCH" --provenance=false --load \
		-t "airgap.local/$IMG_CODER" "$out/build/coder" || die "Building the Coder image failed."

	log "Building the workspace image with code-server"
	cs_version=$CODE_SERVER_VERSION
	if [[ $cs_version == latest ]]; then
		cs_version=$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/coder/code-server/releases/latest)
		cs_version=${cs_version##*/v}
		[[ $cs_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Couldn't find the latest code-server version."
	fi
	CODE_SERVER_RESOLVED=$cs_version
	mkdir -p "$out/build/workspace/code-server"
	curl -fsSL "https://github.com/coder/code-server/releases/download/v$cs_version/code-server-$cs_version-linux-$ARCH.tar.gz" |
		tar -xz --strip-components=1 -C "$out/build/workspace/code-server" || die "Downloading code-server $cs_version failed."
	printf 'FROM %s\nCOPY code-server /opt/code-server\n' "$WORKSPACE_IMAGE" >"$out/build/workspace/Dockerfile"
	tag=${WORKSPACE_IMAGE##*:}
	IMG_WORKSPACE="coder-workspace:${tag//[^A-Za-z0-9_.-]/-}-code-server-$cs_version"
	docker buildx build --quiet --platform "linux/$ARCH" --provenance=false --load \
		-t "airgap.local/$IMG_WORKSPACE" "$out/build/workspace" >/dev/null || die "Building the workspace image failed."
	rm -rf "$out/build"

	log "Copying the chart's other images for linux/$ARCH"
	local copied=" "
	for role in postgres platform banner setup; do
		src=$(chart_value "$out/charts/$CHART_FILE" "$role" image)
		[[ -n $src ]] || die "The chart has no $role.image value; this script needs updating."
		path=$(mirror_path "$src")
		printf -v "IMG_${role^^}" '%s' "$path"
		if [[ $copied != *" $path "* ]]; then
			mirror_image "$src" "$path"
			copied+="$path "
		fi
	done

	IMG_ARGOCD="" IMG_REDIS="" ARGOCD_CHART_FILE=""
	if [[ $INSTALL_METHOD == argocd ]]; then
		log "Downloading Argo CD $ARGOCD_CHART_VERSION and its images"
		helm pull argo-cd --repo "$ARGOCD_HELM_REPO" --version "$ARGOCD_CHART_VERSION" -d "$out/charts" ||
			die "Downloading the Argo CD chart failed."
		ARGOCD_CHART_FILE="argo-cd-$ARGOCD_CHART_VERSION.tgz"
		for img in $(helm template argocd "$out/charts/$ARGOCD_CHART_FILE" -n argocd --set dex.enabled=false | rendered_images); do
			case "$img" in
			*/argoproj/argocd:*) IMG_ARGOCD=$(mirror_path "$img") ;;
			*redis*) IMG_REDIS=$(mirror_path "$img") ;;
			*) die "Argo CD chart $ARGOCD_CHART_VERSION uses $img, which this script doesn't know how to relocate." ;;
			esac
			mirror_image "$img" "$(mirror_path "$img")"
		done
		[[ -n $IMG_ARGOCD && -n $IMG_REDIS ]] || die "Couldn't find Argo CD's images in chart $ARGOCD_CHART_VERSION."
	fi

	IMG_EXTRA=""
	for img in $EXTRA_IMAGES; do
		path=$(mirror_path "$img")
		mirror_image "$img" "$path"
		IMG_EXTRA+="${IMG_EXTRA:+ }$path"
	done

	write_manifest "$out/manifest.env"
}

write_coder_image_context() {
	local dir=$1 src=$2 p
	mkdir -p "$dir"
	{
		echo 'terraform {'
		echo '  required_providers {'
		for p in $TF_PROVIDERS; do
			printf '    %s = {\n      source = "%s"\n' "$(tr -c 'a-zA-Z0-9\n' - <<<"${p%@*}")" "${p%@*}"
			[[ $p == *@* ]] && printf '      version = "%s"\n' "${p#*@}"
			echo '    }'
		done
		echo '  }'
		echo '}'
	} >"$dir/versions.tf"
	cat >"$dir/terraformrc" <<'EOF'
# Workspace builds install providers only from the mirror built into this image.
provider_installation {
  filesystem_mirror {
    path = "/home/coder/.terraform.d/plugins"
  }
}
EOF
	cat >"$dir/Dockerfile" <<EOF
# The mirror is downloaded on the build machine's platform for the nodes' platform, so cross-architecture builds
# need no emulation.
FROM --platform=\$BUILDPLATFORM $src AS providers
ARG TARGETOS
ARG TARGETARCH
USER root
COPY versions.tf /mirror-src/versions.tf
RUN cd /mirror-src && terraform providers mirror -platform=\${TARGETOS}_\${TARGETARCH} /mirror

FROM $src
COPY --from=providers --chown=1000:1000 /mirror /home/coder/.terraform.d/plugins
COPY --chown=1000:1000 terraformrc /home/coder/.terraformrc
ENV TF_CLI_CONFIG_FILE=/home/coder/.terraformrc
EOF
}

write_manifest() {
	{
		printf 'BUNDLE_ARCH=%q\n' "$ARCH"
		local k
		for k in CHART_FILE CHART_VERSION APP_VERSION ARGOCD_CHART_FILE CODE_SERVER_RESOLVED IMG_CODER IMG_POSTGRES \
			IMG_PLATFORM IMG_BANNER IMG_SETUP IMG_WORKSPACE IMG_ARGOCD IMG_REDIS IMG_EXTRA; do
			printf '%s=%q\n' "$k" "${!k}"
		done
	} >"$1"
}

all_images() {
	local extra
	read -r -a extra <<<"$IMG_EXTRA"
	printf '%s\n' "$IMG_CODER" "$IMG_POSTGRES" "$IMG_PLATFORM" "$IMG_BANNER" "$IMG_SETUP" "$IMG_WORKSPACE" \
		"$IMG_ARGOCD" "$IMG_REDIS" "${extra[@]}" | awk 'NF && !seen[$0]++'
}

load_manifest() {
	[[ -f $1 ]] || die "$1 is missing: run the images phase (or pass --bundle) first."
	# shellcheck disable=SC1090
	source "$1"
}

extract_bundle() {
	[[ -f $BUNDLE_FILE ]] || die "Bundle $BUNDLE_FILE not found."
	local dir=$WORK_DIR/artifacts
	local stamp
	stamp="$(wc -c <"$BUNDLE_FILE" | tr -d ' ')-$(date -r "$BUNDLE_FILE" +%s)"
	if [[ ! -f $dir/.extracted || $(cat "$dir/.extracted") != "$stamp" ]]; then
		log "Unpacking $BUNDLE_FILE"
		rm -rf "$dir"
		mkdir -p "$dir"
		tar -xf "$BUNDLE_FILE" -C "$dir"
		(cd "$dir" && sha256 -c SHA256SUMS >/dev/null) || die "The bundle is damaged (checksums don't match)."
		echo "$stamp" >"$dir/.extracted"
	fi
	load_manifest "$dir/manifest.env"
}

# ---- Commands ---------------------------------------------------------------------------------------------------

cmd_bundle() {
	preflight_docker
	need_cmd helm curl tar
	check_helm
	[[ -n $CONFIG_FILE ]] && load_kv "$CONFIG_FILE"
	ask_artifact_questions
	# Next to the output rather than in /tmp: the images take several GB.
	TMP_DIR=$(mktemp -d "$PWD/.coder-eks-airgap.XXXXXX")
	local out=$TMP_DIR/bundle
	build_artifacts "$out"

	log "Saving the images"
	local refs=() path
	while read -r path; do
		refs+=("airgap.local/$path")
	done < <(all_images)
	docker save -o "$out/images.tar" "${refs[@]}"
	(
		cd "$out"
		find . -type f | sed 's|^\./||' | sort >"$TMP_DIR/files"
		while read -r file; do sha256 "$file"; done <"$TMP_DIR/files" >"$TMP_DIR/SHA256SUMS"
		mv "$TMP_DIR/SHA256SUMS" SHA256SUMS
	)

	OUTPUT_FILE=${OUTPUT_FILE:-$PWD/coder-eks-airgap-$APP_VERSION-$ARCH.tar}
	tar -cf "$OUTPUT_FILE" -C "$out" .
	log "Bundle ready: $OUTPUT_FILE ($(du -h "$OUTPUT_FILE" | cut -f1))"
	info "sha256 $(sha256 "$OUTPUT_FILE" | cut -d' ' -f1)"
	info "Copy it to the machine that runs the install, then:"
	info "  eks_airgap_install.sh install --bundle $(basename "$OUTPUT_FILE")"
}

cmd_install() {
	check_helm
	[[ -n $CONFIG_FILE ]] && load_kv "$CONFIG_FILE"
	section "Name"
	ask CLUSTER_NAME "Cluster name" coder '^[a-z][a-z0-9-]{0,30}$'
	WORK_DIR=${WORK_DIR:-$PWD/coder-eks-$CLUSTER_NAME}
	mkdir -p "$WORK_DIR"
	if [[ -f $WORK_DIR/config.env ]]; then
		info "Reusing the answers in $WORK_DIR/config.env."
		load_kv "$WORK_DIR/config.env"
	fi
	export KUBECONFIG=$WORK_DIR/kubeconfig
	state_load
	configure_install
	preflight_docker
	save_config
	confirm_plan
	exec > >(tee -a "$WORK_DIR/install.log") 2>&1

	local phase skipping=0
	if [[ -n $FROM_PHASE ]]; then
		[[ " $PHASES " == *" $FROM_PHASE "* ]] || die "Unknown phase $FROM_PHASE (phases: $PHASES)."
		skipping=1
	fi
	for phase in $PHASES; do
		[[ $phase == "$FROM_PHASE" ]] && skipping=0
		if ((skipping)); then
			info "Skipping phase $phase."
			continue
		fi
		"phase_$phase"
	done
	summary
}

# ---- Phase: images ----------------------------------------------------------------------------------------------

phase_images() {
	local dir=$WORK_DIR/artifacts path ecr_repo
	if [[ -n $BUNDLE_FILE ]]; then
		log "Loading the bundle's images into Docker"
		docker load -q -i "$dir/images.tar" >/dev/null
	else
		TMP_DIR=$(mktemp -d)
		build_artifacts "$dir"
	fi
	load_manifest "$dir/manifest.env"

	log "Pushing images to ECR ($REGISTRY)"
	awsr ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
	while read -r path; do
		ecr_repo="${ECR_PREFIX:+$ECR_PREFIX/}${path%:*}"
		if ! awsr ecr describe-repositories --repository-names "$ecr_repo" >/dev/null 2>&1; then
			awsr ecr create-repository --repository-name "$ecr_repo" --image-scanning-configuration scanOnPush=true \
				--tags "Key=$TAG_KEY,Value=$CLUSTER_NAME" >/dev/null
		fi
		docker tag "airgap.local/$path" "$(image_ref "$path")"
		info "Pushing $(image_ref "$path")"
		docker push -q "$(image_ref "$path")" >/dev/null || die "Pushing $path failed."
	done < <(all_images)
}

# ---- Phase: network ---------------------------------------------------------------------------------------------

phase_network() {
	if [[ $VPC_MODE == new ]]; then
		network_new
	else
		network_existing
	fi
	ensure_endpoints
}

network_new() {
	log "Creating the VPC (private subnets only)"
	if [[ -z ${VPC_ID:-} ]]; then
		local vpc
		vpc=$(awsr ec2 create-vpc --cidr-block "$VPC_CIDR" --tag-specifications "$(tagspec vpc "$CLUSTER_NAME")" --query Vpc.VpcId)
		state_set VPC_ID "$vpc"
		state_set VPC_CREATED yes
		awsr ec2 wait vpc-available --vpc-ids "$VPC_ID"
	fi
	# Interface endpoints' private DNS names need both.
	awsr ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-support '{"Value":true}'
	awsr ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames '{"Value":true}'
	info "VPC $VPC_ID"

	if [[ -z ${SUBNET_IDS:-} ]]; then
		local zones=() name id octets subnets=() subnet i=0
		while read -r name id; do
			[[ $EKS_UNSUPPORTED_ZONE_IDS == *" $id "* ]] && continue
			zones+=("$name")
		done < <(awsr ec2 describe-availability-zones --filters Name=zone-type,Values=availability-zone \
			Name=state,Values=available --query 'AvailabilityZones[].[ZoneName,ZoneId]')
		((${#zones[@]} >= AZ_COUNT)) || die "$AWS_REGION has only ${#zones[@]} zones EKS supports."
		IFS=. read -r -a octets <<<"${VPC_CIDR%/*}"
		for ((i = 0; i < AZ_COUNT; i++)); do
			subnet=$(awsr ec2 create-subnet --vpc-id "$VPC_ID" --availability-zone "${zones[i]}" \
				--cidr-block "${octets[0]}.${octets[1]}.$((i * 32)).0/19" \
				--tag-specifications "$(tagspec subnet "$CLUSTER_NAME-private-${zones[i]}" \
					"{Key=kubernetes.io/role/internal-elb,Value=1},{Key=kubernetes.io/cluster/$CLUSTER_NAME,Value=shared}")" \
				--query Subnet.SubnetId)
			subnets+=("$subnet")
			info "Subnet $subnet in ${zones[i]}"
		done
		state_set SUBNET_IDS "${subnets[*]}"
	fi

	if [[ -z ${ROUTE_TABLE_IDS:-} ]]; then
		local rt subnet
		rt=$(awsr ec2 create-route-table --vpc-id "$VPC_ID" --tag-specifications "$(tagspec route-table "$CLUSTER_NAME-private")" \
			--query RouteTable.RouteTableId)
		for subnet in $SUBNET_IDS; do
			awsr ec2 associate-route-table --route-table-id "$rt" --subnet-id "$subnet" >/dev/null
		done
		state_set ROUTE_TABLE_IDS "$rt"
		info "Route table $rt: local routes only"
	fi
}

network_existing() {
	log "Checking VPC $VPC_ID"
	local subnet_vpcs zones dns subnets
	read -r -a subnets <<<"$SUBNET_IDS"
	subnet_vpcs=$(awsr ec2 describe-subnets --subnet-ids "${subnets[@]}" --query 'Subnets[].VpcId' | tr '\t' '\n' | sort -u)
	[[ $subnet_vpcs == "$VPC_ID" ]] || die "The subnets aren't all in $VPC_ID."
	zones=$(awsr ec2 describe-subnets --subnet-ids "${subnets[@]}" --query 'Subnets[].AvailabilityZone' | tr '\t' '\n' | sort -u | wc -l)
	((zones >= 2)) || die "EKS needs subnets in at least two availability zones."
	dns=$(awsr ec2 describe-vpc-attribute --vpc-id "$VPC_ID" --attribute enableDnsHostnames --query EnableDnsHostnames.Value)
	if [[ $dns != True ]]; then
		warn "Turning on DNS hostnames in $VPC_ID (VPC endpoints' private DNS names need it)."
		awsr ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames '{"Value":true}'
	fi
	info "Tagging the subnets so Kubernetes can place internal load balancers in them."
	awsr ec2 create-tags --resources "${subnets[@]}" --tags Key=kubernetes.io/role/internal-elb,Value=1 \
		"Key=kubernetes.io/cluster/$CLUSTER_NAME,Value=shared"
	if [[ -z ${ROUTE_TABLE_IDS:-} ]]; then
		local rts
		rts=$(awsr ec2 describe-route-tables --filters "Name=association.subnet-id,Values=${SUBNET_IDS// /,}" \
			--query 'RouteTables[].RouteTableId')
		rts+=" $(awsr ec2 describe-route-tables --filters "Name=vpc-id,Values=$VPC_ID" Name=association.main,Values=true \
			--query 'RouteTables[].RouteTableId')"
		state_set ROUTE_TABLE_IDS "$(tr -s '\t ' '\n' <<<"$rts" | awk 'NF && !seen[$0]++' | xargs)"
	fi
}

ensure_vpce_sg() {
	[[ -z ${VPCE_SG_ID:-} ]] || return 0
	local sg
	sg=$(awsr ec2 create-security-group --group-name "$CLUSTER_NAME-vpc-endpoints" \
		--description "HTTPS from the VPC to the VPC endpoints of $CLUSTER_NAME" --vpc-id "$VPC_ID" \
		--tag-specifications "$(tagspec security-group "$CLUSTER_NAME-vpc-endpoints")" --query GroupId)
	state_set VPCE_SG_ID "$sg"
	awsr ec2 authorize-security-group-ingress --group-id "$VPCE_SG_ID" --ip-permissions \
		"[{\"IpProtocol\":\"tcp\",\"FromPort\":443,\"ToPort\":443,\"IpRanges\":[{\"CidrIp\":\"$VPC_CIDR_ACTUAL\"}]}]" >/dev/null
}

ensure_endpoints() {
	log "VPC endpoints"
	# Interface endpoints take one subnet per zone.
	local subnet zone subnets endpoint_subnets=() route_tables seen=" " svc existing id created=${VPCE_IDS:-}
	read -r -a subnets <<<"$SUBNET_IDS"
	read -r -a route_tables <<<"$ROUTE_TABLE_IDS"
	while read -r subnet zone; do
		[[ $seen == *" $zone "* ]] && continue
		seen+="$zone "
		endpoint_subnets+=("$subnet")
	done < <(awsr ec2 describe-subnets --subnet-ids "${subnets[@]}" --query 'Subnets[].[SubnetId,AvailabilityZone]')

	for svc in $INTERFACE_ENDPOINTS s3; do
		existing=$(awsr ec2 describe-vpc-endpoints --filters "Name=vpc-id,Values=$VPC_ID" \
			"Name=service-name,Values=com.amazonaws.$AWS_REGION.$svc" Name=vpc-endpoint-state,Values=available,pending \
			--query 'VpcEndpoints[0].VpcEndpointId')
		if [[ $existing != None && -n $existing ]]; then
			info "$svc: $existing"
			continue
		fi
		if [[ $svc == s3 ]]; then
			id=$(awsr ec2 create-vpc-endpoint --vpc-id "$VPC_ID" --vpc-endpoint-type Gateway \
				--service-name "com.amazonaws.$AWS_REGION.s3" --route-table-ids "${route_tables[@]}" \
				--tag-specifications "$(tagspec vpc-endpoint "$CLUSTER_NAME-s3")" --query VpcEndpoint.VpcEndpointId)
		else
			ensure_vpce_sg
			id=$(awsr ec2 create-vpc-endpoint --vpc-id "$VPC_ID" --vpc-endpoint-type Interface \
				--service-name "com.amazonaws.$AWS_REGION.$svc" --subnet-ids "${endpoint_subnets[@]}" \
				--security-group-ids "$VPCE_SG_ID" --private-dns-enabled \
				--tag-specifications "$(tagspec vpc-endpoint "$CLUSTER_NAME-$svc")" --query VpcEndpoint.VpcEndpointId)
		fi
		created+="${created:+ }$id"
		state_set VPCE_IDS "$created"
		info "$svc: $id (created)"
	done
	if [[ -n $created ]]; then
		wait_until 600 "the VPC endpoints" endpoints_available "$created" || die "The VPC endpoints didn't become available."
	fi
}

endpoints_available() {
	local states
	# shellcheck disable=SC2086
	states=$(awsr ec2 describe-vpc-endpoints --vpc-endpoint-ids $1 --query 'VpcEndpoints[].State' | tr '\t' '\n' | sort -u)
	[[ ${states,,} == available ]]
}

# ---- Phase: IAM -------------------------------------------------------------------------------------------------

ensure_role() {
	local name=$1 service=$2 policy
	shift 2
	if ! awsr iam get-role --role-name "$name" >/dev/null 2>&1; then
		awsr iam create-role --role-name "$name" --tags "Key=$TAG_KEY,Value=$CLUSTER_NAME" --assume-role-policy-document \
			"{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"$service\"},\"Action\":\"sts:AssumeRole\"}]}" >/dev/null
		info "Created role $name"
	fi
	for policy in "$@"; do
		awsr iam attach-role-policy --role-name "$name" --policy-arn "arn:$PARTITION:iam::aws:policy/$policy"
	done
}

phase_iam() {
	log "IAM roles"
	ensure_role "$CLUSTER_NAME-eks-cluster" eks.amazonaws.com AmazonEKSClusterPolicy
	# The EBS CSI driver uses the node role (with an instance metadata hop limit of 2), so it needs no OIDC
	# provider or Pod Identity endpoint.
	ensure_role "$CLUSTER_NAME-eks-node" ec2.amazonaws.com AmazonEKSWorkerNodePolicy AmazonEKS_CNI_Policy \
		AmazonEC2ContainerRegistryReadOnly service-role/AmazonEBSCSIDriverPolicy AmazonSSMManagedInstanceCore
	state_set IAM_CREATED yes
}

# ---- Phase: cluster ---------------------------------------------------------------------------------------------

phase_cluster() {
	log "EKS cluster $CLUSTER_NAME"
	local status vpc_config cluster_sg cidr arn
	status=$(awsr eks describe-cluster --name "$CLUSTER_NAME" --query cluster.status 2>/dev/null || echo NONE)
	if [[ $status == NONE ]]; then
		# shellcheck disable=SC2086
		vpc_config="{\"subnetIds\":[$(json_list $SUBNET_IDS)],\"endpointPrivateAccess\":true"
		if [[ $ENDPOINT_ACCESS == private ]]; then
			vpc_config+=',"endpointPublicAccess":false}'
		else
			vpc_config+=",\"endpointPublicAccess\":true,\"publicAccessCidrs\":[\"$ADMIN_CIDR\"]}"
		fi
		# A role created moments ago can take a while to become usable by EKS.
		retry 6 20 awsr eks create-cluster --name "$CLUSTER_NAME" --kubernetes-version "$K8S_VERSION" \
			--role-arn "arn:$PARTITION:iam::$ACCOUNT_ID:role/$CLUSTER_NAME-eks-cluster" \
			--resources-vpc-config "$vpc_config" \
			--access-config authenticationMode=API,bootstrapClusterCreatorAdminPermissions=true \
			--tags "$TAG_KEY=$CLUSTER_NAME" --query cluster.status >/dev/null || die "Creating the cluster failed."
		state_set CLUSTER_CREATED yes
		info "Creating the control plane (usually 10 to 15 minutes)."
	fi
	retry 3 1 awsr eks wait cluster-active --name "$CLUSTER_NAME" || die "The cluster didn't become active."
	awsr eks update-kubeconfig --name "$CLUSTER_NAME" --kubeconfig "$KUBECONFIG" --alias "$CLUSTER_NAME" >/dev/null
	info "kubeconfig: $KUBECONFIG"

	cluster_sg=$(awsr eks describe-cluster --name "$CLUSTER_NAME" --query cluster.resourcesVpcConfig.clusterSecurityGroupId)
	for cidr in $API_PRIVATE_CIDRS; do
		awsr ec2 authorize-security-group-ingress --group-id "$cluster_sg" --ip-permissions \
			"[{\"IpProtocol\":\"tcp\",\"FromPort\":443,\"ToPort\":443,\"IpRanges\":[{\"CidrIp\":\"$cidr\",\"Description\":\"Kubernetes API\"}]}]" \
			>/dev/null 2>&1 || true
	done
	for arn in $EXTRA_ADMIN_ARNS; do
		awsr eks create-access-entry --cluster-name "$CLUSTER_NAME" --principal-arn "$arn" >/dev/null 2>&1 || true
		awsr eks associate-access-policy --cluster-name "$CLUSTER_NAME" --principal-arn "$arn" --access-scope type=cluster \
			--policy-arn "arn:$PARTITION:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy" >/dev/null
		info "Cluster admin: $arn"
	done
}

# ---- Phase: nodes -----------------------------------------------------------------------------------------------

phase_nodes() {
	log "Node group ($NODE_COUNT x $INSTANCE_TYPE)"
	local lt_name="$CLUSTER_NAME-nodes" ami_type=AL2023_x86_64_STANDARD lt
	[[ $ARCH == arm64 ]] && ami_type=AL2023_ARM_64_STANDARD
	if [[ -z ${LAUNCH_TEMPLATE_ID:-} ]]; then
		# Hop limit 2 lets pods (the EBS CSI driver) use the node role; IMDSv2 only.
		lt=$(awsr ec2 create-launch-template --launch-template-name "$lt_name" \
			--tag-specifications "$(tagspec launch-template "$lt_name")" --query LaunchTemplate.LaunchTemplateId \
			--launch-template-data "{
				\"MetadataOptions\":{\"HttpTokens\":\"required\",\"HttpPutResponseHopLimit\":2,\"HttpEndpoint\":\"enabled\"},
				\"BlockDeviceMappings\":[{\"DeviceName\":\"/dev/xvda\",\"Ebs\":{\"VolumeSize\":$NODE_DISK_GB,\"VolumeType\":\"gp3\",\"Encrypted\":true,\"DeleteOnTermination\":true}}],
				\"TagSpecifications\":[{\"ResourceType\":\"instance\",\"Tags\":[{\"Key\":\"Name\",\"Value\":\"$CLUSTER_NAME-node\"},{\"Key\":\"$TAG_KEY\",\"Value\":\"$CLUSTER_NAME\"}]}]
			}")
		state_set LAUNCH_TEMPLATE_ID "$lt"
	fi
	if ! awsr eks describe-nodegroup --cluster-name "$CLUSTER_NAME" --nodegroup-name "$lt_name" >/dev/null 2>&1; then
		# shellcheck disable=SC2086
		awsr eks create-nodegroup --cluster-name "$CLUSTER_NAME" --nodegroup-name "$lt_name" --subnets $SUBNET_IDS \
			--node-role "arn:$PARTITION:iam::$ACCOUNT_ID:role/$CLUSTER_NAME-eks-node" --ami-type "$ami_type" \
			--instance-types "$INSTANCE_TYPE" --capacity-type ON_DEMAND \
			--scaling-config "minSize=$NODE_COUNT,maxSize=$NODE_COUNT,desiredSize=$NODE_COUNT" \
			--launch-template "id=$LAUNCH_TEMPLATE_ID,version=1" --tags "$TAG_KEY=$CLUSTER_NAME" >/dev/null
		info "Starting the nodes (usually 3 to 5 minutes)."
	fi
	retry 3 1 awsr eks wait nodegroup-active --cluster-name "$CLUSTER_NAME" --nodegroup-name "$lt_name" ||
		die "The node group didn't become active: $(awsr eks describe-nodegroup --cluster-name "$CLUSTER_NAME" \
			--nodegroup-name "$lt_name" --query 'nodegroup.health.issues[].message')"
	kubectl wait --for=condition=Ready node --all --timeout=10m >/dev/null
	kubectl get nodes -o wide
}

# ---- Phase: addons ----------------------------------------------------------------------------------------------

phase_addons() {
	log "EBS CSI driver and the default StorageClass"
	if ! awsr eks describe-addon --cluster-name "$CLUSTER_NAME" --addon-name aws-ebs-csi-driver >/dev/null 2>&1; then
		awsr eks create-addon --cluster-name "$CLUSTER_NAME" --addon-name aws-ebs-csi-driver \
			--resolve-conflicts OVERWRITE >/dev/null
	fi
	retry 2 1 awsr eks wait addon-active --cluster-name "$CLUSTER_NAME" --addon-name aws-ebs-csi-driver ||
		die "The EBS CSI driver didn't become active."
	kubectl apply -f - >/dev/null <<'EOF'
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
reclaimPolicy: Delete
parameters:
  type: gp3
  encrypted: "true"
EOF
	info "StorageClass gp3 (default)"
}

# ---- Phase: platform (Coder, and Argo CD when chosen) -----------------------------------------------------------

yaml_str() {
	local s=${1//\\/\\\\}
	s=${s//\"/\\\"}
	printf '"%s"' "$s"
}

# write_coder_values writes the chart values. OpenID Connect is left out until the access URL is known.
write_coder_values() {
	local f=$WORK_DIR/coder-values.yaml service_type=ClusterIP
	[[ $EXPOSE == internal-lb ]] && service_type=LoadBalancer
	{
		cat <<EOF
accessURL: $(yaml_str "$ACCESS_URL")
wildcardAccessURL: $(yaml_str "$WILDCARD_ACCESS_URL")
image:
  repository: $(yaml_str "$(image_ref "${IMG_CODER%:*}")")
  tag: $(yaml_str "${IMG_CODER##*:}")
setup:
  image: $(yaml_str "$(image_ref "$IMG_SETUP")")
postgres:
  enabled: true
  image: $(yaml_str "$(image_ref "$IMG_POSTGRES")")
  storage:
    storageClass: $(yaml_str "$STORAGE_CLASS")
platform:
  image: $(yaml_str "$(image_ref "$IMG_PLATFORM")")
  storage:
    storageClass: $(yaml_str "$STORAGE_CLASS")
banner:
  image: $(yaml_str "$(image_ref "$IMG_BANNER")")
firstUser:
  enabled: true
  username: $(yaml_str "$ADMIN_USERNAME")
  email: $(yaml_str "$ADMIN_EMAIL")
  name: Admin
coder:
  service:
    type: $service_type
EOF
		if [[ $EXPOSE == internal-lb ]]; then
			# A Classic Load Balancer from the cluster's built-in service controller: it proxies TCP, so workspaces
			# in the cluster can reach Coder through it (NLBs drop connections from their own targets). The long
			# idle timeout keeps idle WebSockets (terminals, agents) open.
			cat <<'EOF'
    annotations:
      service.beta.kubernetes.io/aws-load-balancer-internal: "true"
      service.beta.kubernetes.io/aws-load-balancer-connection-idle-timeout: "3600"
EOF
		fi
		cat <<'EOF'
  env:
    CODER_TELEMETRY_ENABLE: "false"
    CODER_UPDATE_CHECK: "false"
    CODER_DERP_SERVER_STUN_ADDRESSES: "disable"
    CODER_BLOCK_DIRECT: "true"
    CODER_DISABLE_TEMPLATE_BUILDER: "true"
EOF
		if [[ $OIDC_ENABLED == yes && -n $ACCESS_URL ]]; then
			cat <<EOF
oidc:
  enabled: true
  issuerURL: $(yaml_str "$OIDC_ISSUER_URL")
  clientID: $(yaml_str "$OIDC_CLIENT_ID")
  signInText: $(yaml_str "$OIDC_SIGN_IN_TEXT")
EOF
		fi
		if [[ -n $CA_PEM_FILE ]]; then
			echo "tls:"
			echo "  caPem: |"
			sed 's/^/    /' "$CA_PEM_FILE"
		fi
	} >"$f"
	printf '%s' "$f"
}

# assert_images_relocated CHART VALUES NAMESPACE fails when the rendered chart pulls from anywhere but ECR.
assert_images_relocated() {
	local bad
	bad=$(helm template check "$1" -n "$3" -f "$2" | rendered_images | grep -v "^$REGISTRY/" || true)
	[[ -z $bad ]] || die "These images would be pulled from outside ECR: $bad"
}

phase_platform() {
	load_manifest "$WORK_DIR/artifacts/manifest.env"
	ACCESS_URL=$(state_or_answer ACCESS_URL_RESOLVED "$ACCESS_URL")
	kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
	if [[ $OIDC_ENABLED == yes ]] && ! kubectl -n "$NAMESPACE" get secret keycloaking-coder-oidc >/dev/null 2>&1; then
		ask_secret OIDC_CLIENT_SECRET "OpenID Connect client secret"
		kubectl -n "$NAMESPACE" create secret generic keycloaking-coder-oidc \
			--from-literal=client-secret="$OIDC_CLIENT_SECRET" >/dev/null
	fi

	deploy_coder
	if [[ $EXPOSE == internal-lb && -z $ACCESS_URL ]]; then
		local host
		wait_until 600 "the load balancer's address" lb_hostname || die "The load balancer got no address."
		host=$(lb_hostname)
		state_set ACCESS_URL_RESOLVED "http://$host"
		ACCESS_URL=$ACCESS_URL_RESOLVED
		log "Setting Coder's access URL to $ACCESS_URL"
		deploy_coder
	fi
	if [[ $EXPOSE == internal-lb ]]; then
		# The load balancer takes a minute or two to register the nodes. Checked from inside the VPC (the Coder pod),
		# since the balancer is internal.
		wait_until 600 "Coder to answer at $ACCESS_URL" \
			kubectl -n "$NAMESPACE" exec deploy/coder -- curl -fsS -o /dev/null --max-time 5 "$ACCESS_URL/healthz" ||
			warn "Coder doesn't answer at $ACCESS_URL from inside the VPC yet; check the load balancer's health."
	fi
}

state_or_answer() {
	if [[ -n ${!1:-} ]]; then
		printf '%s' "${!1}"
	else
		printf '%s' "$2"
	fi
}

lb_hostname() {
	local h
	h=$(kubectl -n "$NAMESPACE" get svc coder -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null)
	[[ -n $h ]] && printf '%s' "$h"
}

deploy_coder() {
	local values chart=$WORK_DIR/artifacts/charts/$CHART_FILE
	values=$(write_coder_values)
	assert_images_relocated "$chart" "$values" "$NAMESPACE"
	if [[ $INSTALL_METHOD == helm ]]; then
		log "Installing Coder with Helm (first install: 5 to 10 minutes)"
		clear_undeployed_release
		helm upgrade --install "$RELEASE" "$chart" -n "$NAMESPACE" -f "$values" --wait --timeout 20m ||
			die "The Helm install failed: kubectl -n $NAMESPACE get pods; kubectl -n $NAMESPACE logs deploy/coder"
	else
		install_argocd
		serve_chart
		apply_application "$values"
	fi
	kubectl -n "$NAMESPACE" rollout status deploy/coder --timeout=10m >/dev/null
	if [[ -n $ACCESS_URL ]]; then
		wait_until 300 "Coder to use $ACCESS_URL" coder_config_is CODER_ACCESS_URL "$ACCESS_URL" ||
			die "Coder's configuration didn't pick up $ACCESS_URL."
		kubectl -n "$NAMESPACE" rollout status deploy/coder --timeout=10m >/dev/null
	fi
}

# clear_undeployed_release removes a release whose first install never finished (pending-install or failed), which
# would otherwise block every later install.
clear_undeployed_release() {
	local history
	history=$(helm history "$RELEASE" -n "$NAMESPACE" -o json 2>/dev/null) || return 0
	if [[ $history != *'"status":"deployed"'* && $history != *'"status":"superseded"'* ]]; then
		warn "Removing release $RELEASE, left over from an install that didn't finish."
		helm uninstall "$RELEASE" -n "$NAMESPACE" --wait >/dev/null
	fi
}

coder_config_is() {
	[[ $(kubectl -n "$NAMESPACE" get configmap coder-platform-config -o "jsonpath={.data.$1}" 2>/dev/null) == "$2" ]]
}

install_argocd() {
	local values=$WORK_DIR/argocd-values.yaml chart=$WORK_DIR/artifacts/charts/$ARGOCD_CHART_FILE
	[[ -n $IMG_ARGOCD ]] || die "The artifacts have no Argo CD images."
	cat >"$values" <<EOF
global:
  image:
    repository: $(yaml_str "$(image_ref "${IMG_ARGOCD%:*}")")
    tag: $(yaml_str "${IMG_ARGOCD##*:}")
redis:
  image:
    repository: $(yaml_str "$(image_ref "${IMG_REDIS%:*}")")
    tag: $(yaml_str "${IMG_REDIS##*:}")
# Dex (Argo CD's own SSO) needs an image of its own and isn't needed to deploy Coder.
dex:
  enabled: false
EOF
	assert_images_relocated "$chart" "$values" argocd
	if helm status argocd -n argocd >/dev/null 2>&1 && [[ $(helm get values argocd -n argocd -o yaml) == *"$(image_ref "${IMG_ARGOCD%:*}")"* ]]; then
		return
	fi
	log "Installing Argo CD"
	helm upgrade --install argocd "$chart" -n argocd --create-namespace -f "$values" --wait --timeout 10m >/dev/null ||
		die "Installing Argo CD failed: kubectl -n argocd get pods"
}

# serve_chart runs a tiny Helm repository in the argocd namespace (the chart from a ConfigMap, served by the
# platform's Python image), so Argo CD needs no Git server and no registry credentials that expire.
serve_chart() {
	log "Serving the coder-platform chart to Argo CD from inside the cluster"
	local dir sum
	TMP_DIR=${TMP_DIR:-$(mktemp -d)}
	dir=$TMP_DIR/chart-repo
	rm -rf "$dir"
	mkdir -p "$dir"
	cp "$WORK_DIR/artifacts/charts/$CHART_FILE" "$dir/"
	helm repo index "$dir" --url "$CHART_REPO_URL"
	# The chart's checksum (not the index's, which has a timestamp) restarts the server only when the chart changes.
	sum=$(sha256 <"$dir/$CHART_FILE" | cut -c1-16)
	kubectl -n argocd create configmap coder-platform-charts --from-file="$dir" --dry-run=client -o yaml |
		kubectl apply --server-side --force-conflicts -f - >/dev/null
	kubectl apply -f - >/dev/null <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: coder-charts
  namespace: argocd
  labels: {app.kubernetes.io/name: coder-charts}
spec:
  replicas: 1
  selector:
    matchLabels: {app.kubernetes.io/name: coder-charts}
  template:
    metadata:
      labels: {app.kubernetes.io/name: coder-charts}
      annotations: {checksum/charts: "$sum"}
    spec:
      automountServiceAccountToken: false
      securityContext: {runAsNonRoot: true, runAsUser: 65534, runAsGroup: 65534}
      containers:
        - name: http
          image: $(yaml_str "$(image_ref "$IMG_PLATFORM")")
          command: [python3, -m, http.server, "8080", --directory, /charts]
          ports: [{name: http, containerPort: 8080}]
          readinessProbe: {httpGet: {path: /index.yaml, port: http}}
          securityContext: {allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: {drop: [ALL]}}
          resources: {requests: {cpu: 5m, memory: 16Mi}, limits: {memory: 64Mi}}
          volumeMounts: [{name: charts, mountPath: /charts, readOnly: true}]
      volumes:
        - name: charts
          configMap: {name: coder-platform-charts}
---
apiVersion: v1
kind: Service
metadata:
  name: coder-charts
  namespace: argocd
spec:
  selector: {app.kubernetes.io/name: coder-charts}
  ports: [{name: http, port: 80, targetPort: http}]
EOF
	kubectl -n argocd rollout status deploy/coder-charts --timeout=5m >/dev/null
}

apply_application() {
	local values=$1 app=$WORK_DIR/argocd-application.yaml
	log "Applying the Argo CD Application (first sync: about 5 minutes)"
	{
		cat <<EOF
# Generated by eks_airgap_install.sh: helm/argocd-application.yaml, with the chart served from inside the cluster
# and every image from ECR.
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: coder-platform
  namespace: argocd
spec:
  description: Coder with the dashboard's platform services (air-gapped)
  sourceRepos:
    - $CHART_REPO_URL
  destinations:
    - server: https://kubernetes.default.svc
      namespace: $NAMESPACE
  clusterResourceWhitelist:
    - {group: "", kind: Namespace}
    - {group: rbac.authorization.k8s.io, kind: ClusterRole}
    - {group: rbac.authorization.k8s.io, kind: ClusterRoleBinding}
  namespaceResourceWhitelist:
    - {group: "*", kind: "*"}
---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: coder-platform
  namespace: argocd
  annotations:
    argocd.argoproj.io/compare-options: ServerSideDiff=true
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: coder-platform
  source:
    repoURL: $CHART_REPO_URL
    chart: coder-platform
    targetRevision: $(yaml_str "$CHART_VERSION")
    helm:
      releaseName: $RELEASE
      valuesObject:
EOF
		sed 's/^/        /' "$values"
		cat <<EOF
  destination:
    server: https://kubernetes.default.svc
    namespace: $NAMESPACE
  syncPolicy:
    automated: {prune: true, selfHeal: true}
    syncOptions: [CreateNamespace=true]
    retry:
      limit: 10
      backoff: {duration: 15s, factor: 2, maxDuration: 5m}
EOF
	} >"$app"
	kubectl apply -f "$app" >/dev/null
	kubectl -n argocd annotate application coder-platform argocd.argoproj.io/refresh=normal --overwrite >/dev/null
	wait_until 1800 "Argo CD to sync coder-platform" app_synced || {
		kubectl -n argocd get application coder-platform -o jsonpath='{.status.conditions}{"\n"}{.status.operationState.message}{"\n"}'
		die "Argo CD didn't finish syncing: kubectl -n argocd describe application coder-platform"
	}
	info "Synced and Healthy"
}

app_status() {
	kubectl -n argocd get application coder-platform \
		-o jsonpath='{.status.sync.status}/{.status.health.status}/{.status.operationState.phase}' 2>/dev/null || true
}

app_synced() { [[ $(app_status) == Synced/Healthy/Succeeded ]]; }

# ---- Phase: template --------------------------------------------------------------------------------------------

phase_template() {
	[[ $CREATE_TEMPLATE == yes ]] || return 0
	load_manifest "$WORK_DIR/artifacts/manifest.env"
	log "Creating the air-gapped Kubernetes template"
	local secret password ws
	secret=$(kubectl -n "$NAMESPACE" get secret coder-first-user -o jsonpath='{.data.password}') ||
		die "Secret coder-first-user is missing."
	password=$(base64 -d <<<"$secret")
	ws=$(image_ref "$IMG_WORKSPACE")
	# The script goes over stdin, so the password never appears in a command line.
	kubectl -n "$NAMESPACE" exec -i deploy/coder -- sh -s <<EOF || die "Creating the template failed (see above)."
set -eu
export HOME=/tmp CODER_URL=http://127.0.0.1:8080
body='{"email":"$ADMIN_EMAIL","password":"$password"}'
CODER_SESSION_TOKEN=\$(curl -fsS -H 'Content-Type: application/json' -d "\$body" \$CODER_URL/api/v2/users/login |
	sed -n 's/.*"session_token":"\([^"]*\)".*/\1/p')
export CODER_SESSION_TOKEN
dir=\$(mktemp -d)
trap 'rm -rf "\$dir"' EXIT
coder templates init --id kubernetes "\$dir" >/dev/null
cd "\$dir"
# code-server is in the workspace image, so the startup script doesn't download it.
sed -i \
	-e 's|^\( *image *= *\)"[^"]*"|\1"$ws"|' \
	-e 's|^\( *arch *= *\)"amd64"|\1"$ARCH"|' \
	-e 's|^\( *image_pull_policy *= *\)"[^"]*"|\1"$WORKSPACE_PULL_POLICY"|' \
	-e '/# Install the latest code-server/d' \
	-e '/# Append "--version x.x.x"/d' \
	-e '/code-server.dev\/install.sh/d' \
	-e 's|/tmp/code-server/bin/code-server|/opt/code-server/bin/code-server|' \
	main.tf
grep -q '"$ws"' main.tf || { echo "main.tf has no workspace image to replace" >&2; exit 1; }
! grep -q 'install.sh' main.tf || { echo "main.tf still downloads code-server" >&2; exit 1; }
coder templates push kubernetes --directory . --yes --message "Air-gapped Kubernetes starter" \
	--variable namespace=$NAMESPACE --variable use_kubeconfig=false
EOF
	info "Template 'kubernetes' is ready; its Terraform providers came from the mirror in the Coder image."
}

# ---- Phase: lockdown --------------------------------------------------------------------------------------------

phase_lockdown() {
	[[ $ENDPOINT_ACCESS == public-then-private ]] || return 0
	local public update status
	public=$(awsr eks describe-cluster --name "$CLUSTER_NAME" --query cluster.resourcesVpcConfig.endpointPublicAccess)
	[[ $public == True ]] || return 0
	log "Turning off the public API endpoint"
	update=$(awsr eks update-cluster-config --name "$CLUSTER_NAME" \
		--resources-vpc-config endpointPublicAccess=false,endpointPrivateAccess=true --query update.id)
	wait_until 1800 "the endpoint update" update_done "$update" || die "The endpoint update didn't finish."
	status=$(awsr eks describe-update --name "$CLUSTER_NAME" --update-id "$update" --query update.status)
	[[ $status == Successful ]] || die "The endpoint update ended as $status."
	info "The API is now private: reach it from $API_PRIVATE_CIDRS."
}

update_done() {
	local s
	s=$(awsr eks describe-update --name "$CLUSTER_NAME" --update-id "$1" --query update.status)
	[[ $s == Successful || $s == Failed || $s == Cancelled ]]
}

# ---- Summary ----------------------------------------------------------------------------------------------------

summary() {
	local url=${ACCESS_URL_RESOLVED:-$ACCESS_URL}
	log "Coder is up"
	info "Admin:     $ADMIN_EMAIL (user $ADMIN_USERNAME)"
	info "Password:  KUBECONFIG=$KUBECONFIG kubectl -n $NAMESPACE get secret coder-first-user -o jsonpath='{.data.password}' | base64 -d"
	if [[ $EXPOSE == internal-lb ]]; then
		info "Open:      $url  (from inside the VPC: VPN, Direct Connect, peering or a bastion)"
	fi
	info "Or:        KUBECONFIG=$KUBECONFIG kubectl -n $NAMESPACE port-forward svc/coder 8080:80, then http://localhost:8080"
	if [[ $ENDPOINT_ACCESS == public-then-private ]]; then
		info "           (the API is private now: kubectl works only from $API_PRIVATE_CIDRS)"
	fi
	[[ $INSTALL_METHOD == argocd ]] && info "Argo CD:   kubectl -n argocd get application coder-platform"
	[[ $CREATE_TEMPLATE == yes ]] && info "Template:  kubernetes (namespace $NAMESPACE, code-server $CODE_SERVER_RESOLVED in the image)"
	if [[ -n $IMG_EXTRA ]]; then
		info "Extra images for your templates:"
		local p
		for p in $IMG_EXTRA; do info "  $(image_ref "$p")"; done
	fi
	info "Serve Coder over HTTPS (for example an ingress with your certificate) so the dashboard can resize uploads."
	info "Files:     $WORK_DIR (config.env, state.env, kubeconfig, install.log)"
	info "Remove:    $0 destroy --work-dir $WORK_DIR"
}

# ---- Destroy ----------------------------------------------------------------------------------------------------

cmd_destroy() {
	[[ -n $CONFIG_FILE ]] && load_kv "$CONFIG_FILE"
	if [[ -n $MINIKUBE_PROFILE || ${WORK_DIR:-} == *coder-minikube-* ]]; then
		minikube_destroy
		return
	fi
	ask CLUSTER_NAME "Cluster name to destroy" coder '^[a-z][a-z0-9-]{0,30}$'
	WORK_DIR=${WORK_DIR:-$PWD/coder-eks-$CLUSTER_NAME}
	[[ -f $WORK_DIR/config.env ]] || die "$WORK_DIR/config.env not found: point --work-dir at the install's files."
	load_kv "$WORK_DIR/config.env"
	state_load
	export KUBECONFIG=$WORK_DIR/kubeconfig
	preflight_aws

	warn "This deletes cluster $CLUSTER_NAME in $AWS_REGION with all its workspaces and data${VPC_CREATED:+, and VPC ${VPC_ID:-}}."
	if interactive; then
		local typed
		read -r -p "Type the cluster name to confirm: " typed || typed=""
		[[ $typed == "$CLUSTER_NAME" ]] || die "Not confirmed; nothing was deleted."
	elif ((ASSUME_YES == 0)); then
		die "Run with --yes to destroy without a prompt."
	fi

	local exists
	exists=$(awsr eks describe-cluster --name "$CLUSTER_NAME" --query cluster.status 2>/dev/null || echo NONE)
	if [[ $exists != NONE ]]; then
		delete_workloads
		if awsr eks describe-nodegroup --cluster-name "$CLUSTER_NAME" --nodegroup-name "$CLUSTER_NAME-nodes" >/dev/null 2>&1; then
			log "Deleting the node group"
			awsr eks delete-nodegroup --cluster-name "$CLUSTER_NAME" --nodegroup-name "$CLUSTER_NAME-nodes" >/dev/null
			retry 3 1 awsr eks wait nodegroup-deleted --cluster-name "$CLUSTER_NAME" --nodegroup-name "$CLUSTER_NAME-nodes"
		fi
		log "Deleting the cluster"
		awsr eks delete-cluster --name "$CLUSTER_NAME" >/dev/null
		retry 3 1 awsr eks wait cluster-deleted --name "$CLUSTER_NAME"
	fi
	if [[ -n ${LAUNCH_TEMPLATE_ID:-} ]]; then
		awsr ec2 delete-launch-template --launch-template-id "$LAUNCH_TEMPLATE_ID" >/dev/null 2>&1 || true
	fi
	delete_leftover_load_balancers

	if [[ -n ${VPCE_IDS:-} ]]; then
		log "Deleting the VPC endpoints"
		# shellcheck disable=SC2086
		awsr ec2 delete-vpc-endpoints --vpc-endpoint-ids $VPCE_IDS >/dev/null || true
		wait_until 600 "the VPC endpoints to go" endpoints_gone || warn "Some VPC endpoints are still being deleted."
	fi
	if [[ -n ${VPCE_SG_ID:-} ]]; then
		retry 6 20 awsr ec2 delete-security-group --group-id "$VPCE_SG_ID" || warn "Couldn't delete security group $VPCE_SG_ID."
	fi
	if [[ ${VPC_CREATED:-} == yes ]]; then
		log "Deleting VPC $VPC_ID"
		local subnet rt
		for subnet in ${SUBNET_IDS:-}; do
			retry 6 20 awsr ec2 delete-subnet --subnet-id "$subnet" || warn "Couldn't delete subnet $subnet."
		done
		for rt in ${ROUTE_TABLE_IDS:-}; do
			awsr ec2 delete-route-table --route-table-id "$rt" || warn "Couldn't delete route table $rt."
		done
		retry 6 20 awsr ec2 delete-vpc --vpc-id "$VPC_ID" || warn "Couldn't delete VPC $VPC_ID; check for leftover network interfaces."
	fi

	if [[ ${IAM_CREATED:-} == yes ]]; then
		log "Deleting the IAM roles"
		local role policy
		for role in "$CLUSTER_NAME-eks-cluster" "$CLUSTER_NAME-eks-node"; do
			for policy in $(awsr iam list-attached-role-policies --role-name "$role" --query 'AttachedPolicies[].PolicyArn' 2>/dev/null || true); do
				awsr iam detach-role-policy --role-name "$role" --policy-arn "$policy"
			done
			awsr iam delete-role --role-name "$role" 2>/dev/null || true
		done
	fi

	delete_ecr_repositories
	mv "$WORK_DIR/state.env" "$WORK_DIR/state.env.destroyed" 2>/dev/null || true
	log "Destroyed $CLUSTER_NAME"
}

# delete_workloads removes Coder first, so Kubernetes deletes the load balancer and the volumes it created.
delete_workloads() {
	if ! kubectl version --request-timeout=10s >/dev/null 2>&1; then
		warn "The Kubernetes API isn't reachable from here (private endpoint?)."
		warn "Run destroy from inside the VPC to delete the EBS volumes of Coder's database and workspaces too;"
		warn "otherwise they're left behind (tag kubernetes.io/created-for/pvc/namespace=$NAMESPACE)."
		return
	fi
	log "Deleting Coder and its volumes"
	if kubectl -n argocd get application coder-platform >/dev/null 2>&1; then
		kubectl -n argocd delete application coder-platform --timeout=10m >/dev/null || true
	fi
	helm uninstall "$RELEASE" -n "$NAMESPACE" --wait >/dev/null 2>&1 || true
	kubectl delete namespace "$NAMESPACE" --timeout=10m >/dev/null 2>&1 || true
	wait_until 600 "the volumes to be released" volumes_gone || warn "Some volumes weren't released; check EBS for leftovers."
}

volumes_gone() {
	[[ -z $(kubectl get pv -o jsonpath="{range .items[?(@.spec.claimRef.namespace=='$NAMESPACE')]}{.metadata.name}{end}" 2>/dev/null) ]]
}

endpoints_gone() {
	local left
	# shellcheck disable=SC2086
	left=$(awsr ec2 describe-vpc-endpoints --vpc-endpoint-ids $VPCE_IDS --query "VpcEndpoints[?State!='deleted'].VpcEndpointId" 2>/dev/null || true)
	[[ -z $left || $left == None ]]
}

# delete_leftover_load_balancers removes load balancers and security groups Kubernetes made for this cluster that
# survived (when the API wasn't reachable to delete the Service).
delete_leftover_load_balancers() {
	[[ -n ${VPC_ID:-} ]] || return 0
	local lb owner sg
	for lb in $(awsr elb describe-load-balancers --query "LoadBalancerDescriptions[?VPCId=='$VPC_ID'].LoadBalancerName" 2>/dev/null || true); do
		owner=$(awsr elb describe-tags --load-balancer-names "$lb" \
			--query "TagDescriptions[0].Tags[?Key=='kubernetes.io/cluster/$CLUSTER_NAME'].Value")
		if [[ -n $owner && $owner != None ]]; then
			info "Deleting load balancer $lb"
			awsr elb delete-load-balancer --load-balancer-name "$lb"
		fi
	done
	for sg in $(awsr ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" \
		"Name=tag-key,Values=kubernetes.io/cluster/$CLUSTER_NAME" --query 'SecurityGroups[].GroupId' 2>/dev/null || true); do
		retry 6 20 awsr ec2 delete-security-group --group-id "$sg" 2>/dev/null || warn "Couldn't delete security group $sg."
	done
}

delete_ecr_repositories() {
	local manifest=$WORK_DIR/artifacts/manifest.env path repo delete=no
	[[ -f $manifest ]] || return 0
	load_manifest "$manifest"
	if interactive; then
		read -r -p "Also delete the images in ECR under ${ECR_PREFIX}/? (yes/no) [no]: " delete || delete=no
	fi
	[[ $delete == yes || $delete == y ]] || {
		info "Kept the ECR images."
		return 0
	}
	while read -r path; do
		repo="${ECR_PREFIX:+$ECR_PREFIX/}${path%:*}"
		awsr ecr delete-repository --repository-name "$repo" --force >/dev/null 2>&1 && info "Deleted $repo"
	done < <(all_images)
}

# ---- minikube ---------------------------------------------------------------------------------------------------

cmd_minikube() {
	need_cmd minikube kubectl helm
	check_helm
	[[ -n $CONFIG_FILE ]] && load_kv "$CONFIG_FILE"
	local current
	current=$(kubectl config current-context 2>/dev/null || true)
	if [[ -z $MINIKUBE_PROFILE && -n $current ]] && minikube -p "$current" status >/dev/null 2>&1; then
		MINIKUBE_PROFILE=$current
	fi
	ask MINIKUBE_PROFILE "minikube profile" minikube '^[A-Za-z0-9][A-Za-z0-9_.-]*$'
	[[ $(minikube -p "$MINIKUBE_PROFILE" status --format '{{.APIServer}}' 2>/dev/null) == Running ]] ||
		die "minikube profile $MINIKUBE_PROFILE isn't running: minikube start -p $MINIKUBE_PROFILE"
	WORK_DIR=${WORK_DIR:-$PWD/coder-minikube-$MINIKUBE_PROFILE}
	mkdir -p "$WORK_DIR"
	if [[ -f $WORK_DIR/config.env ]]; then
		info "Reusing the answers in $WORK_DIR/config.env."
		load_kv "$WORK_DIR/config.env"
	fi
	kubectl config view --raw --minify --context "$MINIKUBE_PROFILE" >"$WORK_DIR/kubeconfig"
	export KUBECONFIG=$WORK_DIR/kubeconfig
	state_load

	# Images keep local names that no registry serves, so a pod that would pull from the internet fails to start.
	REGISTRY=airgap.local ECR_PREFIX="" STORAGE_CLASS=local-path WORKSPACE_PULL_POLICY=IfNotPresent
	EXPOSE=port-forward ACCESS_URL="" WILDCARD_ACCESS_URL="" OIDC_ENABLED=no CLUSTER_NAME=$MINIKUBE_PROFILE
	ARCH=$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.architecture}')
	CONFIG_KEYS+=(MINIKUBE_PROFILE)
	if [[ -n $BUNDLE_FILE ]]; then
		extract_bundle
		[[ $BUNDLE_ARCH == "$ARCH" ]] || die "The bundle is for $BUNDLE_ARCH, but the minikube nodes are $ARCH."
		ask INSTALL_METHOD "Deploy Coder with plain Helm or Argo CD (helm/argocd)" helm '^(argocd|helm)$'
		[[ $INSTALL_METHOD == helm || -n $IMG_ARGOCD ]] || die "The bundle has no Argo CD images; use INSTALL_METHOD=helm."
	else
		ask INSTALL_METHOD "Deploy Coder with plain Helm or Argo CD (helm/argocd)" helm '^(argocd|helm)$'
		ask_artifact_questions
	fi
	ask ADMIN_USERNAME "First admin's username" admin '^[a-zA-Z0-9][a-zA-Z0-9-]{0,31}$'
	ask ADMIN_EMAIL "First admin's e-mail" admin@example.com '^[^@ ]+@[^@ ]+$'
	ask CA_PEM_FILE "PEM file of a private CA to trust (optional)" "" '^[^ ]*$'
	ask CREATE_TEMPLATE "Create the air-gapped Kubernetes workspace template (yes/no)" yes '^(yes|no)$'
	preflight_docker
	save_config
	exec > >(tee -a "$WORK_DIR/install.log") 2>&1

	local dir=$WORK_DIR/artifacts path loaded
	if [[ -n $BUNDLE_FILE ]]; then
		log "Loading the bundle's images into Docker"
		docker load -q -i "$dir/images.tar" >/dev/null
	elif [[ ! -f $dir/manifest.env || $FROM_PHASE != platform ]]; then
		TMP_DIR=$(mktemp -d)
		build_artifacts "$dir"
	fi
	load_manifest "$dir/manifest.env"

	log "Loading the images into minikube profile $MINIKUBE_PROFILE"
	loaded=$(minikube -p "$MINIKUBE_PROFILE" image ls 2>/dev/null || true)
	while read -r path; do
		if grep -qxF "airgap.local/$path" <<<"$loaded"; then
			info "airgap.local/$path (already loaded)"
			continue
		fi
		info "airgap.local/$path"
		minikube -p "$MINIKUBE_PROFILE" image load "airgap.local/$path" || die "Loading airgap.local/$path failed."
	done < <(all_images)

	log "Turning on the local-path StorageClass (minikube addon storage-provisioner-rancher)"
	# The default hostPath class makes root-owned volumes that PostgreSQL (uid 999) can't write to.
	minikube -p "$MINIKUBE_PROFILE" addons enable storage-provisioner-rancher >/dev/null
	wait_until 180 "StorageClass local-path" storage_class_exists local-path || die "StorageClass local-path didn't appear."
	info "The addon also makes local-path this cluster's default StorageClass."

	phase_platform
	[[ $INSTALL_METHOD == argocd ]] && state_set ARGOCD_INSTALLED yes
	phase_template

	log "Coder is up on minikube profile $MINIKUBE_PROFILE"
	info "Open:      KUBECONFIG=$KUBECONFIG kubectl -n $NAMESPACE port-forward svc/coder 8080:80"
	info "           then http://localhost:8080"
	info "Admin:     $ADMIN_EMAIL"
	info "Password:  KUBECONFIG=$KUBECONFIG kubectl -n $NAMESPACE get secret coder-first-user -o jsonpath='{.data.password}' | base64 -d"
	[[ $CREATE_TEMPLATE == yes ]] && info "Template:  kubernetes (workspaces use the loaded image; nothing is pulled)"
	info "Remove:    $0 destroy --profile $MINIKUBE_PROFILE"
}

storage_class_exists() { kubectl get storageclass "$1" >/dev/null 2>&1; }

minikube_destroy() {
	ask MINIKUBE_PROFILE "minikube profile" minikube '^[A-Za-z0-9][A-Za-z0-9_.-]*$'
	WORK_DIR=${WORK_DIR:-$PWD/coder-minikube-$MINIKUBE_PROFILE}
	[[ -f $WORK_DIR/config.env ]] || die "$WORK_DIR/config.env not found: point --work-dir at the minikube install's files."
	load_kv "$WORK_DIR/config.env"
	state_load
	kubectl config view --raw --minify --context "$MINIKUBE_PROFILE" >"$WORK_DIR/kubeconfig"
	export KUBECONFIG=$WORK_DIR/kubeconfig
	if interactive; then
		local go
		read -r -p "Remove Coder${ARGOCD_INSTALLED:+ and Argo CD} from minikube profile $MINIKUBE_PROFILE? (yes/no) [no]: " go || go=no
		[[ $go == yes || $go == y ]] || die "Not confirmed; nothing was removed."
	fi
	log "Removing Coder from minikube profile $MINIKUBE_PROFILE"
	# Argo CD has to be running to delete what its Application created, so the Application goes first.
	if kubectl -n argocd get application coder-platform >/dev/null 2>&1; then
		kubectl -n argocd delete application coder-platform --timeout=10m >/dev/null
	fi
	helm uninstall "$RELEASE" -n "$NAMESPACE" --wait >/dev/null 2>&1 || true
	kubectl delete namespace "$NAMESPACE" --ignore-not-found --timeout=10m >/dev/null
	# Helm removes these with the release; they're left only when Argo CD's cascade didn't run.
	kubectl get clusterrole,clusterrolebinding -o name | { grep -E "/coder-ui-updates-$NAMESPACE\$" || true; } |
		xargs -r kubectl delete >/dev/null
	if [[ ${ARGOCD_INSTALLED:-} == yes ]]; then
		log "Removing Argo CD"
		helm uninstall argocd -n argocd --wait >/dev/null 2>&1 || true
		kubectl delete namespace argocd --ignore-not-found --timeout=5m >/dev/null
		kubectl get crd -o name | { grep '\.argoproj\.io$' || true; } | xargs -r kubectl delete >/dev/null
	fi
	mv "$WORK_DIR/state.env" "$WORK_DIR/state.env.destroyed" 2>/dev/null || true
	info "Done. The images stay in minikube (minikube -p $MINIKUBE_PROFILE image ls | grep airgap.local)."
}

# ---- Main -------------------------------------------------------------------------------------------------------

main() {
	[[ $# -gt 0 ]] || {
		usage
		exit 1
	}
	COMMAND=$1
	shift
	while [[ $# -gt 0 ]]; do
		case "$1" in
		--config) CONFIG_FILE=$2 && shift 2 ;;
		--bundle) BUNDLE_FILE=$(realpath "$2") && shift 2 ;;
		--output) OUTPUT_FILE=$(realpath "$2") && shift 2 ;;
		--from) FROM_PHASE=$2 && shift 2 ;;
		--work-dir) WORK_DIR=$(realpath "$2") && shift 2 ;;
		--profile) MINIKUBE_PROFILE=$2 && shift 2 ;;
		-y | --yes) ASSUME_YES=1 && shift ;;
		-h | --help) usage && exit 0 ;;
		*) die "Unknown option $1 (see: $0 help)" ;;
		esac
	done
	case "$COMMAND" in
	install) cmd_install ;;
	minikube) cmd_minikube ;;
	bundle) cmd_bundle ;;
	destroy) cmd_destroy ;;
	help | -h | --help) usage ;;
	*) die "Unknown command $COMMAND (see: $0 help)" ;;
	esac
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
	main "$@"
fi
