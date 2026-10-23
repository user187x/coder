#!/usr/bin/env bash
# Builds the release as a plain directory, dist/coder-fork-<version>/ (<version>: the chart's): the images of ours the
# chart can run and the one chart - one push of ours and one helm install on any air-gapped cluster whose registry
# holds the public images (INSTALL.md lists them; the owner's choice: the release's CVE gate covers what is ours, the
# public images' CVEs are their projects'). Every file is under 2 GiB, so the folder's files can be the assets of a
# GitHub release as they are.
#   coder-airgapped-<version>.tgz    the chart (helm lint and a render first; packaged from a copy without __pycache__):
#                                    one helm install installs the whole platform (INSTALL.md)
#   <name>_<tag>.tar.gz              each image (docker save | gzip, from helm-chart/images: hard-linked when on the same
#                                    file system, else copied); one over SPLIT_SIZE in parts <file>.part-00, -01, ...
#                                    (streamed by split, no extra whole copy; cat joins them)
#   push-images.sh                   the far side: ./push-images.sh REGISTRY [--dry-run] [--ours-only] - checks SHA256SUMS,
#                                    then docker load / tag / push each image as REGISTRY/<its path without the source
#                                    host> (release/push-images.sh; it would push public ones too, were any here)
#   IMAGES.txt                       per image: its reference, file(s), size, config digest, manifest digest
#   PUBLIC-IMAGES.txt                the public images the chart runs: their path under REGISTRY and the public image
#                                    by its tested digest (INSTALL.md step 1 lists them too)
#   pull-public-images.sh            the connected side, optional: saves those public images into the folder
#                                    (public/, IMAGES-public.txt, SHA256SUMS.public), so push-images.sh pushes them too
#                                    (release/pull-public-images.sh)
#   INSTALL.md                       the public images your registry must hold, push, values, the one helm install,
#                                    sign-in, uninstall (release/INSTALL.md.in)
#   values.example.yaml              the one values file to start from; values-ha.example.yaml, high availability on top
#   SHA256SUMS                       every file in the folder, parts one by one (sha256sum -c SHA256SUMS works as is)
#   SHA256SUMS.joined                the split archives as joined (<file>.tar.gz), when any is split
#   CVE-REPORT.md                    with --scan / --scan-only
# The images: those of images.txt that are ours (ghcr.io/user187x/...), outside its [rollback] and [reference]
# sections, that the chart renders under `--set global.registry=REGISTRY.invalid` - by default, and with high
# availability and its own prerequisites (global.bundled) - matched on path:tag. An image of ours the chart renders
# without an archive (or not in images.txt) is an error; those of ours it does not render are listed as left out; the
# public ones it renders go into INSTALL.md's list. Each archive is checked against its folder's SHA256SUMS on the way.
#
#   ./build-release.sh [--out DIR] [--plan] [--scan [--vex FILE]... [--no-db-update]]
#   ./build-release.sh --scan-only [--out DIR] [--vex FILE]... [--no-db-update]
# --out DIR        the release folder (default dist/coder-fork-<version>), written from scratch (built beside it as
#                  DIR.partial, then moved; an existing DIR must be an earlier release: it has IMAGES.txt)
# --plan           the checks, the images and what it would write; writes nothing
# --scan           (default: --no-scan) CVE gate after the build: trivy, from TOOLS_IMAGE, with its vulnerability DB
#                  and Java DB updated now into TRIVY_CACHE, scans every image of the folder offline (--network none;
#                  a split one joined into a temporary file in TRIVY_CACHE, removed after). Writes CVE-REPORT.md (per
#                  image the counts by severity: all, fixable, cleared by VEX, fixable after VEX; the DB dates; a
#                  table of the fixable findings left) and trivy's JSON reports into DIR.scan/. FAILS (exit 1) when a
#                  finding has a fixed version and no --vex file declares it not_affected.
# --scan-only      the same on an existing release folder, without building it (SHA256SUMS gets CVE-REPORT.md's line)
# --vex FILE       a VEX document (OpenVEX, CycloneDX or CSAF) for trivy's --vex; repeatable
# --no-db-update   scan with the databases in TRIVY_CACHE as they are (no download; they must be there)
# Environment:
#   SPLIT_SIZE=1900M    an archive larger than this is split into parts of this size (numfmt IEC: 1900M, 10M, ...)
#   TOOLS_IMAGE=ghcr.io/user187x/coder-image-tools:1.2.0         the trivy to scan with (1.1.0 or newer)
#   TRIVY_CACHE=${XDG_CACHE_HOME:-~/.cache}/coder-airgapped/trivy    trivy's databases (about 3 GB)
#   ONLY=coder-minio,coder-registry   TEST AID: only these images (by name) - a partial release, never one to ship
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; top="$(cd "${here}/../.." && pwd)"
bundle="${top}/helm-chart"; chart="${bundle}/coder-airgapped"; templates="${here}/release"
version=$(sed -n 's/^version: *//p' "${chart}/Chart.yaml")
coder_version=$(sed -n 's/^appVersion: *"\{0,1\}\([^"]*\)"\{0,1\} *$/\1/p' "${chart}/Chart.yaml")
out="${top}/dist/coder-fork-${version}"
build=1 plan=0 scan=0 db_update=1 vex=()
usage() { sed -n '2,/^set /p' "$0" | sed '$d' >&2; exit 2; }
while (($#)); do
	case "$1" in
	--out) out="${2:?--out DIR}"; shift ;;
	--plan) plan=1 ;;
	--scan) scan=1 ;;
	--no-scan) scan=0 ;;
	--scan-only) scan=1 build=0 ;;
	--vex) vex+=("${2:?--vex FILE}"); shift ;;
	--no-db-update) db_update=0 ;;
	-h | --help) usage ;;
	*) echo "unknown option: $1" >&2; usage ;;
	esac
	shift
