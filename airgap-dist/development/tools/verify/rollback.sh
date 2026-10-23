#!/usr/bin/env bash
# Rollback test on a copy of a deployment's database: does pure upstream Coder (the rollback image, the fork's base)
# run on it, see everything the fork sees, and can the fork run on it again afterwards? Nothing touches the
# deployment: its database is copied (pg_dump) into a throwaway PostgreSQL, the servers run in docker on this machine
# with no provisioners (nothing builds) and no OIDC, and the copy is deleted at the end.
#   ./rollback.sh [--context CTX] [--namespace coder] [--db-pod coder-db-1] [--database app]
#                 [--email admin@admin.com --password admin] [--jsonl out.jsonl]
# Images (from the bundle, loaded if needed): the rollback image and the fork's, from images.txt.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; bundle="$(cd "$here/../../../helm-chart" && pwd)"
ctx=""; ns=coder; pod=coder-db-1; db=app; email=admin@admin.com; password=admin; jsonl=""
while (($#)); do case "$1" in
	--context) ctx="--context=$2"; shift ;; --namespace) ns=$2; shift ;; --db-pod) pod=$2; shift ;;
	--database) db=$2; shift ;; --email) email=$2; shift ;; --password) password=$2; shift ;; --jsonl) jsonl=$2; shift ;;
	*) echo "unknown option $1" >&2; exit 2 ;; esac; shift; done
record() { # name ok detail
	printf '%s [rollback] %s%s\n' "$([[ $2 == true ]] && echo PASS || echo FAIL)" "$1" "${3:+ - $3}"
	[[ -z "$jsonl" ]] || python3 -c 'import json,sys; print(json.dumps({"suite":"rollback","name":sys.argv[1],"ok":sys.argv[2]=="true","detail":sys.argv[3][:600],"seconds":None}))' "$1" "$2" "${3:-}" >>"$jsonl"
}
img() { awk -v p="$1" '$1 ~ p {print $1; exit}' "$bundle/images.txt"; }
UP=$(img '^ghcr.io/user187x/coder-upstream:'); FORK=$(img '^ghcr.io/user187x/coder-platform:'); PG=$(img '^ghcr.io/cloudnative-pg/postgresql:18')
for i in "$UP" "$FORK" "$PG"; do
	docker image inspect "$i" >/dev/null 2>&1 || docker load -q -i "$(find "$bundle/images" -name "$(echo "$i" | tr '/:@' '___').tar.gz" | head -1)" >/dev/null
done
work=$(mktemp -d); chmod 700 "$work"
cleanup() { docker rm -f rb-pg rb-coder >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

echo "copying the database ($ns/$pod, $db)"
kubectl $ctx -n "$ns" exec "$pod" -c postgres -- pg_dump -U postgres -d "$db" -Fc >"$work/db.dump"
docker run -d --name rb-pg -p 127.0.0.1:55432:5432 --entrypoint bash "$PG" -c \
	'initdb -D /tmp/d -U postgres --auth-local=trust --auth-host=md5 >/dev/null && echo "host all all 0.0.0.0/0 md5" >>/tmp/d/pg_hba.conf && exec postgres -D /tmp/d -c listen_addresses="*"' >/dev/null
for _ in $(seq 30); do docker exec rb-pg pg_isready -q 2>/dev/null && break; sleep 1; done
docker exec rb-pg psql -q -U postgres -c "create role app login password 'app'"
docker exec rb-pg psql -q -U postgres -c "create database app owner app"
docker exec -i rb-pg pg_restore -U postgres -d app --no-owner --role=app <"$work/db.dump"
schema=$(docker exec rb-pg psql -U postgres -d app -tAc "select max(version) from schema_migrations")
record "database copied (schema version $schema)" true

serve() { # image -> facts JSON on stdout
	docker rm -f rb-coder >/dev/null 2>&1 || true
	docker run -d --name rb-coder --network host -e CODER_PG_CONNECTION_URL="postgres://app:app@127.0.0.1:55432/app?sslmode=disable" \
		-e CODER_HTTP_ADDRESS=127.0.0.1:37190 -e CODER_ACCESS_URL=http://127.0.0.1:37190 -e CODER_PROVISIONER_DAEMONS=0 \
		-e CODER_TELEMETRY_ENABLE=false -e CODER_UPDATE_CHECK=false --entrypoint /opt/coder "$1" server >/dev/null
	for _ in $(seq 120); do curl -sf http://127.0.0.1:37190/healthz >/dev/null 2>&1 && break; sleep 2; done
	if ! curl -sf http://127.0.0.1:37190/healthz >/dev/null 2>&1; then docker logs rb-coder 2>&1 | tail -5 >&2; return 1; fi
	python3 "$here/rollback_probe.py" http://127.0.0.1:37190 "$email" "$password"
	docker stop -t 30 rb-coder >/dev/null
}
fork1=$(serve "$FORK") && record "the fork runs on the copy" true || record "the fork runs on the copy" false
up=$(serve "$UP") && record "upstream Coder (rollback image) starts on the fork's database" true "$UP" || {
	record "upstream Coder (rollback image) starts on the fork's database" false "$UP"; exit 1; }
cmp() { python3 - "$1" "$2" <<'EOF'
import json, sys
a, b = json.loads(sys.argv[1]), json.loads(sys.argv[2])
diff = [k for k in a if k != "version" and a[k] != b.get(k)]
print(",".join(diff))
EOF
}
d=$(cmp "$fork1" "$up"); [[ -z "$d" ]] && record "upstream sees what the fork sees (users, templates and versions, workspaces, builds, apps, SSH keys)" true || record "upstream sees what the fork sees" false "differs: $d"
[[ $(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["signIn"])' "$up") == 201 ]] && record "password sign-in on upstream" true || record "password sign-in on upstream" false
schema2=$(docker exec rb-pg psql -U postgres -d app -tAc "select max(version) from schema_migrations")
[[ "$schema2" == "$schema" ]] && record "upstream left the schema as it was ($schema2)" true || record "upstream changed the schema" false "$schema -> $schema2"
fork2=$(serve "$FORK") && d=$(cmp "$fork1" "$fork2") && [[ -z "$d" ]] && record "roll forward: the fork runs again and sees the same" true || record "roll forward" false "${d:-}"
echo "the copy is deleted"
