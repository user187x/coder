"""Authorization, duplicate submission and enrollment boundaries for worker creation."""
import time
import unittest
from unittest.mock import Mock
import nodeprovisioning

ORG = '621fbd56-3529-4396-8c9b-8089a93e457d'
PATH = '/__coder-ui/api/organizations/' + ORG + '/node-provisioning'


class TestNodeProvisioning(unittest.TestCase):
    def setUp(self):
        self.handler = Mock()
        self.handler.user.return_value = ({'id': 'admin'}, False)
        self.handler.csrf_ok.return_value = True
        self.handler.body.return_value = {'id': ORG, 'profile': 'local', 'previous': None}
        self.data = {'organization_id': ORG, 'heartbeat': str(time.time()), 'profiles': '[{"id":"local"}]'}
        self.cm = {'metadata': {'resourceVersion': '3'}, 'data': self.data}
        self.k = Mock()
        self.k.call.return_value = (200, self.cm)

    def send(self):
        self.assertTrue(nodeprovisioning.handle(self.handler, 'POST', PATH, self.k, 'coder', Mock()))
        return self.handler.send_json.call_args.args[0]

    def test_only_authorized_requests_can_enqueue(self):
        self.handler.user.return_value = (None, True)
        nodeprovisioning.handle(self.handler, 'POST', PATH, self.k, 'coder', Mock())
        self.handler.user.assert_called_once_with(admin=True)
        self.k.call.assert_not_called()
        self.handler.user.return_value = ({'id': 'admin'}, False)
        self.handler.csrf_ok.return_value = False
        self.assertEqual(self.send(), 403)
        self.k.call.assert_not_called()

    def test_other_organization_and_stale_operator_cannot_enqueue(self):
        self.data['organization_id'] = 'other'
        self.assertEqual(self.send(), 404)
        self.data['organization_id'] = ORG
        self.data['heartbeat'] = '0'
        self.assertEqual(self.send(), 503)

    def test_operation_cannot_be_overwritten(self):
        self.assertEqual(self.send(), 202)
        self.assertEqual(self.k.call.call_args.args[2]['metadata'], {'resourceVersion': '3'})
        self.data.update(self.k.call.call_args.args[2]['data'])
        self.assertEqual(self.send(), 200)
        self.handler.body.return_value['id'] = '1531a2ec-497d-43a3-885d-dccb5c6aa89d'
        self.assertEqual(self.send(), 409)
        self.assertEqual(sum(c.args[0] == 'PATCH' for c in self.k.call.call_args_list), 1)


if __name__ == '__main__':
    unittest.main()
