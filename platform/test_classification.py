"""Classification visibility preserves existing deployments and validates new settings."""
import ast
import pathlib
import re
import unittest


class ClassificationTest(unittest.TestCase):
    def setUp(self):
        source = ast.parse(pathlib.Path(__file__).with_name('ui-service.py').read_text())
        handler = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == 'Handler')
        clean = next(node for node in handler.body if isinstance(node, ast.FunctionDef) and node.name == 'clean_classification')
        clean.decorator_list = []
        scope = {'HEX_RE': re.compile(r'^#[0-9a-fA-F]{6}$')}
        exec(compile(ast.Module(body=[clean], type_ignores=[]), 'ui-service.py', 'exec'), scope)
        self.clean = scope['clean_classification']
        self.settings = {'enabled': True, 'text': 'UNCLASSIFIED', 'height': 24,
                         'background': '#007a33', 'color': '#ffffff'}

    def test_legacy_settings_show_on_sign_in(self):
        self.assertTrue(self.clean(self.settings)['showOnLogin'])

    def test_sign_in_can_be_disabled_without_disabling_dashboard(self):
        result = self.clean({**self.settings, 'showOnLogin': False})
        self.assertTrue(result['enabled'])
        self.assertFalse(result['showOnLogin'])

    def test_requires_boolean_visibility(self):
        for value in ('false', None, 0, {}, []):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.clean({**self.settings, 'showOnLogin': value})


if __name__ == '__main__':
    unittest.main()
