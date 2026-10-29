"""Render the shipped startup scripts with independent app origins and validate shell syntax."""
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest

FILES = pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/charts/coder-workspace/files/dataflow'


@unittest.skipUnless(shutil.which('terraform'), 'Terraform required')
class DataflowOriginsTest(unittest.TestCase):
    def test_startup_scripts_use_app_hosts_and_root_api_paths(self):
        scripts = {}
        with tempfile.TemporaryDirectory() as directory:
            for app in ('nifi', 'airflow'):
                values = {'path': '/@owner/workspace.main/apps/nifi' if app == 'nifi' else '', 'access_host': app + '--main--workspace--owner.apps.example.com', 'scheme': 'https'}
                expression = 'jsonencode(templatefile(' + json.dumps(str(FILES / ('apache_' + app + '.sh'))) + ',' + json.dumps(values) + '))\n'
                rendered = subprocess.run(['terraform', 'console', '-no-color'], cwd=directory, input=expression, text=True, capture_output=True)
                self.assertEqual(rendered.returncode, 0, rendered.stderr)
                script = json.loads(json.loads(rendered.stdout))
                syntax = subprocess.run(['bash', '-n'], input=script, text=True, capture_output=True)
                self.assertEqual(syntax.returncode, 0, syntax.stderr)
                if app == 'airflow':
                    self.assertNotIn('/@', script)
                self.assertIn(values['access_host'], script)
                scripts[app] = script
        dataflow = (FILES / 'dataflow.tf').read_text()
        nifi_app = dataflow.split('resource "coder_app" "nifi" {', 1)[1].split('variable "apps_wildcard_host"', 1)[0]
        self.assertIn('subdomain = false', nifi_app)
        self.assertIn('path        = local.nifi_path', dataflow)
        self.assertIn('AIRFLOW_BASE=\'\'', scripts['airflow'])
        self.assertIn('BASE_URL=$ACCESS_SCHEME://$ACCESS_HOST$AIRFLOW_BASE', scripts['airflow'])
        self.assertIn("NIFI_PATH='/@owner/workspace.main/apps/nifi'", scripts['nifi'])
