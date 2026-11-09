"""Panel preferences remain scoped to their user and reject unsupported targets."""
import json
import unittest
from unittest.mock import Mock

from uistate import UIState


class PreferencesTest(unittest.TestCase):
    def setUp(self):
        self.pool = Mock()
        self.pool.query.return_value = []
        self.state = UIState(lambda: self.pool, Mock())
        self.state.ready = True

    def test_target_saved_for_the_calling_user(self):
        for target in ('chat', 'notes'):
            self.state.preferences('user-id', {'admin_notes_tray_target': target})
            parameters = self.pool.query.call_args_list[-2].args[1]
            self.assertEqual(parameters[0], 'user-id')
            self.assertEqual(json.loads(parameters[1]), {'admin_notes_tray_target': target})

    def test_invalid_target_is_not_saved(self):
        for target in ('other', None, True, {}, []):
            with self.subTest(target=target), self.assertRaises(ValueError):
                self.state.preferences('user-id', {'admin_notes_tray_target': target})
        self.pool.query.assert_not_called()

    def test_panel_text_color_is_a_hex_colour_or_none(self):
        self.state.preferences('user-id', {'panel_text_color': '#A1b2C3'})
        self.state.preferences('user-id', {'panel_text_color': None})
        for bad in ('red', '#abc', '#abcdef0', 7, True, {}):
            with self.subTest(colour=bad), self.assertRaises(ValueError):
                self.state.preferences('user-id', {'panel_text_color': bad})


if __name__ == '__main__':
    unittest.main()
