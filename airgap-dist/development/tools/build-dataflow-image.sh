#!/usr/bin/env bash
# Builds the workspace image of the ubuntu-dataflow template, ghcr.io/user187x/coder-workspace-dataflow:<TAG>
# (../workspace-image-dataflow: the DEFAULT template's image + Apache NiFi + Apache Airflow), and checks that NiFi
# and Airflow start and answer with no network at all. NiFi's archive is downloaded once (kept in
# ../workspace-image-dataflow/nifi-<version>-bin.zip, not in git) and checked against Apache's SHA-512; Airflow is
# pinned with Airflow's own constraints for the image's Python (but for ../workspace-image-dataflow/airflow-overrides.txt),
# and NiFi's libraries with fixed vulnerabilities replaced (../workspace-image-dataflow/patch-nifi-jars.py).
#   ./build-dataflow-image.sh [--no-store] [TAG]   default 1.1.4; --no-store: build and check only, the bundle untouched
#   BASE=<image> ./build-dataflow-image.sh ...      another base than the Dockerfile's (ARG BASE)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; dev="$(dirname "$here")"
ctx="${dev}/workspace-image-dataflow"
store=1; if [[ "${1:-}" == --no-store ]]; then store=0; shift; fi
tag="${1:-1.1.4}"; img="ghcr.io/user187x/coder-workspace-dataflow:${tag}"
nifi="$(sed -n 's/^ARG NIFI_VERSION=//p' "${ctx}/Dockerfile")"
airflow="$(sed -n 's/^ARG AIRFLOW_VERSION=//p' "${ctx}/Dockerfile")"
base="${BASE:-$(sed -n 's/^ARG BASE=//p' "${ctx}/Dockerfile")}"
py="$(docker run --rm --entrypoint python3 "$base" -c 'import sys; print("%d.%d" % sys.version_info[:2])')"

zip="${ctx}/nifi-${nifi}-bin.zip"
if [[ ! -f "$zip" ]]; then
	for mirror in https://downloads.apache.org/nifi https://archive.apache.org/dist/nifi; do
		curl -fL --retry 3 -o "${zip}.part" "${mirror}/${nifi}/nifi-${nifi}-bin.zip" && break
	done
	mv "${zip}.part" "$zip"
fi
want="$(curl -fsL "https://downloads.apache.org/nifi/${nifi}/nifi-${nifi}-bin.zip.sha512" ||
	curl -fsL "https://archive.apache.org/dist/nifi/${nifi}/nifi-${nifi}-bin.zip.sha512")"
want="${want%% *}"
got="$(sha512sum "$zip" | cut -d' ' -f1)"
[[ "$got" == "$want" ]] || { echo "nifi-${nifi}-bin.zip: SHA-512 mismatch (got ${got:0:16}…, want ${want:0:16}…)" >&2; rm -f "$zip"; exit 1; }
echo "nifi-${nifi}-bin.zip: SHA-512 verified"
curl -fsL -o "${ctx}/airflow-constraints.txt" \
	"https://raw.githubusercontent.com/apache/airflow/constraints-${airflow}/constraints-${py}.txt"

docker build --platform linux/amd64 --build-arg BASE="$base" -t "$img" "$ctx"

