"""The raw VM apply may replace build intent but never supplies root readiness proof."""
import pathlib
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/charts/coder-workspace/files/workspace-vm.tf'


class ApplyBoundaryTest(unittest.TestCase):
    def test_forced_apply_is_conservative_and_excludes_protected_proof(self):
        text = SOURCE.read_text()
        resource = text[text.index('resource "kubectl_manifest" "workspace_vm"'):]
        body = resource[resource.index('yaml_body = jsonencode('):resource.index('\n  wait_for {')]
        self.assertRegex(resource, r'force_conflicts\s*=\s*true')
        self.assertRegex(body, r'runStrategy\s*=\s*"Halted"')
        self.assertIn('"platform.coder/build-id" = var.workspace_vm_build_id', body)
        self.assertIn('"platform.coder/desired-run-strategy"', body)
        self.assertNotIn('platform.coder/applied-profile', body)
        self.assertNotIn('starting:', body)
        self.assertNotIn('kubectl.kubernetes.io/last-applied-configuration', body)
        self.assertRegex(text, r'removed\s*\{\s*from\s*=\s*kubernetes_manifest.workspace_vm\s*lifecycle\s*\{\s*destroy\s*=\s*false')
