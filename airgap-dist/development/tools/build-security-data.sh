#!/usr/bin/env bash
# Makes a security data file for an air-gapped cluster: the image builder grades images with it once an admin uploads
# it in Templates > Images > Settings > Security data. Run on a machine with internet access and Docker:
#   ./build-security-data.sh [--no-java] [--fips-rules FILE] [--out DIR]
# It holds:
#   - trivy's vulnerability database and (unless --no-java) its Java database, downloaded now by the same trivy as
#     the bundle's (the coder-image-tools image), so their schema matches;
#   - the FIPS rules (helm-chart/coder-airgapped/files/ui-updates/fips-rules.json, or --fips-rules), checked;
#   - manifest.json: when it was made, the trivy version, every file's sha256 (the service checks them on upload).
# Writes <out>/coder-security-data-<UTC date>.tar.gz (default out: dist/) and its .sha256. Carry it across the air
# gap and upload it. trivy publishes a new vulnerability database every 6 hours; the dashboard warns after 14 days.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; top="$(cd "${here}/../.." && pwd)"
image="ghcr.io/user187x/coder-image-tools:1.2.0"
rules="${top}/helm-chart/coder-airgapped/files/ui-updates/fips-rules.json"
out="${top}/dist"; java=1
while (($#)); do
	case "$1" in
	--no-java) java=0 ;;
	--fips-rules) rules="$2"; shift ;;
	--out) out="$2"; shift ;;
	*) echo "usage: $0 [--no-java] [--fips-rules FILE] [--out DIR]" >&2; exit 2 ;;
	esac
	shift
done
docker image inspect "$image" >/dev/null 2>&1 ||
	docker load -q -i "${top}/helm-chart/$("${top}/helm-chart/mirror-images.sh" path "$image")"

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
mkdir -p "$work/cache" "$work/data/trivy"
trivy() { # the bundle's trivy, allowed to download this time
	docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e TRIVY_SKIP_DB_UPDATE=false \
		-e TRIVY_SKIP_JAVA_DB_UPDATE=false -e TRIVY_OFFLINE_SCAN=false -v "$work/cache:/cache" \
		--entrypoint trivy "$image" "$@"
}
version=$(trivy --version --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Version"])')
echo "trivy ${version}: downloading the vulnerability database"
trivy image --download-db-only --cache-dir /cache --no-progress >/dev/null
cp -r "$work/cache/db" "$work/data/trivy/db"
if ((java)); then
	echo "downloading the Java database"
	trivy image --download-java-db-only --cache-dir /cache --no-progress >/dev/null
	cp -r "$work/cache/java-db" "$work/data/trivy/java-db"
fi
cp "$rules" "$work/data/fips-rules.json"
python3 "${top}/helm-chart/coder-airgapped/files/ui-updates/securitydata.py" check-rules "$work/data/fips-rules.json" >/dev/null

python3 - "$work/data" "$version" <<'EOF'
import datetime, hashlib, json, os, sys
root, version = sys.argv[1], sys.argv[2]
files = {}
for dirpath, _, names in os.walk(root):
    for n in sorted(names):
        p = os.path.join(dirpath, n)
        rel = os.path.relpath(p, root)
        if rel in ("trivy/db/trivy.db", "trivy/db/metadata.json", "trivy/java-db/trivy-java.db",
                   "trivy/java-db/metadata.json", "fips-rules.json"):
            h = hashlib.sha256()
            with open(p, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            files[rel] = h.hexdigest()
        else:
            os.remove(p)
m = {"format": 1, "createdAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
     "trivy": {"version": version}, "files": files}
with open(os.path.join(root, "manifest.json"), "w") as f:
    json.dump(m, f, indent=2)
db = json.load(open(os.path.join(root, "trivy/db/metadata.json")))
print("vulnerability database of %s" % db.get("UpdatedAt"))
if "trivy/java-db/metadata.json" in files:
    print("Java database of %s" % json.load(open(os.path.join(root, "trivy/java-db/metadata.json"))).get("UpdatedAt"))
print("FIPS rules %s (%s)" % (json.load(open(os.path.join(root, "fips-rules.json")))["version"],
                              json.load(open(os.path.join(root, "fips-rules.json")))["published"]))
EOF

mkdir -p "$out"
name="coder-security-data-$(date -u +%Y%m%d-%H%M).tar.gz"
members=(manifest.json fips-rules.json trivy/db/trivy.db trivy/db/metadata.json)
((java)) && members+=(trivy/java-db/trivy-java.db trivy/java-db/metadata.json)
tar -C "$work/data" -I "$(command -v pigz || echo gzip)" -cf "${out}/${name}" --owner=0 --group=0 --numeric-owner "${members[@]}"
(cd "$out" && sha256sum "$name" >"${name}.sha256")
echo "wrote ${out}/${name} ($(du -h "${out}/${name}" | cut -f1)): upload it in Templates > Images > Settings > Security data"