# NiFi as the template starts it (a ~/.nifi of its own: conf, flows, logs; bin and lib from /opt/nifi; the NARs
# unpacked in the image), sent the app's path and Coder's host as the cluster's Gateway sends them (the template's
# HTTPRoute), and Airflow under its app path: with no network at all.
# (--hostname localhost: NiFi looks its host up, and with no network Docker's container name does not resolve; a
# pod's always does.)
docker run --rm --network none --hostname localhost --entrypoint bash "$img" -c '
	set -e; export HOME=/home/coder; P=/@coder/check.main/apps
	mkdir -p "$HOME/.nifi"; cd "$HOME/.nifi"
	# What /opt/nifi links into (as the template'"'"'s startup script makes it).
	mkdir -p logs run state database_repository flowfile_repository content_repository provenance_repository \
		status_repository nar_repository assets connector_assets diagnostics work/uploads work/python work/jetty work/docs
	cp -r /opt/nifi/conf.dist conf
	sed -i -e "s|^nifi.web.proxy.context.path=.*|nifi.web.proxy.context.path=$P/nifi|" \
	       -e "s|^nifi.web.proxy.host=.*|nifi.web.proxy.host=coder.example.com|" \
	       -e "s|^nifi.sensitive.props.key=.*|nifi.sensitive.props.key=check-$RANDOM-$RANDOM|" conf/nifi.properties
	/opt/nifi/bin/nifi.sh start >/dev/null
	# As a request reaches NiFi from the Gateway through Coder: on the Coder host, with the proxy headers.
	nifi() { curl -fs -H "Host: coder.example.com" -H "X-ProxyContextPath: $P/nifi" -H "X-ProxyScheme: https" \
		-H "X-ProxyHost: coder.example.com" -H "X-ProxyPort: 443" "$@"; }
	export AIRFLOW_HOME="$HOME/airflow" AIRFLOW__API__HOST=127.0.0.1 AIRFLOW__API__PORT=8090 AIRFLOW__API__WORKERS=1 \
		AIRFLOW__API__BASE_URL="http://127.0.0.1:8090$P/airflow" AIRFLOW__CORE__SIMPLE_AUTH_MANAGER_ALL_ADMINS=True \
		AIRFLOW__CORE__EXECUTION_API_SERVER_URL="http://127.0.0.1:8090$P/airflow/execution/" AIRFLOW__CORE__LOAD_EXAMPLES=True \
		PATH="/opt/airflow/bin:$PATH"
	/opt/airflow/bin/airflow standalone >"$HOME/airflow.log" 2>&1 &
	for i in $(seq 1 180); do
		nifi "http://127.0.0.1:8080/nifi-api/flow/about" >/dev/null && curl -fs "http://127.0.0.1:8090$P/airflow/api/v2/monitor/health" >/dev/null && break
		sleep 2
	done
	nifi "http://127.0.0.1:8080/nifi-api/flow/about" || { tail -n 40 logs/nifi-app.log logs/nifi-bootstrap.log; exit 1; }; echo
	page="$(nifi http://127.0.0.1:8080/nifi/)"; echo "$page" | grep -o "<base[^>]*>" || true
	# The app'"'"'s root (its button, a panel): NiFi'"'"'s UI, under the app'"'"'s path.
	to="$(nifi -o /dev/null -w "%{redirect_url}" http://127.0.0.1:8080/)"; echo "/ -> $to"
	case "$to" in *"$P/nifi/nifi/"*) ;; *) echo "NiFi'"'"'s root does not redirect under the app'"'"'s path" >&2; exit 1 ;; esac
	curl -fs "http://127.0.0.1:8090$P/airflow/api/v2/monitor/health" || { tail -n 40 "$HOME/airflow.log"; exit 1; }; echo
	curl -fs "http://127.0.0.1:8090$P/airflow/" | grep -o "<base[^>]*>" || true
	du -sh "$HOME/.nifi" | sed "s/^/per-workspace NiFi data: /"
	echo "NiFi and Airflow offline checks passed"'
# Into the delivery bundle (helm-chart/images/custom/), replacing the previous one; then update its [custom] line (tag,
# digest) in helm-chart/images.txt and coder-workspace.dataflowImage in helm-chart/coder-airgapped/values.yaml.
top="$(dirname "$dev")"
# its archive in the bundle, in its section's folder of images.txt (replacing the previous tag's)
if (( store )); then "${top}/helm-chart/mirror-images.sh" store "$img"; else echo "--no-store: not stored in the bundle"; fi
echo "built $img on $base (NiFi ${nifi}, Airflow ${airflow}, Python ${py}); image ID $(docker image inspect --format '{{.Id}}' "$img")"
