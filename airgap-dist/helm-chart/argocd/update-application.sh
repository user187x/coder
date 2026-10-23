#!/usr/bin/env bash
# Updates an Argo CD decorator install - the Application you applied from coder-decorated-application.yaml (or that
# ./make --argocd wrote) - to this release, without the full bundle:
#
#   1. checks the files it uses (SHA256SUMS);
#   2. --push: loads the fork's Coder image and pushes it to your registry, and pushes both charts
#      (coder-airgapped-base and coder-airgapped-layer) to the Application's chart repository (docker and helm must be
#      logged in to it, as for the install; a private CA as then);
#   3. points the Application's two sources at this release's charts (targetRevision), and turns the ubuntu-dataflow
#      template off unless its image is in the registry (--dataflow);
#   4. shows the change (the file is kept as FILE.<time>.bak);
#   5. --apply: kubectl apply -f FILE, and asks Argo CD to refresh the Application.
#
#   ./update-application.sh --app FILE [--push] [--apply] [--registry R] [--dataflow off|keep|IMAGE] [--dry-run]
#
#   --app FILE         the Application file you applied (both documents, the repository Secret and the Application)
#   --push             push the image and the charts first (the registry: --registry, else global.registry in FILE)
#   --registry R       <harbor>/<project>: where the images are (default: global.registry in FILE)
#   --dataflow off     the ubuntu-dataflow template (Apache NiFi and Apache Airflow) stays off (the default: this update
#                      does not carry its image, ghcr.io/user187x/coder-workspace-dataflow:<tag>, the layer chart's)
#   --dataflow keep    it is on: the layer chart's image is in the registry already
#                      (<registry>/user187x/coder-workspace-dataflow:<tag>; the helper says which)
#   --dataflow IMAGE   it is on, on this image (a full reference)
#   --apply            apply FILE and refresh the Application in Argo CD (kubectl pointed at Argo CD's cluster)
#   --dry-run          show what would change; push, write and apply nothing
#
# Where it looks for what it installs: next to it (charts/, images/: the decorator update), or the full bundle's
# charts/ and images/ui/. Needs bash, python3 (no modules), sha256sum; docker and helm for --push; kubectl
# for --apply. HELM_PUSH_ARGS: more arguments for helm push (a private CA helm does not trust: "--ca-file ca.crt").
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
say() { printf '\033[1;34m==> %s\033[0m\n' "$*"; }

app="" push=0 apply=0 registry="" dataflow=off dry=0
while (($#)); do
	case "$1" in
	--app) app="${2:?--app FILE}"; shift ;;
	--push) push=1 ;;
	--apply) apply=1 ;;
	--registry) registry="${2:?--registry <harbor>/<project>}"; shift ;;
	--dataflow) dataflow="${2:?--dataflow off|keep|IMAGE}"; shift ;;
	--dry-run) dry=1 ;;
	-h | --help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
	*) die "unknown option: $1 (--help)" ;;
	esac
	shift
done
[[ -n "$app" ]] || die "--app FILE: the Argo CD Application file to update (--help)"
[[ -f "$app" ]] || die "no such file: $app"
command -v python3 >/dev/null || die "python3 is needed"

# ---- what this update carries
if [[ -d "${here}/charts" && -d "${here}/images" ]]; then # the decorator update
	charts="${here}/charts" images="${here}/images" sums="${here}/SHA256SUMS"
else # the full bundle (argocd/ next to images/)
	charts="${here}/../charts" images="${here}/../images/ui" sums=""
