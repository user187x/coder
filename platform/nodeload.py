"""Publish host load averages from a trusted infrastructure DaemonSet."""
from datetime import datetime, timezone
import json
import math
import os
import ssl
import time
import urllib.parse
import urllib.request

ANNOTATION = "platform.coder/node-load"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def observation(raw, uid, now=None):
    values = [float(value) for value in raw.split()[:3]]
    if len(values) != 3 or any(not math.isfinite(value) or value < 0 for value in values):
        raise ValueError("Invalid host load averages")
    return {"nodeUID": uid, "load1": values[0], "load5": values[1], "load15": values[2],
            "collectedAt": (now or datetime.now(timezone.utc)).isoformat()}


def publish():
    name = os.environ["NODE_NAME"]
    sa = "/var/run/secrets/kubernetes.io/serviceaccount"
    context = ssl.create_default_context(cafile=sa + "/ca.crt")
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), NoRedirect())
    host = os.environ["KUBERNETES_SERVICE_HOST"]
    host = "[%s]" % host if ":" in host else host
    url = "https://%s:%s/api/v1/nodes/%s" % (host,
        os.environ.get("KUBERNETES_SERVICE_PORT_HTTPS", "443"), urllib.parse.quote(name, safe=""))
    with open(sa + "/token") as source:
        headers = {"Authorization": "Bearer " + source.read().strip()}
    with opener.open(urllib.request.Request(url, headers=headers), timeout=5) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError("Node response exceeds observation bound")
        node = json.loads(raw)
    metadata = node["metadata"]
    with open("/host-loadavg") as source:
        value = observation(source.read(256), metadata["uid"])
    body = {"metadata": {"uid": metadata["uid"], "resourceVersion": metadata["resourceVersion"],
                         "annotations": {ANNOTATION: json.dumps(value, separators=(",", ":"))}}}
    headers["Content-Type"] = "application/merge-patch+json"
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="PATCH")
    with opener.open(request, timeout=5) as response:
        response.read(2 * 1024 * 1024)


if __name__ == "__main__":
    while True:
        try:
            publish()
        except Exception:
            # Never log API responses or service-account credentials.
            print("Node load observation unavailable; retrying.", flush=True)
        time.sleep(10)
