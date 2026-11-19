"""Two-person sign-off for Global Command & Control's Terminate, kept in PostgreSQL.

Terminating every workspace needs two different administrators to sign off. Each sign-off records who signed (their
id, username and name), when, and the SHA-256 thumbprint of their active x509 device certificate (the platform's
client_certificates, issued from Users): an administrator without one cannot sign. The sign-offs of one round are
good for ROUND_SECONDS from the first; any administrator can cancel the round, and starting the terminate checks
them (workspacepower.start) and the client marks the round complete once every organization's operation started.

  GET    /__coder-ui/api/workspace-power/terminate-signoffs           the current round
  POST   /__coder-ui/api/workspace-power/terminate-signoffs           sign off on it (a new round if none is open)
  DELETE /__coder-ui/api/workspace-power/terminate-signoffs           cancel it (older clients)
  POST   /__coder-ui/api/workspace-power/terminate-signoffs/cancel    {round_id}: cancel the specified round
  POST   /__coder-ui/api/workspace-power/terminate-signoffs/pause     {round_id}: pause the shared countdown
  POST   /__coder-ui/api/workspace-power/terminate-signoffs/resume    {round_id}: resume the shared countdown
  POST   /__coder-ui/api/workspace-power/terminate-signoffs/revoke    {round_id}: withdraw your own sign-off
  POST   /__coder-ui/api/workspace-power/terminate-signoffs/complete  {round_id}: the terminate ran; close it
"""
import contextlib
import json
import threading
import time
import uuid

PATH = "/__coder-ui/api/workspace-power/terminate-signoffs"
REQUIRED = 2
COUNTDOWN_MS = 5000
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
                    closed_at timestamptz, closed_by uuid, closed_reason text)""")
                tx.query("""ALTER TABLE coder_ui_updates.terminate_signoffs
                    ADD COLUMN IF NOT EXISTS deadline_ms bigint,
                    ADD COLUMN IF NOT EXISTS paused_ms bigint,
                    DROP CONSTRAINT IF EXISTS terminate_signoffs_round_id_user_id_key,
                    DROP CONSTRAINT IF EXISTS terminate_signoffs_closed_reason_check,
                    ADD CONSTRAINT terminate_signoffs_closed_reason_check
                    CHECK (closed_reason IN ('completed', 'cancelled', 'revoked'))""")
                tx.query("""CREATE UNIQUE INDEX IF NOT EXISTS terminate_signoffs_open_signer
                    ON coder_ui_updates.terminate_signoffs(round_id, user_id) WHERE closed_at IS NULL""")
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
        SELECT round_id, user_id, username, name, fingerprint, signed_at, deadline_ms, paused_ms,
            (SELECT min(signed_at) FROM coder_ui_updates.terminate_signoffs f WHERE f.round_id=t.round_id) AS opened_at
        FROM coder_ui_updates.terminate_signoffs t
        WHERE closed_at IS NULL AND round_id = (
            SELECT round_id FROM coder_ui_updates.terminate_signoffs WHERE closed_at IS NULL
            GROUP BY round_id HAVING (
                SELECT min(f.signed_at) FROM coder_ui_updates.terminate_signoffs f
                WHERE f.round_id = terminate_signoffs.round_id
            ) > now() - make_interval(secs => $1::int)
            ORDER BY min(signed_at) DESC LIMIT 1)
        ORDER BY signed_at, id) s""", [ROUND_SECONDS])
    signoffs = [json.loads(row[0]) for row in rows]
    return (signoffs[0]["round_id"] if signoffs else None), signoffs


def now_ms():
    return time.time_ns() // 1_000_000


