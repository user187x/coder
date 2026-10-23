"""Post-install / post-sync bootstrap of a fresh Coder (Python standard library + pgwire.py, no other dependencies).

1. Waits for Coder, then creates its first user (an owner) from Secret <initAuth> when Coder has no user yet.
   Coder only accepts strong passwords through its API, so the user is created with a random one and its stored
   hash is then set to FIRST_USER_PASSWORD (Coder checks strength when a password is set, not at sign-in; the hash
   format is coderd/userpassword's). This happens only when the user is created: later runs never reset a password.
2. With password sign-in disabled (CODER_DISABLE_PASSWORD_AUTH=true), Coder refuses every password login, owners
   included, so the first user (matched by FIRST_USER_EMAIL) is switched to login type "oidc" instead: the Keycloak
   account with that email becomes this owner on its first sign-in (Coder links OIDC sign-ins to users by email).
3. A short-lived API token (30 minutes, Coder's own key format) is minted for an owner, straight into Coder's
   database, and written to Secret <TOKEN_SECRET>, which the template-push Job (coder-workspace) signs in with, so the
   push never depends on the admin's current password. Earlier bootstrap tokens are deleted first.
"""
import base64
import hashlib
import json
import os
import secrets
import ssl
import string
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pgwire  # noqa: E402

CODER_URL = os.environ["CODER_URL"].rstrip("/")
EMAIL = os.environ["FIRST_USER_EMAIL"]
USERNAME = os.environ.get("FIRST_USER_USERNAME") or "admin"
PASSWORD = os.environ["FIRST_USER_PASSWORD"]
PASSWORD_AUTH_DISABLED = os.environ.get("DISABLE_PASSWORD_AUTH", "").lower() == "true"
TOKEN_SECRET = os.environ.get("TOKEN_SECRET", "")
TOKEN_NAME_PREFIX = "coder-airgapped-bootstrap"
SA = "/var/run/secrets/kubernetes.io/serviceaccount"
ALPHABET = string.digits + string.ascii_letters  # cryptorand.Default


def log(msg):
    print(msg, flush=True)