fi
base_chart=$(find "$charts" -maxdepth 1 -name 'coder-airgapped-base-*.tgz' 2>/dev/null | sort -V | tail -n1)
layer_chart=$(find "$charts" -maxdepth 1 -name 'coder-airgapped-layer-*.tgz' 2>/dev/null | sort -V | tail -n1)
[[ -n "$base_chart" && -n "$layer_chart" ]] || die "the two charts are not in ${charts} (coder-airgapped-{base,layer}-<version>.tgz)"
version=$(basename "$layer_chart" .tgz); version=${version#coder-airgapped-layer-}
[[ "$(basename "$base_chart")" == "coder-airgapped-base-${version}.tgz" ]] || die "the charts' versions differ: $(basename "$base_chart"), $(basename "$layer_chart")"
fork_archive=$(find "$images" -maxdepth 1 -name 'ghcr.io_user187x_coder-platform_*-airgap.tar.gz' 2>/dev/null | sort -V | tail -n1)
[[ -n "$fork_archive" ]] || die "the fork's Coder image archive is not in ${images}"
fork_image=$(basename "$fork_archive" .tar.gz)                       # ghcr.io_user187x_coder-platform_<tag>
fork_image="ghcr.io/user187x/coder-platform:${fork_image#ghcr.io_user187x_coder-platform_}"
say "This update: charts ${version}, Coder image ${fork_image}"
# The ubuntu-dataflow template's image, as the layer chart names it (coder-workspace.dataflowImage).
dataflow_image=$( (tar -xzOf "$layer_chart" coder-airgapped-layer/values.yaml 2>/dev/null || true) |
	sed -n 's/^  dataflowImage:.*"\([^"]*\)".*/\1/p' | head -n1)
echo "    its ubuntu-dataflow template's image: ${dataflow_image:-?}"

if [[ -n "$sums" && -f "$sums" ]]; then
	(cd "$here" && sha256sum --quiet -c SHA256SUMS) || die "a file of this update is damaged (SHA256SUMS)"
	echo "    files checked (SHA256SUMS)"
fi

# ---- the Application file: its registry, chart repository and name
read_app() { # KEY: registry | repo | name
	python3 - "$app" "$1" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
key = sys.argv[2]
pat = {
    "registry": r"^[ \t]+registry:[ \t]*([^\s#]+)",
    "repo": r"^[ \t]+-[ \t]+repoURL:[ \t]*([^\s#]+)",
    "name": r"^kind:[ \t]*Application\b[\s\S]*?^metadata:[ \t]*\n(?:[ \t]+.*\n)*?[ \t]+name:[ \t]*([^\s#]+)",
}[key]
m = re.search(pat, text, re.M)
print(m.group(1).strip("'\"") if m else "")
PY
}
registry=${registry:-$(read_app registry)}
repo=$(read_app repo)
name=$(read_app name)
[[ -n "$registry" ]] || die "no global.registry in ${app}: give --registry <harbor>/<project>"
[[ -n "$repo" ]] || die "no source repoURL in ${app}"
registry=${registry%/}
echo "    Application '${name:-?}', charts from ${repo}, images from ${registry}"

# The chart's image path in the registry (helpers: platform.image): its registry host replaced by global.registry.
in_registry() {
	local ref="$1" first="${1%%/*}"
	[[ "$ref" == */* && ("$first" == *.* || "$first" == *:* || "$first" == localhost) ]] && ref="${ref#*/}"
	echo "${registry}/${ref}"
}
fork_target=$(in_registry "$fork_image")
case "$dataflow" in
off) ;;
keep)
	[[ -n "$dataflow_image" ]] || die "--dataflow keep: no coder-workspace.dataflowImage in $(basename "$layer_chart"); give the image"
	dataflow=$(in_registry "$dataflow_image")
	;;
