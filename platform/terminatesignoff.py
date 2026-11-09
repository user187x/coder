"""Two-person sign-off for Global Command & Control's Terminate, kept in PostgreSQL.

Terminating every workspace needs two different administrators to sign off. Each sign-off records who signed (their
id, username and name), when, and the SHA-256 thumbprint of their active x509 device certificate (the platform's
client_certificates, issued from Users): an administrator without one cannot sign. The sign-offs of one round are
good for ROUND_SECONDS from the first; any administrator can cancel the round, and starting the terminate checks
them (workspacepower.start) and the client marks the round complete once every organization's operation started.

  GET    /__coder-ui/api/workspace-power/terminate-signoffs           the current round
  POST   /__coder-ui/api/workspace-power/terminate-signoffs           sign off on it (a new round if none is open)
  DELETE /__coder-ui/api/workspace-power/terminate-signoffs           cancel it
  POST   /__coder-ui/api/workspace-power/terminate-signoffs/complete  {round_id}: the terminate ran; close it
"""
import json
import threading
import uuid

PATH = "/__coder-ui/api/workspace-power/terminate-signoffs"
REQUIRED = 2
ROUND_SECONDS = 15 * 60
STATE = LOG = None
READY = False
LOCK = threading.Lock()


def setup(state, log):
    global STATE, LOG
    STATE, LOG = state, log


def database():
    global READY
    db = STATE.database()
    with LOCK:
        if not READY:
            with db.transaction() as tx:
                tx.query("SELECT pg_advisory_xact_lock(731947, 0)")
                tx.query("""CREATE TABLE IF NOT EXISTS coder_ui_updates.terminate_signoffs (
                    id uuid PRIMARY KEY, round_id uuid NOT NULL,
                    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    username text NOT NULL, name text NOT NULL, fingerprint text NOT NULL,
                    signed_at timestamptz NOT NULL DEFAULT now(),
                    closed_at timestamptz, closed_by uuid, closed_reason text CHECK (closed_reason IN ('completed', 'cancelled')),
                    UNIQUE (round_id, user_id))""")
                tx.query("CREATE INDEX IF NOT EXISTS terminate_signoffs_open ON coder_ui_updates.terminate_signoffs(signed_at DESC) "
                         "WHERE closed_at IS NULL")
            READY = True
    return db


def thumbprint(db, user_id):
    """The SHA-256 thumbprint ("AB:CD:...") of the user's newest active device certificate, or None."""
    rows = db.query("""SELECT fingerprint FROM coder_ui_updates.client_certificates
        WHERE user_id=$1::uuid AND status='active' AND expires_at > now() ORDER BY created_at DESC LIMIT 1""", [user_id])
    if not rows or not rows[0][0]:
        return None
    raw = rows[0][0].replace(":", "").upper()
    return ":".join(raw[i:i + 2] for i in range(0, len(raw), 2))


def current(db):
    """The open round (its first sign-off at most ROUND_SECONDS ago): (round_id or None, [sign-offs, oldest first])."""
    rows = db.query("""SELECT row_to_json(s)::text FROM (
        SELECT round_id, user_id, username, name, fingerprint, signed_at,
            (SELECT min(signed_at) FROM coder_ui_updates.terminate_signoffs f WHERE f.round_id=t.round_id) AS opened_at
        FROM coder_ui_updates.terminate_signoffs t
        WHERE closed_at IS NULL AND round_id = (
            SELECT round_id FROM coder_ui_updates.terminate_signoffs WHERE closed_at IS NULL
            GROUP BY round_id HAVING min(signed_at) > now() - make_interval(secs => $1::int)
            ORDER BY min(signed_at) DESC LIMIT 1)
        ORDER BY signed_at, id) s""", [ROUND_SECONDS])
    signoffs = [json.loads(row[0]) for row in rows]
    return (signoffs[0]["round_id"] if signoffs else None), signoffs