done
die() { echo "ERROR: $*" >&2; exit 1; }
out=$(realpath -m "$out")
split_bytes=$(numfmt --from=iec "${SPLIT_SIZE:-1900M}") || die "SPLIT_SIZE: ${SPLIT_SIZE}"
tools_image="${TOOLS_IMAGE:-ghcr.io/user187x/coder-image-tools:1.2.0}"
trivy_cache=$(realpath -m "${TRIVY_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/coder-airgapped/trivy}")
only=",${ONLY:-},"
for v in "${vex[@]}"; do [[ -f "$v" ]] || die "no VEX file $v"; done
unzip=$(command -v pigz || echo gzip)

tmp=$(mktemp -d) stage="" join_dir=""
cleanup() { rm -rf "$tmp"; [[ -z "$stage" ]] || rm -rf "$stage"; [[ -z "$join_dir" ]] || rm -rf "$join_dir"; }
trap cleanup EXIT

human() { numfmt --to=iec-i --suffix=B --format=%.1f "$1"; }
path_of() { # the reference without its source registry host (mirror-images.sh's target())
	local ref="$1" first="${1%%/*}"
	if [[ "$first" == *.* || "$first" == *:* ]]; then ref="${ref#*/}"; fi
	echo "$ref"
}
name_of() { local p="${1##*/}"; echo "${p%%[:@]*}"; }
wanted() { [[ "$only" == ",," || "$only" == *",$1,"* ]]; }
existing() { local p="$1"; while [[ ! -e "$p" ]]; do p=$(dirname "$p"); done; echo "$p"; }
free_bytes() { df -B1 --output=avail "$(existing "$1")" | tail -n1 | tr -d ' '; }
sums_line() { # DIR FILE: FILE's line of DIR/SHA256SUMS written again
	local s; s=$(cd "$1" && sha256sum "$2")
	{ awk -v f="$2" '$2 != f' "$1/SHA256SUMS"; echo "$s"; } | sort -k2,2 >"$tmp/sums.new"
	mv "$tmp/sums.new" "$1/SHA256SUMS"
}

digests() { # DIR with an archive's manifest.json (and index.json): "<config digest> <manifest digest|-> <RepoTags|->"
	python3 - "$1" <<'PY'
import json, os, sys
d = sys.argv[1]
m = json.load(open(os.path.join(d, "manifest.json")))[0]
cfg = m["Config"].rsplit("/", 1)[-1]
cfg = cfg[:-5] if cfg.endswith(".json") else cfg
man = "-"
if os.path.exists(os.path.join(d, "index.json")):
    ms = json.load(open(os.path.join(d, "index.json"))).get("manifests") or []
    if ms:
        man = ms[0]["digest"]
print(cfg if ":" in cfg else "sha256:" + cfg, man, ",".join(m.get("RepoTags") or []) or "-")
PY
}