*) [[ "$dataflow" == */* || "$dataflow" == *:* ]] || die "--dataflow: off, keep or an image reference" ;;
esac

# ---- 2. push
if ((push)); then
	if ((dry)); then
		say "Would push ${fork_target} and both charts to oci://${repo}"
	else
		command -v docker >/dev/null || die "--push needs docker"
		command -v helm >/dev/null || die "--push needs helm"
		say "Pushing the Coder image: ${fork_target}"
		docker load -i "$fork_archive" | tail -n1
		docker tag "$fork_image" "$fork_target"
		docker push "$fork_target" | tail -n1
		for chart in "$base_chart" "$layer_chart"; do
			say "Pushing $(basename "$chart") to oci://${repo}"
			# shellcheck disable=SC2086 # HELM_PUSH_ARGS: extra words, e.g. "--ca-file ca.crt" or "--plain-http"
			helm push "$chart" "oci://${repo}" ${HELM_PUSH_ARGS:-} 2>&1 | tail -n2
		done
	fi
fi

# ---- 3. the Application: both sources at this version; the dataflow template
stamp=$(date +%Y%m%d-%H%M%S)
updated=$(mktemp); trap 'rm -f "$updated"' EXIT
python3 - "$app" "$updated" "$version" "$dataflow" <<'PY'
import re, sys

path, out, version, dataflow = sys.argv[1:5]
raw = open(path, newline="").read()
nl = "\r\n" if "\r\n" in raw else "\n"
lines = raw.replace("\r\n", "\n").split("\n")
# The optional templates: their switch, their image key, the choice (off, or the image), and the note on "off".
OPTIONAL = [("dataflowTemplate", "dataflowImage", dataflow,
             "  # ubuntu-dataflow (NiFi, Airflow): its image is not in the registry")]
try:  # where PyYAML is installed, the file is parsed before (and after) the change
    import yaml
except ImportError:
    yaml = None
if yaml:
    try:
        list(yaml.safe_load_all(raw))
    except yaml.YAMLError as e:
        sys.exit("%s is not valid YAML (%s): fix it first" % (path, " ".join(str(e).split())[:200]))


def indent(line):
    return len(line) - len(line.lstrip(" "))


def blank(line):
    return not line.strip() or line.lstrip().startswith("#")


def item_range(i):
    """The source (list item) holding line i: from its "- " line to the line before the next item or a key above."""
    start = i
    while start > 0 and not re.match(r"^\s*- ", lines[start]):
        start -= 1
    dash = indent(lines[start])
    end = i + 1
    while end < len(lines):
        line = lines[end]
        if not blank(line) and (indent(line) < dash or (indent(line) == dash and line.lstrip().startswith("- "))):
            break
        if line.startswith("---"):
            break
        end += 1
    return start, end


def block_end(i):
    """The line after the block of key line i (its more-indented lines)."""
    own = indent(lines[i])
    j = i + 1
    while j < len(lines) and (blank(lines[j]) or indent(lines[j]) > own):
        j += 1
    while j > i + 1 and blank(lines[j - 1]):  # trailing blank / comment lines belong to what follows
        j -= 1
    return j


def find_key(key, start, end, at):
    for k in range(start, end):
        if not blank(lines[k]) and indent(lines[k]) == at and re.match(r"^\s*%s:(\s|$)" % re.escape(key), lines[k]):
            return k
    return None


def set_value(k, value):
    m = re.match(r"^(\s*[^:]+:\s*)([^#]*?)(\s*#.*)?$", lines[k])
    lines[k] = m.group(1) + value + (m.group(3) or "")


changes = []
for chart in ("coder-airgapped-base", "coder-airgapped-layer"):
    hits = [i for i, l in enumerate(lines) if re.match(r"^\s*(- )?chart:\s*%s\s*(#.*)?$" % chart, l)]
    if len(hits) != 1:
        sys.exit("expected one source with chart: %s, found %d" % (chart, len(hits)))
    start, end = item_range(hits[0])
    at = indent(lines[hits[0]]) + (2 if lines[hits[0]].lstrip().startswith("- ") else 0)
    k = find_key("targetRevision", start, end, at)
    if k is None:
        sys.exit("no targetRevision in the %s source" % chart)
    old = re.sub(r"\s*#.*$", "", lines[k].split(":", 1)[1]).strip().strip("'\"")
    set_value(k, version)
    changes.append("%s %s -> %s" % (chart, old or "?", version))
    if chart != "coder-airgapped-layer":
        continue
    # The layer's values: coder-workspace.dataflowTemplate.enabled (and its image).
    v = find_key("valuesObject", start, end, at + 2) or find_key("valuesObject", start, end, at + 4)
    if v is None:
        sys.exit("no helm.valuesObject in the coder-airgapped-layer source")
    def child_indent(k, fallback):
        """The indentation of key line k's children (the file's own step), else fallback."""
        for j in range(k + 1, len(lines)):
            if not blank(lines[j]):
                return indent(lines[j]) if indent(lines[j]) > indent(lines[k]) else fallback
        return fallback

    step = max(2, child_indent(v, indent(lines[v]) + 2) - indent(lines[v]))
    vi = indent(lines[v]) + step
    cw = find_key("coder-workspace", v + 1, block_end(v), vi)
    if cw is None:
        at_end = block_end(v)
        lines[at_end:at_end] = [" " * vi + "coder-workspace:"]
        cw = at_end
    cwi = child_indent(cw, vi + step)
    for switch, image_key, choice, NOTE in OPTIONAL:
        dt = find_key(switch, cw + 1, block_end(cw), cwi)
        if dt is None:
            lines[cw + 1:cw + 1] = [" " * cwi + switch + ":"]
            dt = cw + 1
        eni = child_indent(dt, cwi + step)
        en = find_key("enabled", dt + 1, block_end(dt), eni)
        on = "false" if choice == "off" else "true"
        note = NOTE if choice == "off" else ""
        if en is None:
            lines[dt + 1:dt + 1] = [" " * eni + "enabled: " + on + note]
        else:
            set_value(en, on)
            # This helper's own note goes with "off" only.
            bare = lines[en].replace(NOTE, "").rstrip()
            lines[en] = bare + (note if "#" not in bare else "")
        changes.append("coder-workspace.%s.enabled: %s" % (switch, on))
        if choice != "off":
            di = find_key(image_key, cw + 1, block_end(cw), cwi)
            if di is None:
                e = block_end(cw)
                lines[e:e] = [" " * cwi + image_key + ": " + choice]
            else:
                set_value(di, choice)
            changes.append("coder-workspace.%s: %s" % (image_key, choice))

open(out, "w", newline="").write(nl.join(lines))
for c in changes:
    print("    " + c)

# Read back as YAML where PyYAML is installed: the file must still parse, with these values.
if not yaml:
    print("    (PyYAML is not installed: the result is not parsed back; kubectl apply checks it)")
    sys.exit(0)
try:
    docs = [d for d in yaml.safe_load_all(open(out)) if d]
    appdoc = next(d for d in docs if d.get("kind") == "Application")
    by_chart = {s.get("chart"): s for s in appdoc["spec"]["sources"]}
    layer_values = by_chart["coder-airgapped-layer"]["helm"]["valuesObject"]
    ok = (
        str(by_chart["coder-airgapped-base"]["targetRevision"]) == version
        and str(by_chart["coder-airgapped-layer"]["targetRevision"]) == version
        and layer_values["coder-workspace"]["dataflowTemplate"]["enabled"] is (dataflow != "off")
        and "global" in layer_values
    )
except (yaml.YAMLError, KeyError, StopIteration, TypeError) as e:
    sys.exit("the updated file does not read back as expected (%s): nothing written" % " ".join(str(e).split())[:200])
if not ok:
    sys.exit("the updated file does not read back as expected: nothing written")
print("    parsed back: OK")
PY

say "The change to ${app}"
diff -u "$app" "$updated" --label "${app} (now)" --label "${app} (${version})" || true
if ((dry)); then
	say "Dry run: nothing written"
	exit 0
fi
cp -p "$app" "${app}.${stamp}.bak"
cat "$updated" >"$app"
echo "    written (the previous file: ${app}.${stamp}.bak)"

# ---- 5. apply
if ((apply)); then
	command -v kubectl >/dev/null || die "--apply needs kubectl"
	say "Applying ${app}"
	kubectl apply -f "$app"
	ns=$(python3 -c 'import re,sys; m=re.search(r"^kind:[ \t]*Application\b[\s\S]*?\n[ \t]+namespace:[ \t]*(\S+)", open(sys.argv[1]).read(), re.M); print(m.group(1) if m else "argocd")' "$app")
	kubectl -n "$ns" annotate application "$name" argocd.argoproj.io/refresh=normal --overwrite >/dev/null
	say "Argo CD syncs it now; follow it with:"
	echo "    kubectl -n ${ns} get application ${name} -w      (Synced, Healthy)"
	echo "    kubectl -n coder rollout status deploy/coder     (Coder on ${fork_image##*:})"
else
	say "Next: kubectl apply -f ${app}   (or run again with --apply)"
fi
