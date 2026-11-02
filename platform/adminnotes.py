"""Organization-scoped private and shared administrator notes in PostgreSQL."""
import json
import re
import threading
import uuid

import workspacevolumes as volumes

ROUTE = re.compile(r'^/__coder-ui/api/organizations/([^/]+)/admin-notes$')
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
                tx.query('SELECT pg_advisory_xact_lock(731944, 0)')
                tx.query('''CREATE TABLE IF NOT EXISTS coder_ui_updates.admin_notes (
                    id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                    author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 10000),
                    shared boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1,
                    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())''')
                tx.query('CREATE INDEX IF NOT EXISTS admin_notes_organization ON coder_ui_updates.admin_notes(organization_id, updated_at DESC)')
                tx.query('''CREATE TABLE IF NOT EXISTS coder_ui_updates.admin_note_reads (
                    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                    note_id uuid NOT NULL REFERENCES coder_ui_updates.admin_notes(id) ON DELETE CASCADE,
                    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    revision integer NOT NULL CHECK (revision > 0), PRIMARY KEY(note_id, user_id))''')
            READY = True
    return db


def notes(db, organization, author):
    rows = db.query('''SELECT row_to_json(n)::text FROM (
        SELECT n.id, n.organization_id, n.author_id, u.username AS author_name, n.text, n.shared,
            n.revision, n.created_at, n.updated_at, n.author_id=$2::uuid AS can_edit,
            n.shared AND n.author_id<>$2::uuid AND COALESCE(r.revision,0)<n.revision AS unread
        FROM coder_ui_updates.admin_notes n JOIN users u ON u.id=n.author_id
        LEFT JOIN coder_ui_updates.admin_note_reads r ON r.note_id=n.id
            AND r.organization_id=n.organization_id AND r.user_id=$2::uuid
        WHERE n.organization_id=$1::uuid AND (n.author_id=$2::uuid OR n.shared)
        ORDER BY n.updated_at DESC, n.id) n''', [organization, author])
    return [json.loads(row[0]) for row in rows]


def handle(h, method, path):
    match = ROUTE.fullmatch(path)
    if not match:
        return False
    if method == 'POST' and not h.csrf_ok():
        h.send_json(403, {'error': 'Request rejected (cross-site protection).'})
        return True
    user, error = h.user(admin=True)
    if error:
        return True
    try:
        organization = str(uuid.UUID(match[1]))
        status, _ = volumes.coder(h.token(), 'GET', '/api/v2/organizations/' + organization)
        if status != 200:
            if status >= 500:
                raise RuntimeError('Organization authorization is unavailable.')
            raise PermissionError('You cannot access notes in this organization.')
        db, author = database(), user['id']
        if method == 'GET':
            h.send_json(200, {'notes': notes(db, organization, author)})
            return True
        status, permissions = volumes.coder(h.token(), 'POST', '/api/v2/authcheck', {'checks': {
            'notes_write': {'action': 'update', 'object': {
                'resource_type': 'organization', 'organization_id': organization}}}})
        if status != 200 or not isinstance(permissions, dict) or permissions.get('notes_write') is not True:
            raise PermissionError('Your session cannot change administrator notes in this organization.')
        body = volumes.read_json(h)
        action = body.get('action')
        if action not in ('create', 'update', 'delete', 'read'):
            raise ValueError('Unknown note action.')
        if action in ('create', 'update'):
            text, shared = body.get('text'), body.get('shared', False)
            if not isinstance(text, str) or not 1 <= len(text.strip()) <= 10000:
                raise ValueError('Enter a note between 1 and 10,000 characters.')
            if type(shared) is not bool:
                raise ValueError('Invalid note sharing setting.')
        if action == 'create':
            note_id = str(uuid.uuid4())
            db.query('''INSERT INTO coder_ui_updates.admin_notes(id, organization_id, author_id, text, shared)
                VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::boolean)''', [note_id, organization, author, text.strip(), shared])
        else:
            note_id = str(uuid.UUID(body.get('id', '')))
            revision = body.get('revision')
            if type(revision) is not int or revision < 1:
                raise ValueError('Reload this note before changing it.')
            with db.transaction() as tx:
                row = tx.query('''SELECT revision FROM coder_ui_updates.admin_notes
                    WHERE id=$1::uuid AND organization_id=$2::uuid
                    AND (author_id=$3::uuid OR ($4::boolean AND shared)) FOR UPDATE''',
                    [note_id, organization, author, action == 'read'])
                if not row:
                    raise LookupError('This note was removed or is not accessible.')
                current_revision = int(row[0][0])
                if revision > current_revision or (action != 'read' and revision != current_revision):
                    h.send_json(409, {'error': 'This note changed elsewhere. Cancel and reopen it to load the latest version.'})
                    return True
                if action == 'read':
                    tx.query('''INSERT INTO coder_ui_updates.admin_note_reads(organization_id,note_id,user_id,revision)
                        VALUES($1::uuid,$2::uuid,$3::uuid,$4::integer)
                        ON CONFLICT(note_id,user_id) DO UPDATE SET
                        revision=GREATEST(admin_note_reads.revision,EXCLUDED.revision)''',
                        [organization, note_id, author, revision])
                elif action == 'delete':
                    tx.query('DELETE FROM coder_ui_updates.admin_notes WHERE id=$1::uuid AND organization_id=$2::uuid AND author_id=$3::uuid', [note_id, organization, author])
                else:
                    tx.query('''UPDATE coder_ui_updates.admin_notes SET text=$4, shared=$5::boolean,
                        revision=revision+1, updated_at=now() WHERE id=$1::uuid AND organization_id=$2::uuid AND author_id=$3::uuid''',
                        [note_id, organization, author, text.strip(), shared])
        LOG(event='admin-note-' + action, note=note_id, organization=organization, by=author)
        h.send_json(200, {'notes': notes(db, organization, author)})
    except (ValueError, TypeError, AttributeError) as error:
        h.send_json(400, {'error': str(error)})
    except PermissionError as error:
        h.send_json(403, {'error': str(error)})
    except LookupError as error:
        h.send_json(404, {'error': str(error)})
    except Exception as error:
        LOG(event='admin-notes-failed', error=str(error)[:200])
        h.send_json(503, {'error': 'Administrator notes are temporarily unavailable. Try again.'})
    return True
