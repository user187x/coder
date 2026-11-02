#!/usr/bin/env python3
"""Fixed loopback registry relay for node-local workspace image references."""
import json
import pathlib
import select
import socket
import socketserver
import sys

sys.path.insert(0, '/usr/local/lib/coder-vm')
from vmprofile import validate_runtime


class Relay(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            with socket.create_connection(self.server.destination, timeout=10) as upstream:
                self.request.settimeout(30)
                sockets = (self.request, upstream)
                while True:
                    readable, _, _ = select.select(sockets, (), (), 30)
                    if not readable:
                        return
                    for source in readable:
                        data = source.recv(65536)
                        if not data:
                            return
                        (upstream if source is self.request else self.request).sendall(data)
        except OSError:
            return


if __name__ == '__main__':
    profile = validate_runtime(json.loads(pathlib.Path('/etc/coder-workspace/runtime.json').read_text()))
    with Relay(('127.0.0.1', 5000), Handler) as relay:
        relay.destination = ('coder-image-registry.' + profile['cluster_namespace'] + '.svc', 5000)
        relay.serve_forever()
