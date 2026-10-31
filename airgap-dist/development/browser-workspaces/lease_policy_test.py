import importlib.util
import pathlib
import unittest
spec = importlib.util.spec_from_file_location('lease_policy', pathlib.Path(__file__).with_name('lease-policy.py'))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)

class LeasePolicyTest(unittest.TestCase):
    def test_allowlist_and_blocklist(self):
        terms = {'no_root': True, 'sandbox_only': True, 'website_mode': 'allowlist', 'websites': ['example.com']}
        self.assertEqual(policy.browser_policy(terms)['URLBlocklist'], ['*'])
        self.assertEqual(policy.browser_policy(terms)['URLAllowlist'], ['example.com'])
        terms['website_mode'] = 'blocklist'
        self.assertEqual(policy.browser_policy(terms)['URLBlocklist'], ['example.com'])
        self.assertEqual(policy.browser_policy(terms)['URLAllowlist'], [])
        self.assertEqual(policy.browser_policy(terms)['DeveloperToolsAvailability'], 2)
        terms['no_root'] = False
        with self.assertRaises(ValueError): policy.browser_policy(terms)
    def test_invalid_and_empty_policies(self):
        self.assertIsNone(policy.browser_policy({}))
        for websites in [[], ['*'], ['javascript:alert(1)'], ['example.com/path']]:
            with self.assertRaises(ValueError): policy.browser_policy({'no_root': True, 'sandbox_only': True, 'website_mode': 'allowlist', 'websites': websites})
