#!/usr/bin/env bash
# Runs a stdlib-only Python script (e.g. ../verify/live.py, ../verify/load.py) in a pod inside the air-gapped network,
# with the test CA at /ca/ca.crt, and streams its output. Files the script writes under /out are copied back to
# ./inpod-out/. Exit status: the script's.
#   ./inpod.sh SCRIPT [ARGS...]      e.g. ./inpod.sh ../verify/live.py --url https://coder.airgap.test --ca /ca/ca.crt
set -uo pipefail
W="$(cd "$(dirname "$0")" && pwd)"; export KUBECONFIG=$W/kubeconfig
script="$1"; shift; name="inpod-$(basename "$script" .py | tr '_' '-')"
kubectl -n default delete pod "$name" --ignore-not-found --wait=true >/dev/null 2>&1
kubectl -n default delete configmap "$name" --ignore-not-found >/dev/null
kubectl -n default create configmap "$name" --from-file=script.py="$script" --from-file=ca.crt="$W/pki/ca.crt" >/dev/null
args=$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@")
kubectl -n default apply -f - >/dev/null <<POD
apiVersion: v1
kind: Pod
metadata: {name: $name}
spec:
  restartPolicy: Never
  containers:
  - name: run
    image: localhost:5001/library/python:3.13-alpine
    command: [sh, -c, 'python3 -u /t/script.py "\$@"; c=\$?; touch /out/.done; sleep 60; exit \$c', --]
    args: $args
    volumeMounts:
    - {name: t, mountPath: /t}
    - {name: t, mountPath: /ca/ca.crt, subPath: ca.crt}
    - {name: out, mountPath: /out}
  volumes:
  - {name: t, configMap: {name: $name}}
  - {name: out, emptyDir: {}}
POD
kubectl -n default wait pod/"$name" --for=jsonpath='{.status.phase}'=Running --timeout=120s >/dev/null 2>&1
kubectl -n default logs -f pod/"$name"
mkdir -p "$W/inpod-out"; kubectl -n default cp "default/$name:/out" "$W/inpod-out" >/dev/null 2>&1 || true
kubectl -n default wait pod/"$name" --for=jsonpath='{.status.phase}'=Succeeded --timeout=90s >/dev/null 2>&1
code=$(kubectl -n default get pod "$name" -o jsonpath='{.status.containerStatuses[0].state.terminated.exitCode}')
exit "${code:-1}"