def coder(method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Coder-Session-Token"] = token
    req = urllib.request.Request(CODER_URL + path, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def wait_for_coder():
    deadline = time.time() + int(os.environ.get("TIMEOUT", "900"))
    while True:
        try:
            if coder("GET", "/healthz")[0] == 200:
                return
            reason = "not healthy yet"
        except OSError as e:
            reason = str(e)
        if time.time() > deadline:
            sys.exit("Coder did not answer in time (%s)." % reason)
        log("Waiting for Coder (%s)..." % reason)
        time.sleep(5)


def connect_db():
    cafile = os.environ.get("CODER_DB_CA")
    return pgwire.Connection(os.environ["CODER_DB_URI"], cafile=cafile if cafile and os.path.exists(cafile) else None,
                             application_name="coder-bootstrap")


def ensure_first_user():
    """True when this run created the first user."""
    status, _ = coder("GET", "/api/v2/users/first")
    if status == 200:
        log("Coder already has its first user.")
        return False
    if status != 404:
        sys.exit("Checking for the first user failed: HTTP %d" % status)
    temporary = "".join(secrets.choice(ALPHABET) for _ in range(32))
    status, body = coder("POST", "/api/v2/users/first",
                         {"email": EMAIL, "username": USERNAME, "name": "", "password": temporary, "trial": False})
    if status not in (200, 201):
        sys.exit("Creating the first user failed: HTTP %d %s" % (status, body.decode(errors="replace")))
    log("Created Coder's first user %s <%s> (owner)." % (USERNAME, EMAIL))
    return True


def password_hash(password):
    """coderd/userpassword.Hash: $pbkdf2-sha256$<iterations>$<salt>$<key>, unpadded standard base64."""
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 65535, 64)

    def b64(b):
        return base64.b64encode(b).decode().rstrip("=")
    return "$pbkdf2-sha256$65535$%s$%s" % (b64(salt), b64(key))


def set_first_password(db):
    rows = db.query("UPDATE users SET hashed_password = $2, updated_at = now() WHERE lower(email) = lower($1) "
                    "AND login_type = 'password' AND NOT deleted RETURNING id::text",
                    [EMAIL, password_hash(PASSWORD).encode()])
    if not rows:
        sys.exit("Setting the first user's password failed: no password user with email %s." % EMAIL)
    status, body = coder("POST", "/api/v2/users/login", {"email": EMAIL, "password": PASSWORD})
    if status not in (200, 201):
        sys.exit("Signing in with the first user's password failed: HTTP %d %s"
                 % (status, body.decode(errors="replace")))
    log("Set the first user's password (Secret initAuth); signing in with it works.")


def link_to_oidc(db):
    rows = db.query("SELECT id::text, login_type::text FROM users WHERE lower(email) = lower($1) AND NOT deleted",
                    [EMAIL])
    if rows and rows[0][1] == "password":
        db.query("UPDATE users SET login_type = 'oidc', hashed_password = $2, updated_at = now() "
                 "WHERE id = $1::uuid", [rows[0][0], b""])
        log("Switched %s to Keycloak (OIDC) sign-in: that Keycloak account is this owner from its first sign-in."
            % EMAIL)
    elif rows:
        log("%s already signs in with %s." % (EMAIL, rows[0][1]))
    else:
        log("WARNING: no Coder user with email %s." % EMAIL)


def mint_token(db):
    owner = db.query("SELECT id::text, username FROM users WHERE NOT deleted AND 'owner' = ANY(rbac_roles) "
                     "ORDER BY (lower(email) = lower($1)) DESC, created_at LIMIT 1", [EMAIL])
    if not owner:
        sys.exit("Coder has no owner to push the template as.")
    key_id = "".join(secrets.choice(ALPHABET) for _ in range(10))
    secret = "".join(secrets.choice(ALPHABET) for _ in range(22))
    db.query("DELETE FROM api_keys WHERE login_type = 'token' AND token_name LIKE $1", [TOKEN_NAME_PREFIX + "-%"])
    db.query("INSERT INTO api_keys (id, hashed_secret, user_id, last_used, expires_at, created_at, updated_at, "
             "login_type, lifetime_seconds, ip_address, token_name, scopes, allow_list) VALUES "
             "($1, $2, $3::uuid, now(), now() + interval '30 minutes', now(), now(), 'token', 1800, '0.0.0.0', "
             "$4, '{coder:all}', '{*:*}')",
             [key_id, hashlib.sha256(secret.encode()).digest(), owner[0][0], TOKEN_NAME_PREFIX + "-" + key_id])
    return key_id + "-" + secret


def kube(method, path, body=None):
    with open(SA + "/token") as f:
        token = f.read().strip()
    req = urllib.request.Request("https://kubernetes.default.svc" + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    ctx = ssl.create_default_context(cafile=SA + "/ca.crt")
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as res:
            return res.status
    except urllib.error.HTTPError as e:
        return e.code


def store_token(token):
    with open(SA + "/namespace") as f:
        ns = f.read().strip()
    secret = {"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
              "metadata": {"name": TOKEN_SECRET, "namespace": ns,
                           "labels": {"app.kubernetes.io/part-of": "coder",
                                      "app.kubernetes.io/name": "coder-bootstrap"}},
              "stringData": {"token": token}}
    status = kube("PUT", "/api/v1/namespaces/%s/secrets/%s" % (ns, TOKEN_SECRET), secret)
    if status == 404:
        status = kube("POST", "/api/v1/namespaces/%s/secrets" % ns, secret)
    if status not in (200, 201):
        sys.exit("Writing Secret %s failed: HTTP %d" % (TOKEN_SECRET, status))
    log("Stored a 30-minute template-push token in Secret %s." % TOKEN_SECRET)


wait_for_coder()
db = connect_db()  # before creating the user, so a database problem cannot leave it with the random password
try:
    created = ensure_first_user()
    if PASSWORD_AUTH_DISABLED:
        link_to_oidc(db)
    elif created:
        set_first_password(db)
    token = mint_token(db) if TOKEN_SECRET else None
finally:
    db.close()
if token:
    status, body = coder("GET", "/api/v2/users/me", token=token)
    if status != 200:
        sys.exit("The minted token does not work: HTTP %d %s" % (status, body.decode(errors="replace")))
    log("Minted a template-push token for owner %s." % json.loads(body).get("username"))
    store_token(token)
