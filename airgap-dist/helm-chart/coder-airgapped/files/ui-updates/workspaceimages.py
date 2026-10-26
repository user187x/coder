"""Organization-scoped image switches through Coder lifecycle, preserving template and parameters."""
import json
import os
import re
import sqlite3
import threading
import time
import uuid

import workspacepower as power

FILE = os.environ.get('WORKSPACE_IMAGE_SWITCH_FILE', '/data/workspace-image-switches.sqlite')
ROUTE = re.compile(r'^/__coder-ui/api/organizations/([0-9a-f-]{36})/workspace-image-switch(?:/([0-9a-f-]{36}))?$')
RESTRICTED = LOG = None


def connect():
    os.makedirs(os.path.dirname(FILE) or '.', exist_ok=True)
    connection = sqlite3.connect(FILE, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def setup(restricted, log):
    global RESTRICTED, LOG
    RESTRICTED, LOG = restricted, log
    with connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS switches (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL)')
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS switch_active_workspace ON switches(workspace_id) WHERE status = 'running'")
        rows = db.execute("SELECT payload FROM switches WHERE status = 'running'").fetchall()
        for row in rows:
            operation = json.loads(row['payload'])
            operation.update(status='interrupted', error='The service restarted. Review the current workspace and restore its previous image if needed.')
            db.execute('UPDATE switches SET status=?, payload=? WHERE id=?', ('interrupted', json.dumps(operation), operation['id']))


def read(oid, operation_id):
    with connect() as db:
        row = db.execute('SELECT payload FROM switches WHERE id=? AND organization_id=?', (operation_id, oid)).fetchone()
    if not row:
        raise LookupError('Image switch not found.')
    return json.loads(row['payload'])


def update(operation, **fields):
    operation.update(fields)
    with connect() as db:
        db.execute('UPDATE switches SET status=?, payload=? WHERE id=? AND organization_id=?',
                   (operation['status'], json.dumps(operation), operation['id'], operation['organization_id']))


def allowed(token, oid, wid, expected=None):
    workspace = power.coder(token, 'GET', '/workspaces/' + wid)
    if workspace.get('organization_id') != oid:
        raise PermissionError('Workspace organization does not match.')
    power.permissions(token, [workspace], 'update')
    if RESTRICTED is None or RESTRICTED(wid):
        raise PermissionError('Workspace restriction policy blocks image switching.')
    if expected is not None and workspace['latest_build']['id'] != expected:
        raise ValueError('The workspace build changed. Review the new state before switching images.')
    return workspace


def parameters(token, workspace, image):
    version = workspace['latest_build']['template_version_id']
    schema = power.coder(token, 'GET', '/templateversions/%s/rich-parameters' % version)
    parameter = next((value for value in schema if value['name'] == 'workspace_image'), None)
    if not parameter or not parameter.get('mutable'):
        raise ValueError('This template must expose a mutable workspace_image parameter.')
    choices = {option['value'] for option in parameter.get('options') or []}
    if not isinstance(image, str) or image == 'custom' or image not in choices:
        raise ValueError('Choose an image offered by this template version. Update the template first to add another image.')
    previous = power.coder(token, 'GET', '/workspacebuilds/%s/parameters' % workspace['latest_build']['id'])
    current = next((value['value'] for value in previous if value['name'] == 'workspace_image'), parameter.get('default_value', 'template'))
    values = [dict(name=value['name'], value=image if value['name'] == 'workspace_image' else value['value']) for value in previous]
    if not any(value['name'] == 'workspace_image' for value in values):
        values.append(dict(name='workspace_image', value=image))
    return current, values


def start(token, user, oid, body):
    wid = power.identifier(body.get('workspace_id'))
    expected = power.identifier(body.get('build_id'))
    workspace = allowed(token, oid, wid, expected)
    status = workspace['latest_build']['status']
    if status not in ('running', 'stopped'):
        raise ValueError('Wait for the workspace build to finish before switching images.')
    image = body.get('image')
    previous, values = parameters(token, workspace, image)
    if image == previous:
        raise ValueError('That image is already selected.')
    operation = dict(id=str(uuid.uuid4()), organization_id=oid, workspace_id=wid, workspace_name=workspace['name'],
                     captured_build_id=expected, template_version_id=workspace['latest_build']['template_version_id'],
                     previous_image=previous, image=image, status='running', phase='reviewed', created_at=time.time(), by=user['username'])
    try:
        with connect() as db:
            db.execute('INSERT INTO switches VALUES (?,?,?,?,?)', (operation['id'], oid, wid, operation['status'], json.dumps(operation)))
    except sqlite3.IntegrityError:
        raise ValueError('Another image switch is already running for this workspace.') from None
    LOG(event='workspace-image-switch-requested', organization=oid, workspace=wid, operation=operation['id'], by=user['username'])
    threading.Thread(target=run, args=(token, operation, workspace, values), daemon=True).start()
    return operation


def wait(token, operation, build, deadline):
    while time.monotonic() < deadline:
        allowed(token, operation['organization_id'], operation['workspace_id'], build['id'])
        current = power.coder(token, 'GET', '/workspacebuilds/' + build['id'])
        status = current['job']['status']
        if status == 'succeeded':
            return
        if status in ('failed', 'canceled'):
            raise RuntimeError('Workspace build %s. Review its logs before restoring the previous image.' % status)
        time.sleep(1)
    raise RuntimeError('Image switch timed out. Review the workspace build before retrying.')


def run(token, operation, workspace, values):
    try:
        deadline = time.monotonic() + 600
        current = allowed(token, operation['organization_id'], operation['workspace_id'], operation['captured_build_id'])
        if current['latest_build']['status'] == 'running':
            update(operation, phase='stopping')
            stopped = power.coder(token, 'POST', '/workspaces/%s/builds' % current['id'], dict(transition='stop'))
            update(operation, stop_build_id=stopped['id'])
            wait(token, operation, stopped, deadline)
            expected = stopped['id']
        elif current['latest_build']['status'] == 'stopped':
            expected = current['latest_build']['id']
        else:
            raise ValueError('Workspace state changed before the switch began.')
        allowed(token, operation['organization_id'], current['id'], expected)
        update(operation, phase='starting')
        build = power.coder(token, 'POST', '/workspaces/%s/builds' % current['id'],
            dict(transition='start', template_version_id=operation['template_version_id'], rich_parameter_values=values))
        update(operation, start_build_id=build['id'])
        wait(token, operation, build, deadline)
        update(operation, status='complete', phase='built', finished_at=time.time())
        LOG(event='workspace-image-switch-complete', organization=operation['organization_id'], workspace=current['id'], operation=operation['id'])
    except Exception as error:
        update(operation, status='failed', phase='review-required', error=str(error)[:500], finished_at=time.time())
        LOG(event='workspace-image-switch-failed', organization=operation['organization_id'], workspace=operation['workspace_id'], operation=operation['id'], error=str(error)[:500])


def handle(h, method, path, query=''):
    match = ROUTE.fullmatch(path)
    if not match:
        return False
    try:
        user, error = h.user()
        if error:
            return True
        if not set(user.get('roles') or []) & power.ADMIN_ROLES:
            raise PermissionError('Image switching is for administrators only.')
        oid = power.identifier(match.group(1))
        if method == 'GET' and match.group(2):
            h.send_json(200, read(oid, power.identifier(match.group(2))))
        elif method == 'POST' and not match.group(2):
            if not h.csrf_ok():
                raise PermissionError('Request rejected (cross-site protection).')
            h.send_json(200, start(h.token(), user, oid, json.loads(h.body())))
        else:
            h.send_json(405, dict(error='Method not allowed.'))
    except PermissionError as error:
        h.send_json(403, dict(error=str(error)))
    except LookupError as error:
        h.send_json(404, dict(error=str(error)))
    except (ValueError, TypeError, KeyError) as error:
        h.send_json(400, dict(error=str(error)))
    except Exception:
        h.send_json(503, dict(error='Image switch could not be verified or recorded.'))
    return True
