"""Panel preferences remain scoped to their user and reject unsupported targets."""
import json
import unittest
from unittest.mock import Mock

from uistate import UIState, navbar_layout


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
        self.state.preferences('user-id', {'panel_card_color': '#E4E7EB'})
        self.state.preferences('user-id', {'panel_card_color': None})
        for bad in ('grey', '#abc', 5):
            with self.subTest(card=bad), self.assertRaises(ValueError):
                self.state.preferences('user-id', {'panel_card_color': bad})
        for bad in ('red', '#abc', '#abcdef0', 7, True, {}):
            with self.subTest(colour=bad), self.assertRaises(ValueError):
                self.state.preferences('user-id', {'panel_text_color': bad})

    def test_navbar_strip_radius_and_switch(self):
        self.state.preferences('user-id', {'navbar_strip_radius': 0, 'navbar_strip_off': True})
        self.state.preferences('user-id', {'navbar_strip_radius': None, 'navbar_strip_off': None})
        self.state.preferences('user-id', {'navbar_resizable_width': 20})
        self.state.preferences('user-id', {'navbar_resizable_width': None})
        self.state.preferences('user-id', {'navbar_settings_side': 'right'})
        self.state.preferences('user-id', {'navbar_settings_side': None})
        self.state.preferences('user-id', {'settings_unread_glow': False})
        self.state.preferences('user-id', {'settings_unread_glow': None})
        self.state.preferences('user-id', {'settings_top_pinned': True})
        self.state.preferences('user-id', {'settings_face_hidden': True})
        for direction in ('up', 'down', None):
            self.state.preferences('user-id', {'settings_face_collapse_direction': direction})
        for bad in ({'navbar_strip_radius': 25}, {'navbar_strip_radius': -1}, {'navbar_strip_radius': 4.5},
                    {'navbar_strip_radius': True}, {'navbar_strip_off': 'yes'}, {'navbar_strip_off': 1},
                    {'admin_nav_in_navbar': 'yes'}, {'navbar_floating': 1}, {'navbar_resizable_width': 19},
                    {'navbar_resizable_width': 101}, {'navbar_resizable_width': 50.5}, {'navbar_resizable_width': True},
                    {'navbar_settings_side': 'top'}, {'navbar_settings_side': 1},
                    {'settings_unread_glow': 'on'}, {'settings_unread_glow': 0},
                    {'settings_top_pinned': 'yes'}, {'settings_face_hidden': 1},
                    {'settings_face_collapse_direction': 'left'}, {'settings_face_collapse_direction': True}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.state.preferences('user-id', bad)

    def test_chat_position_supports_interior_and_legacy_edge_offsets(self):
        for position in ({'edge': 'free', 'x': 0.25, 'y': 0.75}, {'edge': 'left', 'offset': 0.5}, None):
            self.state.preferences('user-id', {'chat_position': position})
            self.assertEqual(json.loads(self.pool.query.call_args_list[-2].args[1][1]),
                             {'chat_position': position})
        for invalid in ({'edge': 'free', 'x': 0.5}, {'edge': 'free', 'x': True, 'y': 0},
                        {'edge': 'free', 'x': 0.5, 'y': 1.01}, {'edge': 'top', 'offset': -1}):
            with self.subTest(position=invalid), self.assertRaises(ValueError):
                self.state.preferences('user-id', {'chat_position': invalid})

    def test_page_action_can_be_hidden_in_navbar_layout(self):
        order = ['logo', 'workspaces', 'banner', 'latency', 'hud', 'notifications', 'account', 'action']
        layout = {'order': order, 'hidden': ['action']}
        self.assertEqual(navbar_layout(layout), layout)
        self.assertEqual(navbar_layout({'order': order[:-1], 'hidden': []})['order'], order)
        with self.assertRaises(ValueError):
            navbar_layout({'order': order, 'hidden': ['banner']})

    def test_settings_menu_hidden(self):
        self.state.preferences('user-id', {'settings_menu_hidden': ['audit-logs', 'organizations']})
        self.state.preferences('user-id', {'settings_menu_hidden': None})
        for bad in (['audit-logs', 'audit-logs'], ['Accounts'], 'audit-logs', [1], ['x'] * 65):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.state.preferences('user-id', {'settings_menu_hidden': bad})


if __name__ == '__main__':
    unittest.main()