def view(db):
    round_id, signoffs = current(db)
    final = signoffs[-1] if len(signoffs) == REQUIRED else {}
    return {"round_id": round_id, "deadline_ms": final.get("deadline_ms"),
            "paused_ms": final.get("paused_ms"), "server_now_ms": now_ms(), "required": REQUIRED, "round_seconds": ROUND_SECONDS,
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
        recorded_round = round_id or str(uuid.uuid4())
        tx.query("""INSERT INTO coder_ui_updates.terminate_signoffs (id, round_id, user_id, username, name, fingerprint, deadline_ms, signed_at)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::bigint, clock_timestamp())""",
                 [str(uuid.uuid4()), recorded_round, user["id"], user["username"],
                  user.get("name") or "", fingerprint,
                  str(now_ms() + COUNTDOWN_MS) if len(signoffs) == REQUIRED - 1 else None])
    LOG(event="terminate-signoff", user=user["username"], fingerprint=fingerprint, round=recorded_round)
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


def revoke(user, round_id):
    db = database()
    with db.transaction() as tx:
        tx.query("SELECT pg_advisory_xact_lock(731947, 1)")
        open_round, signoffs = current(tx)
        if round_id != open_round or not any(s["user_id"] == user["id"] for s in signoffs):
            raise LookupError("You have no active sign-off in this round.")
        tx.query("""UPDATE coder_ui_updates.terminate_signoffs
            SET closed_at=now(), closed_by=$2::uuid, closed_reason='revoked'
            WHERE round_id=$1::uuid AND user_id=$2::uuid AND closed_at IS NULL""", [round_id, user["id"]])
    LOG(event="terminate-signoff-revoked", user=user["username"], round=round_id)
    return view(db)


def set_paused(round_id, pause):
    db = database()
    with db.transaction() as tx:
        tx.query("SELECT pg_advisory_xact_lock(731947, 1)")
        final = ready(round_id, tx)[-1]
        now = now_ms()
        deadline, remaining = final["deadline_ms"], final["paused_ms"]
        if deadline is None or (remaining is None and deadline <= now):
            raise ValueError("The Terminate countdown has ended.")
        if pause != (remaining is not None):
            tx.query("""UPDATE coder_ui_updates.terminate_signoffs
                SET deadline_ms=$3::bigint, paused_ms=$4::bigint
                WHERE round_id=$1::uuid AND user_id=$2::uuid AND closed_at IS NULL""",
                     [round_id, final["user_id"], str(deadline if pause else now + remaining),
                      str(deadline - now) if pause else None])
    return view(db)


@contextlib.contextmanager
def authorized_start(round_id):
    """Serialize revocation with the final authorization and recording of an operation."""
    with database().transaction() as tx:
        tx.query("SELECT pg_advisory_xact_lock(731947, 1)")
        signoffs = ready(round_id, tx)
        final = signoffs[-1]
        if final["deadline_ms"] is None or final["paused_ms"] is not None or final["deadline_ms"] > now_ms():
            raise PermissionError("Wait for the Terminate countdown to finish.")
        yield [{k: signer[k] for k in ("user_id", "username", "name", "signed_at")} for signer in signoffs]


def ready(round_id, db=None):
    """Raise unless round_id is the open round and it has its sign-offs from REQUIRED different administrators."""
    _, signoffs = current(db if db is not None else database())
    if not round_id or not signoffs or signoffs[0]["round_id"] != round_id or \
            len({s["user_id"] for s in signoffs}) < REQUIRED:
        raise PermissionError("Terminate needs the sign-off of two administrators.")
    return signoffs


def handle(h, method, path):
    if path not in (PATH, PATH + "/complete", PATH + "/revoke", PATH + "/pause", PATH + "/resume", PATH + "/cancel"):
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
            round_id = str(uuid.UUID(round_id))
            if path.endswith(("/pause", "/resume")):
                h.send_json(200, set_paused(round_id, path.endswith("/pause")))
            elif path.endswith("/cancel"):
                h.send_json(200, close(user, "cancelled", round_id))
            else:
                h.send_json(200, revoke(user, round_id) if path.endswith("/revoke")
                            else close(user, "completed", round_id))
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
