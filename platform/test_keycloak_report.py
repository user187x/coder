"""Keycloak diagnostics follow the deployed issuer and effective browser flow."""
import runpy
import unittest
from pathlib import Path
from unittest.mock import Mock, call, patch


service = runpy.run_path(str(Path(__file__).with_name("ui-service.py")))


class KeycloakReportTest(unittest.TestCase):
    def test_configured_issuer_takes_precedence_over_saved_and_discovered_urls(self):
        settings_for = service["kc_settings"]
        env = {
            "CODER_OIDC_ISSUER_URL": {"value": "https://keycloak.example.test/auth/realms/coder"},
            "CODER_OIDC_IGNORE_EMAIL_VERIFIED": {"value": "false"},
            "CODER_OIDC_USERNAME_FIELD": {"value": "username"},
        }
        store = Mock(get_setting=Mock(return_value={
            "keycloakUrl": "https://older.example.test",
            "ignoreEmailVerified": True,
            "usernameField": "stale-claim",
        }))
        with patch.dict(settings_for.__globals__, {
            "STORE": store,
            "keycloak_url_from_cluster": lambda: "https://discovered.example.test",
        }):
            settings, discovered = settings_for(env)
            fallback, _ = settings_for({})

        self.assertEqual(settings["keycloakUrl"], "https://keycloak.example.test/auth")
        self.assertEqual(settings["realm"], "coder")
        self.assertFalse(settings["ignoreEmailVerified"])
        self.assertEqual(settings["usernameField"], "username")
        self.assertEqual(discovered, "https://discovered.example.test")
        self.assertEqual(fallback["keycloakUrl"], "https://older.example.test")

    def test_reports_the_client_override_and_preserves_its_certificate_flow(self):
        check_flow = service["certificate_flow_report"]
        kc = Mock()
        kc.api.side_effect = [
            [{"id": "realm-flow", "alias": "browser"}, {"id": "client-flow", "alias": "device certificate"}],
            [{"providerId": "auth-x509-client-username-form", "requirement": "REQUIRED", "level": 0}],
        ]
        checks, settings = [], {"flowAlias": "x509-browser"}
        check_flow(checks, kc, "/coder", {"browserFlow": "browser"},
                   {"authenticationFlowBindingOverrides": {"browser": "client-flow"}}, settings)

        self.assertEqual(kc.api.call_args_list, [
            call("GET", "/coder/authentication/flows"),
            call("GET", "/coder/authentication/flows/device%20certificate/executions"),
        ])
        self.assertEqual(checks[0]["status"], "ok")
        self.assertEqual(checks[0]["current"], "device certificate")
        self.assertEqual(settings["flowAlias"], "device certificate")

    def test_realm_browser_flow_ignores_certificate_steps_under_disabled_subflows(self):
        check_flow = service["certificate_flow_report"]
        kc = Mock()
        kc.api.side_effect = [
            [{"id": "realm-flow", "alias": "browser"}],
            [
                {"requirement": "DISABLED", "level": 0},
                {"providerId": "auth-x509-client-username-form", "requirement": "REQUIRED", "level": 1},
            ],
        ]
        checks, settings = [], {"flowAlias": "x509-browser"}
        check_flow(checks, kc, "/coder", {"browserFlow": "browser"}, {}, settings)

        kc.api.assert_called_with("GET", "/coder/authentication/flows/browser/executions")
        self.assertEqual(checks[0]["status"], "info")
        self.assertEqual(settings["flowAlias"], "x509-browser")


if __name__ == "__main__":
    unittest.main()
