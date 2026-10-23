#!/usr/bin/env bash
# The image builder offline: step9.py in a pod (builds an image with no internet, checks its report), then the built
# image started on the node through the registry proxy (localhost:5000), checked for what the build put in it.
set -uo pipefail
W="$(cd "$(dirname "$0")" && pwd)"; export KUBECONFIG=$W/kubeconfig
kubectl -n default delete pod step9 step9-image --ignore-not-found --wait=true >/dev/null 2>&1
kubectl -n default delete configmap step9 --ignore-not-found >/dev/null
kubectl -n default create configmap step9 --from-file=step9.py="$W/step9.py" --from-file=ca.crt="$W/pki/ca.crt" >/dev/null
kubectl -n default apply -f - >/dev/null <<'POD'
apiVersion: v1
kind: Pod
metadata: {name: step9}
spec:
  restartPolicy: Never
  containers:
  - name: step9
    image: localhost:5001/library/python:3.13-alpine
    command: [python3, -u, /t/step9.py]
    volumeMounts:
    - {name: t, mountPath: /t}
    - {name: t, mountPath: /ca/ca.crt, subPath: ca.crt}
  volumes:
  - {name: t, configMap: {name: step9}}
POD
kubectl -n default wait pod/step9 --for=jsonpath='{.status.phase}'=Running --timeout=120s >/dev/null 2>&1
kubectl -n default logs -f pod/step9 | tee "$W/step9.log"
code=$(kubectl -n default get pod step9 -o jsonpath='{.status.containerStatuses[0].state.terminated.exitCode}')
ref=$(sed -n 's/^PULLREF=//p' "$W/step9.log")
if [[ -n "$ref" ]]; then
	# The node pulls the built image the way a workspace does (localhost:<port>, through coder-image-registry-proxy).
	kubectl -n coder run step9-image --image="$ref" --restart=Never --command -- sh -c \
		'test -f /usr/share/e2e-hello/ok && test -f /etc/e2e-install-ok && test -f /etc/coder-image/fips && test -f /usr/share/coder-image/home/.e2e-dotfile && command -v code-server >/dev/null && echo "built image content ok"' >/dev/null
	kubectl -n coder wait pod/step9-image --for=jsonpath='{.status.phase}'=Succeeded --timeout=600s >/dev/null 2>&1
	out=$(kubectl -n coder logs step9-image 2>&1); phase=$(kubectl -n coder get pod step9-image -o jsonpath='{.status.phase}')
	if [[ "$phase" == Succeeded && "$out" == *"content ok"* ]]; then echo "PASS the node pulled and ran the built image ($ref): $out"
	else echo "FAIL the node could not run the built image ($ref): $phase $out $(kubectl -n coder get events --field-selector involvedObject.name=step9-image -o jsonpath='{range .items[*]}{.message}{"\n"}{end}' | tail -3)"; code=1; fi
	kubectl -n coder delete pod step9-image --ignore-not-found >/dev/null
fi
exit "${code:-1}"