def view(db):
    round_id, signoffs = current(db)
    return {"round_id": round_id, "required": REQUIRED, "round_seconds": ROUND_SECONDS,
            "opened_at": signoffs[0]["opened_at"] if signoffs else None,
            "signoffs": [{k: s[k] for k in ("user_id", "username", "name", "fingerprint", "signed_at")} for s in signoffs]}


def sign(user):
    db = database()
    fingerprint = thumbprint(db, user["id"])
    if not fingerprint:
        raise PermissionError("Signing off needs your active x509 device certificate. Ask an administrator to issue "
                              "one (Users, Client certificates).")
    with db.transaction() as tx:
        tx.query("SELECT pg_advisory_xact_lock(731947, 1)")
        round_id, signoffs = current(tx)
        if any(s["user_id"] == user["id"] for s in signoffs):
            raise ValueError("You already signed off. Another administrator must sign off too.")
        if len(signoffs) >= REQUIRED:
            raise ValueError("This terminate already has its sign-offs.")
        tx.query("""INSERT INTO coder_ui_updates.terminate_signoffs (id, round_id, user_id, username, name, fingerprint)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)""",
                 [str(uuid.uuid4()), round_id or str(uuid.uuid4()), user["id"], user["username"],
                  user.get("name") or "", fingerprint])
    LOG(event="terminate-signoff", user=user["username"], fingerprint=fingerprint)
    return view(db)


def close(user, reason, round_id=None):
    db = database()
    with db.transaction() as tx:
        tx.query("SELECT pg_advisory_xact_lock(731947, 1)")
        open_round, _ = current(tx)
        if not open_round or (round_id and round_id != open_round):
            raise LookupError("No open terminate sign-off round.")
        tx.query("""UPDATE coder_ui_updates.terminate_signoffs SET closed_at=now(), closed_by=$2::uuid, closed_reason=$3
            WHERE round_id=$1::uuid AND closed_at IS NULL""", [open_round, user["id"], reason])
    LOG(event="terminate-signoff-" + reason, user=user["username"], round=open_round)
    return view(db)


def ready(round_id):
    """Raise unless round_id is the open round and it has its sign-offs from REQUIRED different administrators."""
    _, signoffs = current(database())
    if not round_id or not signoffs or signoffs[0]["round_id"] != round_id or \
            len({s["user_id"] for s in signoffs}) < REQUIRED:
        raise PermissionError("Terminate needs the sign-off of two administrators.")


def handle(h, method, path):
    if path not in (PATH, PATH + "/complete"):
        return False
    try:
        if method in ("POST", "DELETE") and not h.csrf_ok():
            raise PermissionError("Request rejected (cross-site protection).")
        user, err = h.user(admin=True)
        if err:
            return True
        if method == "GET" and path == PATH:
            h.send_json(200, view(database()))
        elif method == "POST" and path == PATH:
            h.send_json(200, sign(user))
        elif method == "DELETE" and path == PATH:
            h.send_json(200, close(user, "cancelled"))
        elif method == "POST":
            length = int(h.headers.get("Content-Length", "0"))
            if not 0 <= length <= 4096:
                raise ValueError("Request body is too large.")
            body = json.loads(h.rfile.read(length) or b"{}")
            round_id = body.get("round_id") if isinstance(body, dict) else None
            if not isinstance(round_id, str):
                raise ValueError("round_id is required.")
            h.send_json(200, close(user, "completed", str(uuid.UUID(round_id))))
        else:
            h.send_json(405, {"error": "Method not allowed."})
    except PermissionError as error:
        h.send_json(403, {"error": str(error)})
    except LookupError as error:
        h.send_json(404, {"error": str(error)})
    except (ValueError, TypeError) as error:
        h.send_json(400, {"error": str(error)})
    except Exception as error:  # noqa: BLE001 - the database is unreachable or refused the change
        LOG(event="terminate-signoff-failed", error=str(error)[:200])
        h.send_json(503, {"error": "Terminate sign-offs could not be read or recorded."})
    return True
