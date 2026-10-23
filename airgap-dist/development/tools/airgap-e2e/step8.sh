#!/usr/bin/env bash
# DEPLOY.md step 8 inside the air-gapped network: step8.py in a pod (the bundle's python image, from the mirror), with
# the test CA. Prints its checks; exits non-zero when one fails. Log: step8.log.
set -uo pipefail
W="$(cd "$(dirname "$0")" && pwd)"; export KUBECONFIG=$W/kubeconfig
kubectl -n default delete pod step8 --ignore-not-found --wait=true >/dev/null 2>&1
kubectl -n default delete configmap step8 --ignore-not-found >/dev/null
kubectl -n default create configmap step8 --from-file=step8.py="$W/step8.py" --from-file=ca.crt="$W/pki/ca.crt" >/dev/null
kubectl -n default apply -f - >/dev/null <<'POD'
apiVersion: v1
kind: Pod
metadata: {name: step8}
spec:
  restartPolicy: Never
  containers:
  - name: step8
    image: localhost:5001/library/python:3.13-alpine
    command: [python3, -u, /t/step8.py]
    volumeMounts:
    - {name: t, mountPath: /t}
    - {name: t, mountPath: /ca/ca.crt, subPath: ca.crt}
  volumes:
  - {name: t, configMap: {name: step8}}
POD
kubectl -n default wait pod/step8 --for=jsonpath='{.status.phase}'=Running --timeout=120s >/dev/null 2>&1
kubectl -n default logs -f pod/step8 | tee "$W/step8.log"
code=$(kubectl -n default get pod step8 -o jsonpath='{.status.containerStatuses[0].state.terminated.exitCode}')
exit "${code:-1}"
