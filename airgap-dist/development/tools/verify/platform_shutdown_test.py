"""A real HTTP process exits promptly on SIGTERM without requiring SIGKILL."""
import subprocess
import sys
import unittest
import urllib.request
from platform_unit_test import SRC


class PlatformShutdownTest(unittest.TestCase):
    def test_sigterm_stops_serving(self):
        child = """
import importlib.util, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, sys.argv[1])
spec = importlib.util.spec_from_file_location('ui', sys.argv[1] + '/ui-service.py')
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
print(server.server_port, flush=True)
ui.serve_until_stopped(server)
"""
        with subprocess.Popen([sys.executable, '-u', '-c', child, SRC], stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True) as process:
            try:
                port = int(process.stdout.readline())
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=3) as response:
                    self.assertEqual(response.status, 200)
                process.terminate()
                self.assertEqual(process.wait(timeout=3), 0)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    unittest.main()
