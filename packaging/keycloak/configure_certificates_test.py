import copy
import unittest

from configure_certificates import ATTRIBUTES, FLOW, configure


class ConfigurationTest(unittest.TestCase):
    def provider(self, profile=None, users=None):
        self.calls = []
        self.profile = profile or {'attributes': []}
        self.executions = [{'id': 'x509', 'providerId': 'auth-x509-client-username-form', 'authenticationConfig': 'config'}]
        self.client = {'id': 'client', 'enabled': True, 'authenticationFlowBindingOverrides': {'direct_grant': 'other'}}

        def api(path, method='GET', body=None):
            self.calls.append((path, method, copy.deepcopy(body)))
            if method != 'GET':
                return None
            if path.startswith('coder/clients?'):
                return [self.client]
            if path == 'coder/clients/client':
                return self.client
            if path == 'coder/users/profile':
                return self.profile
            if path.startswith('coder/users?'):
                return users or []
            if path == 'coder/authentication/flows':
                return [{'alias': FLOW, 'id': 'flow'}]
            if path.endswith('/executions'):
                return self.executions
            raise AssertionError(path)
        return api

    def test_protects_identity_attributes_and_preserves_other_bindings(self):
        configure(self.provider(), 'coder', 'coder')
        self.assertEqual({a['name'] for a in self.profile['attributes']}, set(ATTRIBUTES))
        for attribute in self.profile['attributes']:
            self.assertEqual(attribute['permissions'], {'view': ['admin'], 'edit': ['admin']})
        self.assertEqual(self.client['authenticationFlowBindingOverrides'], {'direct_grant': 'other', 'browser': 'flow'})
        config = next(body['config'] for path, method, body in self.calls if path.endswith('/config/config'))
        self.assertEqual(config['x509-cert-auth.regular-expression'], '^(.+)$')
        self.assertEqual(config['x509-cert-auth.mapper-selection.user-attribute-name'], ATTRIBUTES[0])
        self.assertEqual(config['x509-cert-auth-crl-abort-if-non-updated'], 'true')
        self.assertEqual(self.executions[0]['requirement'], 'ALTERNATIVE')

    def test_refuses_unprotected_existing_bindings_before_mutating_provider(self):
        api = self.provider(users=[{'attributes': {ATTRIBUTES[0]: ['CN=admin']}}])
        with self.assertRaisesRegex(RuntimeError, 'audit'):
            configure(api, 'coder', 'coder')
        self.assertFalse(any(method != 'GET' for _, method, _ in self.calls))

    def test_retains_previously_protected_credentials(self):
        api = self.provider(profile={'attributes': [{'name': ATTRIBUTES[0], 'permissions': {'edit': ['admin']}}]},
                            users=[{'attributes': {ATTRIBUTES[0]: ['CN=admin']}}])
        configure(api, 'coder', 'coder')
        self.assertFalse(any('/users/' in path and path != 'coder/users/profile' and method != 'GET' for path, method, _ in self.calls))

    def test_optional_display_names_do_not_require_first_login_profile_completion(self):
        profile = {'attributes': [
            {'name': name, 'required': {'roles': ['user']}, 'validations': {'length': {'max': 255}}}
            for name in ('email', 'firstName', 'lastName')
        ]}
        configure(self.provider(profile=profile), 'coder', 'coder')
        attributes = {entry['name']: entry for entry in profile['attributes']}
        for name in ('firstName', 'lastName'):
            self.assertNotIn('required', attributes[name])
            self.assertEqual(attributes[name]['validations'], {'length': {'max': 255}})
        self.assertEqual(attributes['email']['required'], {'roles': ['user']})


if __name__ == '__main__':
    unittest.main()
