#!/usr/bin/env python3
"""coder-platform setup Jobs (standard-library Python).

  setup.py secrets     before anything else: creates the generated Secrets that don't exist yet (Coder's database
                       password and connection URL, the first admin's password). Existing Secrets are never changed,
                       so every re-sync (Argo CD renders the chart again each time) keeps the same passwords.
  setup.py first-user  once Coder answers: creates the first admin unless Coder already has one.

Settings come from the environment (see templates/setup-*.yaml)."""
import base64
import json
import os
import secrets
import ssl
import sys
import time
import urllib.error
import urllib.request

SA = "/var/run/secrets/kubernetes.io/serviceaccount"


def log(message):
    print(message, flush=True)


def kube(method, path, body=None):
    """(status, decoded JSON) of a Kubernetes API call with the pod's service account."""
    host = os.environ.get("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc")
    port = os.environ.get("KUBERNETES_SERVICE_PORT", "443")
    with open(SA + "/token") as f:
        token = f.read().strip()
    req = urllib.request.Request("https://%s:%s%s" % (host, port, path), method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    ctx = ssl.create_default_context(cafile=SA + "/ca.crt")
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def ensure_secret(namespace, name, make):
    """Creates Secret name from make() unless it exists; returns True when it was created."""
    status, _ = kube("GET", "/api/v1/namespaces/%s/secrets/%s" % (namespace, name))
    if status == 200:
        log("Secret %s exists; kept as it is." % name)
        return False
    if status != 404:
        sys.exit("Reading Secret %s failed with HTTP %d." % (name, status))
    data = make()
    body = {"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
            "metadata": {"name": name, "namespace": namespace,
                         "labels": {"app.kubernetes.io/part-of": "coder-platform",
                                    "app.kubernetes.io/created-by": "coder-platform-setup"}},
            "data": {k: base64.b64encode(v.encode()).decode() for k, v in data.items()}}
    status, res = kube("POST", "/api/v1/namespaces/%s/secrets" % namespace, body)
    if status == 409:
        log("Secret %s was created meanwhile; kept as it is." % name)
        return False
    if status not in (200, 201):
        sys.exit("Creating Secret %s failed with HTTP %d: %s" % (name, status, res.get("message", "")))
    log("Created Secret %s." % name)
    return True


def setup_secrets():
    namespace = os.environ["NAMESPACE"]
    if os.environ.get("DB_SECRET"):
        def db():
            password = secrets.token_urlsafe(24)
            return {"password": password,
                    "uri": "postgres://coder:%s@coder-db.%s.svc.cluster.local:5432/coder?sslmode=disable"
                           % (password, namespace)}
        ensure_secret(namespace, os.environ["DB_SECRET"], db)
    if os.environ.get("FIRST_USER_SECRET"):
        ensure_secret(namespace, os.environ["FIRST_USER_SECRET"], lambda: {"password": secrets.token_urlsafe(24)})


def decode(raw):
    """A JSON response body, or {} for any other body (/healthz answers plain "OK")."""
    try:
        decoded = json.loads(raw or b"{}")
    except ValueError:
        return {}
    return decoded if isinstance(decoded, dict) else {}


def coder(method, path, body=None):
    url = os.environ["CODER_URL"] + path
    req = urllib.request.Request(url, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, decode(res.read())
    except urllib.error.HTTPError as e:
        return e.code, decode(e.read())


def setup_first_user():
    deadline = time.time() + int(os.environ.get("WAIT_SECONDS", "900"))
    while True:
        try:
            status, _ = coder("GET", "/healthz")
            if status == 200:
                break
        except (urllib.error.URLError, OSError):
            pass
        if time.time() > deadline:
            sys.exit("Coder did not answer at %s in time." % os.environ["CODER_URL"])
        log("Waiting for Coder ...")
        time.sleep(5)
    status, _ = coder("GET", "/api/v2/users/first")
    if status == 200:
        log("Coder already has an admin; nothing to do.")
        return
    if status != 404:
        sys.exit("Checking for an admin failed with HTTP %d." % status)
    request = {"username": os.environ["FIRST_USER_USERNAME"], "email": os.environ["FIRST_USER_EMAIL"],
               "name": os.environ.get("FIRST_USER_NAME", ""), "password": os.environ["FIRST_USER_PASSWORD"]}
    status, res = coder("POST", "/api/v2/users/first", request)
    if status not in (200, 201):
        detail = "; ".join(v.get("detail", "") for v in res.get("validations") or []) or res.get("detail", "")
        sys.exit("Creating the first admin failed with HTTP %d: %s %s" % (status, res.get("message", ""), detail))
    log("Created the first admin %s (%s)." % (request["username"], request["email"]))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "secrets":
        setup_secrets()
    elif mode == "first-user":
        setup_first_user()
    else:
        sys.exit("usage: setup.py secrets|first-user")