# ---------------------------------------------------------------------------------------------------------------------
build_release() {
	[[ "$only" == ",," ]] || echo "ONLY=${ONLY}: a partial release (test aid), not one to ship"
	helm lint "$chart" >"$tmp/lint.log" 2>&1 || { cat "$tmp/lint.log" >&2; die "helm lint failed"; }
	echo "lint ok"
	helm template coder "$chart" -n coder >/dev/null 2>"$tmp/render.log" || { cat "$tmp/render.log" >&2; die "helm template failed"; }
	echo "render ok"
	helm template coder "$chart" -n coder --set global.registry=REGISTRY.invalid >"$tmp/render.yaml" 2>"$tmp/render.log" ||
		{ cat "$tmp/render.log" >&2; die "helm template --set global.registry=REGISTRY.invalid failed"; }
	# every image the chart can run: also with high availability and with its own prerequisites (Traefik, the
	# CloudNativePG operator: global.bundled) - the release carries ours, INSTALL.md lists the public ones
	helm template coder "$chart" -n coder --set global.registry=REGISTRY.invalid -f "${bundle}/values-ha.example.yaml" \
		--set global.bundled.traefik=true --set global.bundled.cloudnativePG=true --set secrets.generateTls=true \
		>>"$tmp/render.yaml" 2>"$tmp/render.log" ||
		{ cat "$tmp/render.log" >&2; die "helm template with values-ha.example.yaml and global.bundled failed"; }
	# every image reference under the registry: path:tag (a trailing \ of an escaped string is not part of it)
	grep -oE 'REGISTRY\.invalid/[A-Za-z0-9._/-]+(:[A-Za-z0-9_.-]+)?(@sha256:[0-9a-f]{64})?' "$tmp/render.yaml" |
		sed 's|^REGISTRY\.invalid/||' | sort -u >"$tmp/rendered" || true
	local -A rendered=()
	local r
	while read -r r; do
		if [[ "${r##*/}" != *:* || "$r" == *@* ]]; then
			echo "warning: the chart renders REGISTRY/${r} (no tag, or a digest): not matched against images.txt" >&2
			continue
		fi
		rendered[$r]=1
	done <"$tmp/rendered"
	((${#rendered[@]})) || die "the chart renders no image under global.registry"

	# images.txt (as mirror-images.sh reads it)
	local -a groups=() images=() digests=()
	local -A folder=()
	local a b g=""
	while read -r a b _; do
		[[ -z "$a" || "$a" == \#* ]] && continue
		if [[ "$a" == \[*\] ]]; then g="${a:1:-1}"; folder[$g]="${b%/}"; continue; fi
		groups+=("$g") images+=("$a") digests+=("$b")
	done <"${bundle}/images.txt"

	# ours, outside [rollback]/[reference], rendered by the chart
	local -a sel=() left_out=() errors=()
	local -A listed=()
	local i img p
	for i in "${!images[@]}"; do
		img=${images[$i]} p=$(path_of "${images[$i]}")
		[[ "$img" == ghcr.io/user187x/* ]] || continue
		case "${groups[$i]}" in rollback | reference) left_out+=("${img}  ([${groups[$i]}])"); continue ;; esac
		listed[$p]=$i
		if [[ -z "${rendered[$p]:-}" ]]; then left_out+=("${img}  (the chart does not run it)"); continue; fi
		wanted "$(name_of "$img")" || continue
		sel+=("$i")
	done
	for r in "${!rendered[@]}"; do
		[[ "$r" == user187x/* ]] || continue
		wanted "$(name_of "$r")" || continue
		[[ -n "${listed[$r]:-}" ]] ||
			errors+=("the chart runs REGISTRY/${r}, which images.txt does not list (outside [rollback]/[reference]): add it there and build its archive")
	done

	# the archives: present and listed in their folder's SHA256SUMS
	local -a src=() size=() sum=() file=() mode=()
	local -A taken=()
	local dev_out f dir s n tag
	dev_out=$(stat -c %d "$(existing "$out")")
	for i in "${sel[@]}"; do
		img=${images[$i]} dir="${bundle}/${folder[${groups[$i]}]}"
		f="${dir}/$(tr '/:@' '___' <<<"$img").tar.gz"
		n=$(name_of "$img") tag="${img##*:}"
		if [[ ! -f "$f" ]]; then
			errors+=("the chart runs ${img}, but its archive is missing: ${f#"${top}"/} (development/tools/build-*.sh, mirror-images.sh store)")
			continue
		fi
		s=$(awk -v f="$(basename "$f")" '$2 == f {print $1}' "${dir}/SHA256SUMS" 2>/dev/null || true)
		[[ -n "$s" ]] || { errors+=("${f#"${top}"/} is not listed in its folder's SHA256SUMS"); continue; }
		[[ -z "${taken[${n}_${tag}]:-}" ]] || { errors+=("two images would both be ${n}_${tag}.tar.gz"); continue; }
		taken[${n}_${tag}]=1
		src+=("$f") sum+=("$s") file+=("${n}_${tag}.tar.gz") size+=("$(stat -c %s "$f")")
		if ((${size[-1]} > split_bytes)); then mode+=(split)
		elif [[ "$(stat -c %d "$f")" == "$dev_out" ]]; then mode+=(link)
		else mode+=(copy); fi
	done
	if ((${#errors[@]})); then
		printf 'ERROR: %s\n' "${errors[@]}" >&2
		die "${#errors[@]} problem(s) above: no release written"
	fi
	((${#sel[@]})) || die "no image selected${ONLY:+ (ONLY=${ONLY})}"

	# the public images the chart runs: your registry must have them (INSTALL.md lists them)
	local -a public=()
	local -A pub_src=()
	for i in "${!images[@]}"; do
		[[ "${images[$i]}" == ghcr.io/user187x/* ]] && continue
		pub_src[$(path_of "${images[$i]}")]="${images[$i]}@${digests[$i]}"
	done
	while read -r r; do
		[[ -n "${rendered[$r]:-}" && "$r" != user187x/* ]] || continue
		public+=("${r}	${pub_src[$r]:-(not in images.txt)}")
	done <"$tmp/rendered"
	# the plan
	local total=0 need=0 k parts how
	echo "coder-fork ${version} (chart coder-airgapped ${version}, Coder ${coder_version}) -> ${out}"
	echo "images of ours the chart runs (with high availability and its own prerequisites too):"
	for k in "${!sel[@]}"; do
		total=$((total + size[k]))
		case "${mode[$k]}" in
		split) parts=$(((size[k] + split_bytes - 1) / split_bytes)); need=$((need + size[k])); how="split into ${parts} parts" ;;
		copy) need=$((need + size[k])); how="copied" ;;
		link) how="hard link" ;;
		esac
		printf '  %-62s %10s  %s\n' "${file[$k]}" "$(human "${size[$k]}")" "$how"
	done
	echo "  ${#sel[@]} images, $(human "$total"); to write: $(human "$need") (split size $(human "$split_bytes"))"
	if ((${#left_out[@]})); then
		echo "left out (ours, not in the release):"; printf '  %s\n' "${left_out[@]}"
	fi
	if ((${#public[@]})); then
		echo "public images the chart runs (not in the release; your registry must have them):"
		printf '%s\n' "${public[@]}" | sed 's/\t/  <- /; s/^/  /'
	fi
	((!plan)) || { echo "plan only: nothing written"; return 0; }

	# room for what is written (hard links take none)
	local avail; avail=$(free_bytes "$out")
	((avail > need + 1073741824)) ||
		die "$(human "$avail") free at $(existing "$out"), $(human "$need") to write (+1 GiB): not enough"

	# the folder, staged beside its place
	if [[ -e "$out" ]]; then
		[[ -d "$out" ]] || die "$out is not a directory"
		[[ -z "$(/bin/ls -A "$out")" || -f "$out/IMAGES.txt" ]] ||
			die "$out is not empty and not a release folder (no IMAGES.txt): choose another --out"
	fi
	stage="${out}.partial"; rm -rf "$stage"; mkdir -p "$stage"
	: >"$tmp/sums"; : >"$tmp/joined"
	local whole got list meta cfg man tags hash_pid
	local -a plist
	{
		echo "# coder-fork ${version}: the images of ours that the chart coder-airgapped-${version}.tgz runs (Coder ${coder_version}), linux/amd64."
		echo "# push-images.sh reads this file. Per image: the reference it was built as (pushed as REGISTRY/<that path"
		echo "# without ghcr.io>); its file(s) here, docker save | gzip (parts joined with cat, in this order); the archive's"
		echo "# size; the image's config digest (its ID in docker's classic image store) and manifest digest (its ID with the"
		echo "# containerd image store)."
		echo "# image  files  size  config  manifest"
	} >"$stage/IMAGES.txt"
	for k in "${!sel[@]}"; do
		img=${images[${sel[$k]}]} f="${file[$k]}"
		echo "${img} -> ${f} ($(human "${size[$k]}"), ${mode[$k]})"
		if [[ "${mode[$k]}" == split ]]; then
			# one pass: tee into sha256sum (the whole archive, checked against SHA256SUMS below) and into split, whose
			# filter writes each part and prints its checksum
			rm -f "$tmp/fifo"; mkfifo "$tmp/fifo"
			sha256sum <"$tmp/fifo" >"$tmp/whole" &
			hash_pid=$!
			(cd "$stage" && tee "$tmp/fifo" <"${src[$k]}" |
				split -b "$split_bytes" -d -a 2 --filter='tee "$FILE" | sha256sum | sed "s|-\$|$FILE|"' - "${f}.part-") \
				>>"$tmp/sums" || die "splitting ${src[$k]#"${top}"/} failed"
			wait "$hash_pid"
			whole=$(cut -d' ' -f1 "$tmp/whole")
			mapfile -t plist < <(cd "$stage" && printf '%s\n' "${f}".part-*)
			got=$(cd "$stage" && cat "${plist[@]}" | wc -c)
			((got == size[k])) || die "${f}: the parts hold ${got} bytes, the archive ${size[$k]}"
			echo "${whole}  ${f}" >>"$tmp/joined"
		else
			if [[ "${mode[$k]}" == link ]]; then ln "${src[$k]}" "$stage/$f"; else cp "${src[$k]}" "$stage/$f"; fi
			whole=$(sha256sum "$stage/$f" | cut -d' ' -f1)
			plist=("$f")
			echo "${whole}  ${f}" >>"$tmp/sums"
		fi
		[[ "$whole" == "${sum[$k]}" ]] || die "checksum mismatch: ${src[$k]#"${top}"/} is not what its SHA256SUMS lists"
		# the digests, from the archive's manifest.json / index.json (read through, not loaded)
		meta="$tmp/meta"; rm -rf "$meta"; mkdir -p "$meta"
		(cd "$stage" && cat "${plist[@]}") | "$unzip" -dc | tar -xf - -C "$meta" manifest.json index.json 2>/dev/null || true
		[[ -f "$meta/manifest.json" ]] || die "${f}: no manifest.json in the archive (not a docker save archive?)"
		read -r cfg man tags < <(digests "$meta")
		[[ "$cfg" == sha256:* ]] || die "${f}: cannot read its config digest from manifest.json"
		[[ ",${tags}," == *",${img},"* ]] || echo "  warning: the archive is tagged ${tags}, not ${img}" >&2
		list=$(IFS=,; echo "${plist[*]}")
		echo "${img}  ${list}  $(human "${size[$k]}")  ${cfg}  ${man}" >>"$stage/IMAGES.txt"
	done

	# the chart, packaged from a copy without __pycache__
	local chart_copy="$tmp/chart/coder-airgapped"; mkdir -p "$tmp/chart"; cp -r "$chart" "$chart_copy"
	find "$chart_copy" -name __pycache__ -type d -prune -exec rm -rf {} +
	helm package "$chart_copy" -d "$stage" >/dev/null 2>"$tmp/package.log" || { cat "$tmp/package.log" >&2; die "helm package failed"; }
	[[ -f "$stage/coder-airgapped-${version}.tgz" ]] || die "helm package wrote no coder-airgapped-${version}.tgz"
	# the one values file to start from (every input of the one-step install) and the high-availability overlay; the
	# prerequisites (Traefik, the Gateway API CRDs, CloudNativePG) are in the chart (global.bundled)
	cp "${bundle}/values.example.yaml" "${bundle}/values-ha.example.yaml" "$stage/"
	install -m 0755 "${templates}/push-images.sh" "$stage/push-images.sh"
	install -m 0755 "${templates}/pull-public-images.sh" "$stage/pull-public-images.sh"
	# the public images the chart runs: path under REGISTRY, the public image by digest (pull-public-images.sh)
	{
		echo "# coder-fork ${version}: the public images the chart runs (with high availability and its own prerequisites"
		echo "# too) - their path under your registry, and the public image by its tested digest. pull-public-images.sh"
		echo "# saves them into this folder on a connected machine; push-images.sh then pushes them with ours."
		((${#public[@]} == 0)) || printf '%s\n' "${public[@]}" | awk -F'\t' '{print $1 "  " $2}'
	} >"$stage/PUBLIC-IMAGES.txt"

	# INSTALL.md from its template
	local cnpg traefik line
	cnpg=$(awk '$1 ~ /\/cloudnative-pg:/ {print $1; exit}' "${bundle}/images.txt"); cnpg="operator ${cnpg##*:} (\`${cnpg:-?}\`)"
	traefik=$(awk '$1 ~ /\/traefik:/ {print $1; exit}' "${bundle}/images.txt"); traefik="Traefik ${traefik##*:} (\`${traefik:-?}\`)"
	while IFS= read -r line; do
		case "$line" in
		@PUBLIC_IMAGES@)
			((${#public[@]} == 0)) || printf '%s\n' "${public[@]}" | awk -F'\t' '{printf "| `$REGISTRY/%s` | `%s` |\n", $1, $2}' ;;
		*)
			line=${line//@VERSION@/$version}; line=${line//@CODER_VERSION@/$coder_version}
			line=${line//@IMAGE_COUNT@/${#sel[@]}}; line=${line//@IMAGES_SIZE@/$(human "$total")}
			line=${line//@CNPG@/$cnpg}; line=${line//@TRAEFIK@/$traefik}
			printf '%s\n' "$line" ;;
		esac
	done <"${templates}/INSTALL.md.in" >"$stage/INSTALL.md"

	# SHA256SUMS: every file (the images' from the pass above); SHA256SUMS.joined: the split archives as joined
	if [[ -s "$tmp/joined" ]]; then sort -k2,2 "$tmp/joined" >"$stage/SHA256SUMS.joined"; fi
	(cd "$stage" && find . -type f -printf '%P\n' | grep -vxF -f <(awk '{print $2}' "$tmp/sums") | sort |
		xargs -d '\n' sha256sum) >>"$tmp/sums"
	sort -k2,2 "$tmp/sums" >"$stage/SHA256SUMS"

	rm -rf "$out"; mv "$stage" "$out"; stage=""
	echo "wrote ${out}"
}

# ---------------------------------------------------------------------------------------------------------------------
report() { # REPORT TITLE LISTING TOOLS_IMAGE TRIVY_VERSION CACHE [VEX...]: CVE-REPORT.md; exit 1 when the gate fails
	python3 - "$@" <<'PY'
import collections, datetime, hashlib, json, os, re, sys
report, title, listing, tools, trivy_version, cache = sys.argv[1:7]
vex_files = sys.argv[7:]
SEV = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"]


def meta(path):
    try:
        return json.load(open(path))
    except (OSError, ValueError):
        return {}


def when(s):
    return (s[:16].replace("T", " ") + " UTC") if s else "?"


def counts(c):
    return "%d (%s)" % (sum(c.values()), "/".join(str(c[s]) for s in SEV))


def cell(s):
    return str(s or "").replace("|", "\\|").replace("\n", " ")


def key(target, v):
    return (target, v.get("PkgPath") or v.get("PkgName"), v.get("InstalledVersion"), v.get("VulnerabilityID"))


def finding(image, s, v, where, note=""):
    # an OS package's target is "<the archive as mounted> (<os>)": the OS is what tells
    where = re.sub(r"^/(release|join)/\S+ \((.*)\)$", r"\2", where)
    return (image, SEV.index(s) if s in SEV else 9, s, v.get("VulnerabilityID"), v.get("PkgName"),
            v.get("InstalledVersion"), v.get("FixedVersion"), v.get("PkgPath") or where, note)


rows, left, errors = [], [], []
for line in open(listing):
    image, path, status = line.rstrip("\n").split("\t")
    short = image.rsplit("/", 1)[-1]
    if status != "ok":
        errors.append(short)
        rows.append("| `%s` | scan failed (`%s`) | | | |" % (short, os.path.basename(path)[:-5] + ".log"))
        print("  %-58s scan FAILED" % short)
        continue
    d = json.load(open(path))
    every, fixable, after = collections.Counter(), collections.Counter(), collections.Counter()
    cleared, seen = 0, set()
    for r in d.get("Results") or []:
        target = r.get("Target", "")
        for v in r.get("Vulnerabilities") or []:
            k = key(target, v)
            if k in seen:
                continue
            seen.add(k)
            s = v.get("Severity", "UNKNOWN")
            every[s] += 1
            if v.get("FixedVersion"):
                fixable[s] += 1
                after[s] += 1
                left.append(finding(short, s, v, target))
        # the findings a VEX statement suppressed (trivy --show-suppressed); only not_affected clears the gate
        for m in r.get("ExperimentalModifiedFindings") or []:
            if m.get("Type") != "vulnerability":
                continue
            v = m.get("Finding") or {}
            k = key(target, v)
            if k in seen:
                continue
            seen.add(k)
            s = v.get("Severity", "UNKNOWN")
            every[s] += 1
            if not v.get("FixedVersion"):
                continue
            fixable[s] += 1
            if m.get("Status") == "not_affected":
                cleared += 1
            else:
                after[s] += 1
                left.append(finding(short, s, v, target, "VEX: %s" % m.get("Status")))
    rows.append("| `%s` | %s | %s | %d | %s |" % (short, counts(every), counts(fixable), cleared, counts(after)))
    print("  %-58s all %-20s fixable %-20s VEX %-4d left %s" % (short, counts(every), counts(fixable), cleared, counts(after)))

db, jdb = meta(os.path.join(cache, "db", "metadata.json")), meta(os.path.join(cache, "java-db", "metadata.json"))
failed = bool(left or errors)
out = ["# CVE report: %s" % title, ""]
if failed:
    why = []
    if left:
        why.append("%d finding(s) with a fixed version that no VEX declares not_affected" % len(left))
    if errors:
        why.append("%d image(s) not scanned" % len(errors))
    out.append("**FAIL** – " + "; ".join(why) + ".")
else:
    out.append("**PASS** – no finding with a fixed version is left (after VEX).")
out += ["",
        "Scanned %s with trivy %s (`%s`): vulnerabilities in OS and language packages, offline."
        % (datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), trivy_version, tools),
        "",
        "- Vulnerability DB: updated %s, downloaded %s" % (when(db.get("UpdatedAt")), when(db.get("DownloadedAt"))),
        "- Java DB: updated %s, downloaded %s" % (when(jdb.get("UpdatedAt")), when(jdb.get("DownloadedAt")))]
if vex_files:
    for f in vex_files:
        try:
            n = len(json.load(open(f)).get("statements") or [])
            n = ", %d statement(s)" % n if n else ""
        except (OSError, ValueError, AttributeError):
            n = ""
        out.append("- VEX: `%s` (sha256 %s%s)" % (os.path.basename(f), hashlib.sha256(open(f, "rb").read()).hexdigest()[:16], n))
else:
    out.append("- VEX: none")
out += ["",
        "## Per image",
        "",
        "Counts: total (CRITICAL/HIGH/MEDIUM/LOW/UNKNOWN). *Fixable*: the finding has a fixed version. *VEX*: fixable "
        "findings a VEX file declares not_affected. *Left*: fixable findings after VEX – the gate wants none.",
        "",
        "| Image | All | Fixable | VEX | Left |",
        "|---|---|---|---:|---|"] + rows
if left:
    out += ["", "## Fixable findings left", "",
            "| Image | Severity | Vulnerability | Package | Installed | Fixed in | Where |",
            "|---|---|---|---|---|---|---|"]
    for (image, _, s, vid, pkg, inst, fixed, where, note) in sorted(left):
        out.append("| `%s` | %s | %s | %s | %s | %s | %s |" % (
            cell(image), s, cell(vid), cell(pkg), cell(inst), cell(fixed), cell(where) + (" (%s)" % note if note else "")))
open(report, "w").write("\n".join(out) + "\n")
print("CVE gate: %s (%d fixable finding(s) left%s)" % ("FAIL" if failed else "PASS", len(left),
      ", %d image(s) not scanned" % len(errors) if errors else ""))
sys.exit(1 if failed else 0)
PY
}

gate=0
scan_release() { # DIR: the CVE gate; sets gate=1 when it fails
	local dir="$1" db="$trivy_cache"
	[[ -f "$dir/IMAGES.txt" ]] || die "$dir has no IMAGES.txt: not a release folder"
	command -v docker >/dev/null || die "docker not found"
	docker image inspect "$tools_image" >/dev/null 2>&1 ||
		die "$tools_image is not in this docker (development/tools/build-image-tools.sh builds it; TOOLS_IMAGE picks another)"
	local tv="${tools_image##*:}"
	if [[ "$tv" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$(printf '%s\n' 1.1.0 "$tv" | sort -V | head -n1)" != 1.1.0 ]]; then
		die "$tools_image: 1.1.0 or newer needed"
	fi
	mkdir -p "$db"
	local -a run=(docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp)
	if ((db_update)); then
		echo "trivy: updating the vulnerability DB and Java DB in ${db} (network; about 3 GB the first time)"
		local w
		for w in --download-db-only --download-java-db-only; do
			"${run[@]}" -e TRIVY_SKIP_DB_UPDATE=false -e TRIVY_SKIP_JAVA_DB_UPDATE=false -e TRIVY_OFFLINE_SCAN=false \
				-v "${db}:/cache" --entrypoint trivy "$tools_image" image "$w" --cache-dir /cache --no-progress \
				--skip-version-check --disable-telemetry </dev/null >/dev/null || die "trivy image $w failed"
		done
	fi
	[[ -f "$db/db/trivy.db" && -f "$db/db/metadata.json" ]] || die "no vulnerability DB in ${db}/db (run without --no-db-update)"
	[[ -f "$db/java-db/trivy-java.db" && -f "$db/java-db/metadata.json" ]] || die "no Java DB in ${db}/java-db (run without --no-db-update)"
	local trivy_version
	trivy_version=$(docker run --rm --network none --entrypoint trivy "$tools_image" --version --format json </dev/null |
		python3 -c 'import json, sys; print(json.load(sys.stdin)["Version"])')

	# the VEX files, mounted read-only
	local -a vex_args=() vex_mounts=()
	local k
	for k in "${!vex[@]}"; do
		vex_mounts+=(-v "$(realpath "${vex[$k]}"):/vex/${k}-$(basename "${vex[$k]}"):ro")
		vex_args+=(--vex "/vex/${k}-$(basename "${vex[$k]}")")
	done
	local json="${dir}.scan"; rm -rf "$json"; mkdir -p "$json"
	: >"$tmp/scanned"
	local img fs input base status need
	local -a mounts parts
	while read -r img fs _; do
		[[ -z "$img" || "$img" == \#* ]] && continue
		wanted "$(name_of "$img")" || continue
		mounts=(-v "${dir}:/release:ro")
		IFS=, read -r -a parts <<<"$fs"
		base=$(basename "${parts[0]%.part-*}" .tar.gz)
		if ((${#parts[@]} == 1)); then
			input="/release/${parts[0]}"
		else
			# trivy needs the whole archive: joined into a temporary file in the cache, removed after
			need=$(cd "$dir" && cat "${parts[@]}" | wc -c)
			(($(free_bytes "$db") > need + 1073741824)) || die "not enough room in ${db} to join ${base} ($(human "$need"))"
			join_dir="${db}/join.$$"; mkdir -p "$join_dir"
			(cd "$dir" && cat "${parts[@]}") >"${join_dir}/${base}.tar.gz"
			mounts+=(-v "${join_dir}:/join:ro"); input="/join/${base}.tar.gz"
		fi
		echo "scanning ${img} ..."
		status=ok
		"${run[@]}" --network none "${mounts[@]}" "${vex_mounts[@]}" -v "${db}:/cache:ro" --entrypoint trivy "$tools_image" \
			image --input "$input" --cache-dir /cache --cache-backend memory --scanners vuln --skip-db-update \
			--skip-java-db-update --offline-scan --skip-version-check --disable-telemetry --no-progress --timeout 60m \
			--format json --show-suppressed "${vex_args[@]}" </dev/null >"${json}/${base}.json" 2>"${json}/${base}.log" || status=error
		[[ "$status" == ok ]] || { echo "  trivy failed (${json}/${base}.log):" >&2; tail -n 5 "${json}/${base}.log" >&2; }
		if [[ -n "$join_dir" ]]; then rm -rf "$join_dir"; join_dir=""; fi
		printf '%s\t%s\t%s\n' "$img" "${json}/${base}.json" "$status" >>"$tmp/scanned"
	done <"$dir/IMAGES.txt"
	[[ -s "$tmp/scanned" ]] || die "no image to scan in $dir${ONLY:+ (ONLY=${ONLY})}"

	report "$dir/CVE-REPORT.md" "$(basename "$dir")" "$tmp/scanned" "$tools_image" "$trivy_version" "$db" "${vex[@]}" || gate=1
	[[ -f "$dir/CVE-REPORT.md" ]] || die "no CVE-REPORT.md written"
	echo "wrote ${dir}/CVE-REPORT.md (trivy's JSON reports: ${json}/)"
	[[ ! -f "$dir/SHA256SUMS" ]] || sums_line "$dir" CVE-REPORT.md
}

# ---------------------------------------------------------------------------------------------------------------------
if ((build)); then
	build_release
	((!plan)) || exit 0
fi
if ((scan)); then
	[[ -d "$out" ]] || die "no release folder at $out"
	scan_release "$out"
fi
if [[ -d "$out" ]]; then
	echo "${out}:"
	(cd "$out" && find . -type f -printf '%P\t%s\n' | sort | while IFS=$'\t' read -r f s; do printf '  %-66s %10s\n' "$f" "$(human "$s")"; done)
fi
((!gate)) || echo "CVE gate FAILED: ${out}/CVE-REPORT.md" >&2
exit "$gate"
