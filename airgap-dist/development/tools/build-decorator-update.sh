#!/usr/bin/env bash
# Builds dist/coder-airgapped-<version>-decorator-update.tar.gz (and its .sha256): the update of an Argo CD decorator
# install (Coder and the customization layer, two charts in one Application, from your registry) to this release,
# without the full bundle. It carries only what such an install needs to move on:
#   images/   the fork's Coder image (the -airgap one the base chart runs while the layer decorates it)
#   charts/   coder-airgapped-base and coder-airgapped-layer of this version
#   update-application.sh   (helm-chart/argocd/) pushes both to your registry and updates your Application
#   coder-decorated-application.yaml, coder-plain-application.yaml   this version's, to compare with yours
#   README.txt, SHA256SUMS
# Not the third-party charts and images, the workspace image or the ubuntu-dataflow template's image (Apache NiFi and
# Airflow): those are the cluster's already, and the helper keeps the dataflow template off unless it is given its
# image. The README lists the images that changed since the release the cluster runs (--since; default: the newest
# release tag before this version).
#   ./build-decorator-update.sh [--since VERSION]
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; top="$(cd "${here}/../.." && pwd)"
bundle="${top}/helm-chart"; chart="${bundle}/coder-airgapped"; dist="${top}/dist"
version=$(sed -n 's/^version: *//p' "${chart}/Chart.yaml"); name="coder-airgapped-${version}-decorator-update"
since=""
while (($#)); do
	case "$1" in
	--since) since="${2:?--since VERSION}"; shift ;;
	*) echo "unknown option: $1" >&2; exit 2 ;;
	esac
	shift
done
if [[ -z "$since" ]]; then # the newest release before this one
	since=$(git -C "$top" tag -l 'v*' --sort=-v:refname | sed 's/^v//' |
		while read -r t; do [[ "$t" != "$version" && "$(printf '%s\n%s\n' "$t" "$version" | sort -V | tail -n1)" == "$version" ]] && { echo "$t"; break; }; done)
fi

fork=$(awk '!/^#/ && $1 ~ /\/coder-platform:.*-airgap$/ {print $1; exit}' "${bundle}/images.txt")
[[ -n "$fork" ]] || { echo "ERROR: no coder-platform -airgap image in images.txt" >&2; exit 1; }
archive="${bundle}/$("${bundle}/mirror-images.sh" path "$fork")"
[[ -f "$archive" ]] || { echo "ERROR: ${archive} is missing: run tools/build-airgap-image.sh" >&2; exit 1; }

staging="${dist}/.decorator-${version}"; rm -rf "$staging"; out="${staging}/${name}"
mkdir -p "${out}/charts" "${out}/images"
"${bundle}/mirror-images.sh" decorator-charts "${out}/charts" | sed "s|^${out}/|packaged |"
ln "$archive" "${out}/images/" 2>/dev/null || cp "$archive" "${out}/images/"
install -m 0755 "${bundle}/argocd/update-application.sh" "${out}/update-application.sh"
cp "${bundle}/argocd/coder-decorated-application.yaml" "${bundle}/argocd/coder-plain-application.yaml" "$out/"

# What changed since the release the cluster runs: images.txt then and now.
changed=""
if [[ -n "$since" ]] && git -C "$top" rev-parse -q --verify "v${since}" >/dev/null; then
	changed=$(diff <(git -C "$top" show "v${since}:helm-chart/images.txt" | awk '!/^#/ && NF >= 2 {print $1, $2}' | sort) \
		<(awk '!/^#/ && NF >= 2 {print $1, $2}' "${bundle}/images.txt" | sort) | sed -n 's/^> /    /p' | awk '{print $1}' || true)
