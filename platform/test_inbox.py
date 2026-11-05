"""Inbox deletion routes and ownership enforcement."""
import ast
import pathlib
import types
import unittest
import urllib.parse
import uuid
from unittest.mock import Mock


class InboxTest(unittest.TestCase):
    def handler(self, ids):
        source = ast.parse(pathlib.Path(__file__).with_name('ui-service.py').read_text())
        definition = next(node for node in source.body if isinstance(node, ast.ClassDef)
                          and any(isinstance(method, ast.FunctionDef) and method.name == 'clear_inbox' for method in node.body))
        methods = [node for node in definition.body if isinstance(node, ast.FunctionDef) and node.name in ('do_POST', 'clear_inbox')]
        pool = Mock()
        pool.query.return_value = [{'id': str(uuid.uuid4())}]
        scope = {'BASE': '/platform', 'urllib': urllib, 'uuid': uuid, 'LOGOS': types.SimpleNamespace(pool=pool),
                 'ADMIN_ROLES': {'owner'}, 'KUBE': Mock(), 'CODER_NAMESPACE': 'coder', 'log': Mock()}
        for name in ('imagebuilder', 'screenshare', 'clientcertificates', 'adminnotes', 'workspacemigration',
                     'workspacevolumes', 'nodeprovisioning', 'clusternet', 'provisioners', 'dr', 'quotaextras',
                     'workspacepower', 'workspacetunnels', 'sandbox', 'lockdown', 'safe'):
            scope[name] = types.SimpleNamespace(handle=Mock(return_value=False), handle_libraries=Mock(return_value=False))
        for method in methods:
            exec(compile(ast.Module(body=[method], type_ignores=[]), 'ui-service.py', 'exec'), scope)
        user_id = str(uuid.uuid4())
        handler = Mock()
        handler.path = '/platform/api/inbox/delete'
        handler.body.return_value = {'ids': ids}
        handler.csrf_ok.return_value = True
        handler.user.return_value = ({'id': user_id, 'username': 'caller'}, None)
        handler.clear_inbox = types.MethodType(scope['clear_inbox'], handler)
        handler.do_POST = types.MethodType(scope['do_POST'], handler)
        return handler, pool, user_id

    def test_selected_delete_reaches_handler_and_scopes_to_caller(self):
        notification = str(uuid.uuid4())
        handler, pool, user_id = self.handler([notification])
        handler.do_POST()
        sql, params = pool.query.call_args.args
        self.assertIn('user_id = $1::uuid AND id = ANY($2::uuid[])', sql)
        self.assertEqual(params, [user_id, '{' + notification + '}'])
        handler.send_json.assert_called_once_with(200, {'cleared': 1})

    def test_invalid_selection_does_not_delete(self):
        for ids in ([], ['invalid'], 'all', [str(uuid.uuid4())] * 101):
            with self.subTest(ids=ids):
                handler, pool, _ = self.handler(ids)
                handler.do_POST()
                pool.query.assert_not_called()
                self.assertEqual(handler.send_json.call_args.args[0], 400)

    def test_cross_site_request_does_not_delete(self):
        handler, pool, _ = self.handler([str(uuid.uuid4())])
        handler.csrf_ok.return_value = False
        handler.do_POST()
        pool.query.assert_not_called()
        self.assertEqual(handler.send_json.call_args.args[0], 403)

    def test_unauthenticated_request_does_not_delete(self):
        handler, pool, _ = self.handler([str(uuid.uuid4())])
        handler.user.return_value = (None, 'unauthenticated')
        handler.do_POST()
        pool.query.assert_not_called()


if __name__ == '__main__':
    unittest.main()
