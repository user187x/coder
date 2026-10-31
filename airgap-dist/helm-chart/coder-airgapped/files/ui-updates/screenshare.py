"""Short-lived, participant-only WebRTC signaling for consented support sessions."""
import base64
import hashlib
import hmac
import json
import os
import threading
import time
import uuid
from datetime import datetime

import workspacevolumes as volumes

BASE = '/__coder-ui/api/screen-share'
STATE = LOG = MAY_CHAT = None
USER_SHARING = lambda: False
READY = False
NEXT_PRUNE = 0.0
LOCK = threading.Lock()


def setup(state, log, may_chat, user_sharing=lambda: False):
    global STATE, LOG, MAY_CHAT, USER_SHARING
    STATE, LOG, MAY_CHAT, USER_SHARING = state, log, may_chat, user_sharing


def database():
    global READY
    db = STATE.database()
    with LOCK:
        if not READY:
            with db.transaction() as tx:
                tx.query('SELECT pg_advisory_xact_lock(731943, 0)')
                tx.query('''CREATE TABLE IF NOT EXISTS coder_ui_updates.screen_shares (
                    id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
                    sharer uuid NOT NULL REFERENCES users(id), viewer uuid NOT NULL REFERENCES users(id),
                    workspace_id uuid REFERENCES workspaces(id), label text NOT NULL,
                    status text NOT NULL DEFAULT 'requested', offer text, answer text,
                    created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
                    sharer_seen timestamptz, viewer_seen timestamptz)''')
                tx.query('CREATE INDEX IF NOT EXISTS screen_shares_participants ON coder_ui_updates.screen_shares(sharer, viewer)')
                tx.query("ALTER TABLE coder_ui_updates.screen_shares ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'screen'")
                tx.query('CREATE INDEX IF NOT EXISTS screen_shares_viewer ON coder_ui_updates.screen_shares(viewer)')
                tx.query('CREATE INDEX IF NOT EXISTS screen_shares_created ON coder_ui_updates.screen_shares(created_at)')
                tx.query("CREATE INDEX IF NOT EXISTS screen_shares_active_expiry ON coder_ui_updates.screen_shares(expires_at) WHERE status != 'ended'")
            READY = True
    return db


def prune_history(db):
    """Bound retention housekeeping to one sweep per minute per service replica."""
    global NEXT_PRUNE
    with LOCK:
        now = time.monotonic()
        if now < NEXT_PRUNE:
            return
        NEXT_PRUNE = now + 60
    db.query("DELETE FROM coder_ui_updates.screen_shares WHERE created_at < now()-interval '7 days'")


def reconcile(db, uid):
    # User polling stays participant-scoped; the relay watchdog checks all active sessions.
    db.query('''UPDATE coder_ui_updates.screen_shares s SET status='ended',offer=NULL,answer=NULL
        WHERE status != 'ended' AND ($1::uuid IS NULL OR sharer=$1::uuid OR viewer=$1::uuid) AND (
          expires_at < now() OR
          (status='sharing' AND (sharer_seen < now()-interval '45 seconds' OR viewer_seen < now()-interval '45 seconds')) OR
          NOT EXISTS (SELECT 1 FROM users u WHERE u.id=s.sharer AND NOT u.deleted AND u.status='active') OR
          NOT EXISTS (SELECT 1 FROM users u WHERE u.id=s.viewer AND NOT u.deleted AND u.status='active') OR
          NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id=s.sharer AND m.organization_id=s.organization_id) OR
          (workspace_id IS NULL AND
            NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.user_id=s.viewer AND m.organization_id=s.organization_id)) OR
          (workspace_id IS NOT NULL AND (
            NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id=s.workspace_id AND w.organization_id=s.organization_id AND w.owner_id=s.sharer AND NOT w.deleted) OR
            NOT EXISTS (SELECT 1 FROM users u WHERE u.id=s.viewer AND u.rbac_roles && $2::text[]))) OR
          (mode='dashboard' AND NOT EXISTS (
            SELECT 1 FROM users u WHERE u.id=s.viewer AND u.rbac_roles && $2::text[])) OR
          (NOT $3::boolean AND NOT EXISTS (
            SELECT 1 FROM users u WHERE u.id=s.sharer AND u.rbac_roles && $2::text[])))''',
        [uid, '{' + ','.join(admin_roles()) + '}', USER_SHARING()])