fi
fork_tag=${fork##*:}
# The ubuntu-dataflow template's image (coder-workspace.dataflowImage), and the one the release the cluster runs had.
dataflow=$(sed -n 's/^  dataflowImage:.*"\([^"]*\)".*/\1/p' "${chart}/values.yaml" | head -n1)
[[ -n "$dataflow" ]] || { echo "ERROR: no coder-workspace.dataflowImage in ${chart}/values.yaml" >&2; exit 1; }
dataflow_then=""
if [[ -n "$since" ]] && git -C "$top" rev-parse -q --verify "v${since}" >/dev/null; then
	dataflow_then=$(git -C "$top" show "v${since}:helm-chart/coder-airgapped/values.yaml" |
		sed -n 's/^  dataflowImage:.*"\([^"]*\)".*/\1/p' | head -n1)
fi
dataflow_note=""
if [[ -n "$dataflow_then" && "$dataflow_then" != "$dataflow" ]]; then
	dataflow_note="
${since} had ${dataflow_then}: \"--dataflow keep\" needs this release's in your registry (in the full
bundle's or the layer's images/workspaces/: docker load, tag, push), or \"--dataflow <registry>/${dataflow_then#*/}\"
keeps the earlier one (the release notes say whether this release's template runs on it)."
fi
cat >"${out}/README.txt" <<EOF
coder-airgapped ${version}: the decorator update
=================================================

The update of an Argo CD decorator install (Coder and the customization layer: the charts coder-airgapped-base and
coder-airgapped-layer in one Argo CD Application, pulled from your registry) to ${version}${since:+, from ${since}}. Only
the fork's Coder image and the two charts: everything else the install uses is in your registry already.

  images/$(basename "$archive")
                      the fork's Coder image ${fork}
  charts/coder-airgapped-base-${version}.tgz, charts/coder-airgapped-layer-${version}.tgz
  update-application.sh   pushes them and updates your Application (./update-application.sh --help)
  coder-decorated-application.yaml, coder-plain-application.yaml   ${version}'s, to compare with yours
  SHA256SUMS

Images that changed since ${since:-the previous release}:
${changed:-    (none listed)}
This update carries Coder's. The ubuntu-dataflow template (DATAFLOW: Apache NiFi and Apache Airflow in the
workspace) runs on ${dataflow}, which is not in it: the helper turns that template off
(coder-workspace.dataflowTemplate.enabled: false) unless you give it the image (--dataflow).${dataflow_note}

Install
-------
On a machine with docker, helm and kubectl (kubectl pointed at the cluster where Argo CD runs; docker and helm logged
in to your registry, as for the install - with its CA if it has a private one), and the Application file you applied
(coder-decorated-application.yaml, or the one ./make --argocd wrote in .deploy/argocd-<domain>/):

  sha256sum -c ${name}.tar.gz.sha256
  tar -xzf ${name}.tar.gz && cd ${name}
  ./update-application.sh --app /path/to/your-application.yaml --dry-run      # what it would change
  ./update-application.sh --app /path/to/your-application.yaml --push --apply

  --push      docker load + push ${fork} to <registry>/user187x/coder-platform:${fork_tag}
              (registry = global.registry in your file, or --registry <harbor>/<project>), and helm push both
              charts to the Application's chart repository (its repoURL)
  --apply     sets both sources' targetRevision to ${version} (and the dataflow template off), keeps your file as
              <file>.<time>.bak, kubectl apply -f <file>, and asks Argo CD to refresh
  --dataflow keep | <image>   keep DATAFLOW on: its image is in your registry already
              (<registry>/${dataflow#*/}), or runs from <image>

Argo CD then syncs: Coder restarts on ${fork_tag} (the new pod first, no gap), the layer's
services update, and the template pushes run (new template versions; workspaces show "Update" once they are older).

  kubectl -n argocd get application coder -w        Synced, Healthy
  kubectl -n coder rollout status deploy/coder
  kubectl -n coder get deploy coder -o jsonpath='{.spec.template.spec.containers[0].image}'

Back to the previous release: restore the .bak file and kubectl apply -f it (the earlier charts and image are still
in your registry).
EOF

(cd "$out" && find . -type f ! -name SHA256SUMS -printf '%P\n' | sort | xargs sha256sum >SHA256SUMS)
mkdir -p "$dist"
tar -C "$staging" -czf "${dist}/${name}.tar.gz.part" "$name"
mv "${dist}/${name}.tar.gz.part" "${dist}/${name}.tar.gz"
(cd "$dist" && sha256sum "${name}.tar.gz" >"${name}.tar.gz.sha256")
rm -rf "$staging"
echo "wrote dist/${name}.tar.gz ($(du -h "${dist}/${name}.tar.gz" | cut -f1)), from ${since:-?}: ${fork}, charts ${version}"
