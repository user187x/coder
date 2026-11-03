"""Admin requests for a worker in the host operator's enrolled organization."""
import json
import re
import time
import uuid

ROUTE = re.compile(r'/__coder-ui/api/organizations/([a-f0-9-]{36})/node-provisioning$')
NAME = 'coder-node-provisioning'


def handle(handler, method, path, kube, namespace, log):
    match = ROUTE.fullmatch(path)
    if not match:
        return False
    user, err = handler.user(admin=True)
    if err:
        return True

    def reply(status, data):
        handler.send_json(status, data)
        return True

    if method == 'POST' and not handler.csrf_ok():
        return reply(403, {'error': 'Cross-site request refused.'})
    target = '/api/v1/namespaces/%s/configmaps/%s' % (namespace, NAME)
    status, cm = kube.call('GET', target)
    if status == 404 and method == 'GET':
        return reply(200, {'online': False, 'profiles': [], 'operation': None})
    if status != 200:
        return reply(503, {'error': 'Cannot reach the node provisioning operator.'})
    data = cm.get('data', {})
    if data.get('organization_id') != match[1]:
        return reply(404, {'error': 'No node provisioning operator is enrolled for this organization.'})
    try:
        online = 0 <= time.time() - float(data.get('heartbeat', 0)) < 90
        profiles = json.loads(data.get('profiles', '[]'))
        operation = json.loads(data.get('operation', 'null'))
    except (TypeError, ValueError):
        return reply(503, {'error': 'Invalid operator state. Check the operator configuration.'})
    if method == 'GET':
        return reply(200, {'online': online, 'profiles': profiles, 'operation': operation})
    body = handler.body()
    if not isinstance(body, dict):
        return reply(400, {'error': 'Expected a worker creation request.'})
    try:
        request_id = str(uuid.UUID(body['id']))
    except (ValueError, KeyError, TypeError, AttributeError):
        return reply(400, {'error': 'A request ID is required.'})
    if operation and operation['id'] == request_id:
        return reply(200, operation)
    if not online:
        return reply(503, {'error': 'The operator is offline. Check its connection and try again.'})
    if body.get('previous') != (operation and operation['id']) or (operation and operation['phase'] in ('queued', 'provisioning')):
        return reply(409, {'error': 'A node request has changed. Refresh its status first.'})
    profile = next((p for p in profiles if p['id'] == body.get('profile')), None)
    if not profile:
        return reply(400, {'error': 'Select an available provider.'})
    operation = {'id': request_id, 'profile': profile['id'], 'organization_id': match[1], 'requestedBy': user['id'],
                 'created': int(time.time()), 'phase': 'queued', 'message': 'Waiting for the operator.'}
    status, _ = kube.call('PATCH', target, {'metadata': {'resourceVersion': cm['metadata']['resourceVersion']},
                          'data': {'operation': json.dumps(operation)}}, 'application/merge-patch+json')
    if status != 200:
        return reply(409 if status == 409 else 503, {'error': 'Request could not be recorded. Refresh and try again.'})
    log(event='node-requested', organization_id=match[1], user_id=user['id'], provider=profile['id'], request_id=request_id)
    return reply(202, operation)