def admin_roles():
    return [r.strip() for r in os.environ.get('ADMIN_ROLES', 'owner').split(',') if r.strip()]


def can_share(user):
    return bool(set(user.get('roles', [])) & set(admin_roles())) or USER_SHARING()


def authorize(row, user):
    if user not in (row['sharer'], row['viewer']):
        raise PermissionError('This screen share is private to its participants.')


def permits_signaling(token, user, session=None):
    """Check the credential's scope, in addition to the participant's identity."""
    if session and session.get('workspace_id'):
        action = 'application_connect'
        resource = {'resource_type': 'workspace', 'resource_id': session['workspace_id'],
                    'owner_id': session['sharer'], 'organization_id': session['organization_id']}
    else:
        action = 'update_personal'
        resource = {'resource_type': 'user', 'resource_id': user, 'owner_id': user}
    status, permissions = volumes.coder(token, 'POST', '/api/v2/authcheck', {'checks': {
        'screen_share': {'action': action, 'object': resource}}})
    return status == 200 and isinstance(permissions, dict) and permissions.get('screen_share') is True


def description(body, kind):
    sdp = body.get('sdp')
    if not isinstance(sdp, str) or not sdp.startswith('v=0') or len(sdp) > 65536:
        raise ValueError('Invalid WebRTC session description.')
    if kind not in ('offer', 'answer'):
        raise ValueError('Invalid signaling action.')
    return sdp


def relay_username(uid, session):
    """Bind a credential to one session so a later session cannot revive it."""
    expiry = int(datetime.fromisoformat(session['created_at'].replace('Z', '+00:00')).timestamp()) + 3600
    # coturn uses the nonnumeric prefix as its quota principal and the following
    # numeric field as expiry. A session suffix prevents revoked credentials reviving.
    return '%s:%d:%s' % (uid, expiry, session['id'])


def relay_servers(uid, visible):
    """Issue expiring TURN credentials only for an authorized, active session."""
    secret_file = os.environ.get('SCREEN_SHARE_TURN_SECRET_FILE')
    url = os.environ.get('SCREEN_SHARE_TURN_URL', '')
    if not visible or not secret_file or not url:
        return []
    if not url.startswith('turns:') or not url.endswith('?transport=tcp'):
        raise ValueError('The support relay requires TURN over TLS.')
    # The session cannot outlive one hour, even after signaling extends the initial request.
    username = relay_username(uid, visible[0])
    if int(username.split(':')[1]) <= time.time():
        return []
    with open(secret_file, 'rb') as source:
        secret = source.read().strip()
    if len(secret) < 32:
        raise ValueError('The support relay secret is invalid.')
    # Creation permits only one active session per participant. Revoked allocations are
    # cancelled by the relay watchdog before it renews the relay's liveness lease.
    credential = base64.b64encode(hmac.new(secret, username.encode(), hashlib.sha1).digest()).decode()
    return [{'urls': [url], 'username': username, 'credential': credential}]


def handle_relay(h, path):
    """Serve revocation state to the authenticated relay watchdog, without SDP or user data."""
    if path != '/__coder-ui/internal/support-relay':
        return False
    secret_file = os.environ.get('SCREEN_SHARE_RELAY_CONTROL_SECRET_FILE')
    supplied = h.headers.get('Authorization', '')
    if not secret_file:
        h.send_json(503, {'error': 'Support relay is not configured.'})
        return True
    try:
        with open(secret_file) as source:
            secret = source.read().strip()
        if len(secret) < 32 or not hmac.compare_digest(supplied, 'Bearer ' + secret):
            h.send_json(403, {'error': 'Relay authentication required.'})
            return True
        db = database()
        reconcile(db, None)
        rows = db.query('''SELECT id::text, sharer::text, viewer::text, created_at::text
            FROM coder_ui_updates.screen_shares WHERE status != 'ended' ''')
        allowed = []
        for sid, sharer, viewer, created in rows:
            session = {'id': sid, 'created_at': created}
            allowed.extend(relay_username(uid, session) for uid in (sharer, viewer))
        h.send_json(200, {'allowed': allowed})
    except Exception:
        # The watchdog stops relaying if it cannot obtain complete current policy.
        h.send_json(503, {'error': 'Relay authorization state unavailable.'})
    return True


