#!/usr/bin/env python3
"""Prepare an immutable platform-service image before replacing its single writer."""
import argparse
import json
import subprocess
import sys
import uuid


def warm_pod(template, node, image, namespace):
    """Check the image on the volume's current node without mounting application data."""
    spec = template["spec"]
    return {
        "apiVersion": "v1", "kind": "Pod",
        "metadata": {"name": "coder-ui-image-check-" + uuid.uuid4().hex[:8], "namespace": namespace},
        "spec": {
            "nodeName": node, "restartPolicy": "Never", "activeDeadlineSeconds": 300,
            "automountServiceAccountToken": False,
            "imagePullSecrets": spec.get("imagePullSecrets", []),
            "securityContext": {"runAsNonRoot": True, "runAsUser": 65534, "runAsGroup": 65534},
            "containers": [{
                "name": "check", "image": image,
                "imagePullPolicy": next((c.get("imagePullPolicy", "IfNotPresent") for c in spec.get("containers", []) if c["name"] == "ui"), "IfNotPresent"),
                "command": ["python3", "-c", "from pathlib import Path; p=Path('/app/ui-service.py'); compile(p.read_text(), str(p), 'exec')"],
                "securityContext": {"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True,
                                    "capabilities": {"drop": ["ALL"]}, "seccompProfile": {"type": "RuntimeDefault"}},
                "resources": {"requests": {"cpu": "10m", "memory": "32Mi"}, "limits": {"cpu": "1", "memory": "256Mi"}},
            }],
        },
    }


def prepare(run, image, namespace, template=None):
    """Warm the target image without replacing the running writer or mounting its data."""
    current = run(["get", "deployment", "coder-ui-updates", "--ignore-not-found", "-o", "json"])
    if not current.strip():
        return
    deployment = json.loads(current)
    selector = ",".join(f"{key}={value}" for key, value in deployment["spec"]["selector"]["matchLabels"].items())
    pods = json.loads(run(["get", "pods", "-l", selector, "-o", "json"]))["items"]
    nodes = sorted({pod["spec"]["nodeName"] for pod in pods
                    if not pod["metadata"].get("deletionTimestamp") and any(
                        c.get("type") == "Ready" and c.get("status") == "True" for c in pod["status"].get("conditions", []))})
    if not nodes:
        raise RuntimeError("No ready platform-service pod; repair the current deployment before updating it.")
    for node in nodes:
        pod = warm_pod(template or deployment["spec"]["template"], node, image, namespace)
        name = pod["metadata"]["name"]
        run(["create", "-f", "-"], json.dumps(pod))
        try:
            run(["wait", "--for=jsonpath={.status.phase}=Succeeded", "pod/" + name, "--timeout=300s"])
        finally:
            run(["delete", "pod", name, "--ignore-not-found", "--wait=false"])


def update(run, image, namespace):
    prepare(run, image, namespace)
    run(["set", "image", "deployment/coder-ui-updates", "ui=" + image])
    run(["rollout", "status", "deployment/coder-ui-updates", "--timeout=180s"])


def prepare_manifest(run, manifest, namespace):
    """Prepare the platform-service deployment from Helm's rendered target values."""
    documents = manifest.get("items", []) if manifest.get("kind") == "List" else [manifest]
    for document in documents:
        if document.get("kind") != "Deployment" or document.get("metadata", {}).get("name") != "coder-ui-updates":
            continue
        template = document["spec"]["template"]
        image = next(c["image"] for c in template["spec"]["containers"] if c["name"] == "ui")
        prepare(run, image, namespace, template)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kubeconfig")
    parser.add_argument("--namespace", default="coder")
    parser.add_argument("--image")
    parser.add_argument("--prepare-manifest", action="store_true", help="Read rendered Kubernetes JSON from stdin; prepare only, without changing the deployment.")
    args = parser.parse_args()
    if args.prepare_manifest and args.image:
        parser.error("--prepare-manifest cannot be combined with --image")
    if not args.prepare_manifest and (not args.image or "@sha256:" not in args.image):
        parser.error("--image must use an immutable sha256 digest")

    def run(command, body=None):
        kubeconfig = ["--kubeconfig", args.kubeconfig] if args.kubeconfig else []
        result = subprocess.run(["kubectl", *kubeconfig, "-n", args.namespace, *command],
                                input=body, text=True, capture_output=True, check=True)
        return result.stdout

    if args.prepare_manifest:
        prepare_manifest(run, json.load(sys.stdin), args.namespace)
        print("Platform-service image preflight completed.")
    else:
        update(run, args.image, args.namespace)
        print("Platform-service image prepared and rollout completed.")


if __name__ == "__main__":
    main()