def sessions(db, uid, sid=None):
    rows = db.query('''SELECT row_to_json(s)::text FROM (SELECT id::text, organization_id::text,
        sharer::text, viewer::text, (SELECT username FROM users WHERE id=sharer) AS sharer_name,
        (SELECT username FROM users WHERE id=viewer) AS viewer_name,
        workspace_id::text, label, status, mode, offer, answer, created_at, expires_at FROM coder_ui_updates.screen_shares
        WHERE (sharer=$1::uuid OR viewer=$1::uuid) AND ($2::uuid IS NULL OR id=$2::uuid)
        AND (status != 'ended' OR id=$2::uuid) ORDER BY created_at DESC LIMIT 10) s''', [uid, sid])
    return [json.loads(row[0]) for row in rows]


def handle(h, method, path):
    if path != BASE:
        return False
    if method == 'POST' and not h.csrf_ok():
        h.send_json(403, {'error': 'Request rejected (cross-site protection).'})
        return True
    user, error = h.user()
    if error:
        return True
    try:
        db, uid = database(), user['id']
        prune_history(db)
        reconcile(db, uid)
        if method == 'GET':
            allowed = permits_signaling(h.token(), uid)
            visible = [s for s in sessions(db, uid) if permits_signaling(h.token(), uid, s)]
            h.send_json(200, {'sessions': visible, 'iceServers': relay_servers(uid, visible), 'canShare': can_share(user) and allowed})
            return True
        body = volumes.read_json(h)
        action = body.get('action')
        if action in ('request', 'request_peer', 'create'):
            wid = None
            mode = body.get('mode', 'screen')
            if mode not in ('screen', 'dashboard'):
                raise ValueError('Choose screen sharing or dashboard control.')
            if mode == 'dashboard':
                if action == 'create':
                    raise PermissionError('Only administrators can request dashboard control.')
                admin, error = h.user(admin=True)
                if error:
                    return True
            if action == 'request':
                admin, error = h.user(admin=True)
                if error:
                    return True
                wid = str(uuid.UUID(body.get('workspace', '')))
                ws = volumes.workspace(h.token(), wid)
                if not volumes.can_update(h.token(), ws):
                    raise PermissionError('You cannot support this workspace.')
                org, sharer, viewer, label = ws['organization_id'], ws['owner_id'], uid, ws['owner_name'] + '/' + ws['name']
                if not permits_signaling(h.token(), uid, {'workspace_id': wid, 'sharer': sharer, 'organization_id': org}):
                    raise PermissionError('Your session cannot connect to this workspace.')
                if not db.query('SELECT 1 FROM organization_members WHERE user_id=$1::uuid AND organization_id=$2::uuid', [sharer, org]):
                    raise PermissionError('The workspace owner is no longer a member of this organization.')
                if not USER_SHARING() and not db.query('SELECT 1 FROM users WHERE id=$1::uuid AND rbac_roles && $2::text[]', [sharer, '{' + ','.join(admin_roles()) + '}']):
                    raise PermissionError('An administrator must enable user screen sharing in Chat settings.')
            else:
                if action == 'request_peer':
                    admin, error = h.user(admin=True)
                    if error:
                        return True
                if not permits_signaling(h.token(), uid):
                    raise PermissionError('Your session cannot start screen sharing.')
                if not can_share(user):
                    raise PermissionError('An administrator must enable user screen sharing in Chat settings.')
                peer = str(uuid.UUID(body.get('peer', '')))
                why = MAY_CHAT(user, peer)
                if why:
                    raise PermissionError(why)
                orgs = db.query('''SELECT a.organization_id::text, u.username,
                    u.rbac_roles && $3::text[] FROM organization_members a
                    JOIN organization_members b ON a.organization_id=b.organization_id
                    JOIN users u ON u.id=b.user_id AND NOT u.deleted AND u.status='active'
                    WHERE a.user_id=$1::uuid AND b.user_id=$2::uuid ORDER BY a.organization_id LIMIT 1''', [uid, peer, '{' + ','.join(admin_roles()) + '}'])
                if not orgs:
                    raise PermissionError('Screen sharing requires a shared organization.')
                org, sharer, viewer, label = orgs[0][0], uid, peer, user['username'] + ' desktop'
                if action == 'request_peer':
                    if not USER_SHARING() and orgs[0][2] != 't':
                        raise PermissionError('An administrator must enable user screen sharing in Chat settings.')
                    sharer, viewer, label = peer, uid, orgs[0][1] + ' desktop'
            if sharer == viewer:
                raise ValueError('Choose another user to share with.')
            if mode == 'dashboard':
                label = 'Coder dashboard'
            sid = str(uuid.uuid4())
            with db.transaction() as tx:
                tx.query('SELECT pg_advisory_xact_lock(731943, 1)')
                reconcile(tx, sharer)
                reconcile(tx, viewer)
                if tx.query("SELECT 1 FROM coder_ui_updates.screen_shares WHERE (sharer=$1::uuid OR viewer=$1::uuid OR sharer=$2::uuid OR viewer=$2::uuid) AND status != 'ended'", [sharer, viewer]):
                    raise ValueError('A participant already has a support session. End it before starting another.')
                tx.query('INSERT INTO coder_ui_updates.screen_shares(id, organization_id, sharer, viewer, workspace_id, label, mode) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7)', [sid, org, sharer, viewer, wid, label, mode])
            LOG(event='screen-share-requested', session=sid, organization=org, by=uid, sharer=sharer, viewer=viewer)
        else:
            sid = str(uuid.UUID(body.get('id', '')))
            # Do not hold a row lock while making a request to Coder's authorizer.
            accessible = sessions(db, uid, sid)
            if not accessible:
                raise PermissionError('This screen share is private to its participants.')
            if action != 'end' and not permits_signaling(h.token(), uid, accessible[0]):
                raise PermissionError('Your session cannot access this screen share.')
            with db.transaction() as tx:
                row = tx.query('SELECT row_to_json(s)::text FROM (SELECT * FROM coder_ui_updates.screen_shares WHERE id=$1::uuid FOR UPDATE) s', [sid])
                if not row:
                    raise LookupError('No such support session.')
                session = json.loads(row[0][0])
                authorize(session, uid)
                if session['status'] == 'ended':
                    h.send_json(200, {'session': sessions(db, uid, sid)[0]})
                    return True
                if action == 'end':
                    tx.query("UPDATE coder_ui_updates.screen_shares SET status='ended',offer=NULL,answer=NULL WHERE id=$1::uuid", [sid])
                    LOG(event='screen-share-ended', session=sid, organization=session['organization_id'], by=uid)
                elif action in ('offer', 'answer'):
                    role = 'sharer' if action == 'offer' else 'viewer'
                    if uid != session[role]:
                        raise PermissionError('Only the screen sharer can offer and only the viewer can answer.')
                    sdp = description(body, action)
                    if session[action]:
                        if session[action] != sdp:
                            h.send_json(409, {'error': 'This screen share is already connected in another browser or tab. End it before starting a new session.'})
                            return True
                    elif action == 'answer' and not session['offer']:
                        raise ValueError('Wait for the screen owner to share before answering.')
                    else:
                        tx.query("UPDATE coder_ui_updates.screen_shares SET " + action + "=$2, status='sharing',expires_at=LEAST(created_at+interval '1 hour',now()+interval '1 hour'),sharer_seen=COALESCE(sharer_seen,now()),viewer_seen=COALESCE(viewer_seen,now()) WHERE id=$1::uuid", [sid, sdp])
                        if action == 'offer':
                            LOG(event='screen-share-consented', session=sid, organization=session['organization_id'], by=uid)
                elif action == 'heartbeat':
                    field = 'sharer_seen' if uid == session['sharer'] else 'viewer_seen'
                    tx.query('UPDATE coder_ui_updates.screen_shares SET ' + field + '=now() WHERE id=$1::uuid', [sid])
                else:
                    raise ValueError('Unknown support action.')
        h.send_json(200, {'session': sessions(db, uid, sid)[0]})
    except PermissionError as error:
        h.send_json(403, {'error': str(error)})
    except LookupError as error:
        h.send_json(404, {'error': str(error)})
    except (ValueError, TypeError) as error:
        h.send_json(400, {'error': str(error)})
    except Exception as error:
        LOG(event='screen-share-failed', error=type(error).__name__)
        h.send_json(503, {'error': 'Screen sharing is temporarily unavailable.'})
    return True
