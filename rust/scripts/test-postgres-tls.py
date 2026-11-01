#!/usr/bin/env python3
"""Test the PostgreSQL client through a real mutual-TLS endpoint and existing test DB."""
import os
from pathlib import Path
import select
import socket
import socketserver
import ssl
import subprocess
import tempfile
import threading
from urllib.parse import urlsplit, urlunsplit


def main():
    upstream = urlsplit(os.environ["CODER_TEST_DATABASE_URL"])
    with tempfile.TemporaryDirectory(prefix="coder-postgres-tls-") as directory:
        root = Path(directory)

        def openssl(*args):
            subprocess.run(["openssl", *args], cwd=root, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key",
                "-out", "ca.crt", "-subj", "/CN=Coder-Test-CA", "-days", "1")
        for name in ("server", "client"):
            openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", f"{name}.key",
                    "-out", f"{name}.csr", "-subj", f"/CN={name}")
            (root / f"{name}.ext").write_text(
                "basicConstraints=CA:FALSE\n" +
                ("extendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n"
                 if name == "server" else "extendedKeyUsage=clientAuth\n"))
            openssl("x509", "-req", "-in", f"{name}.csr", "-CA", "ca.crt", "-CAkey", "ca.key",
                    "-CAcreateserial", "-out", f"{name}.crt", "-days", "1", "-extfile", f"{name}.ext")
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(root / "server.crt", root / "server.key")
        context.load_verify_locations(root / "ca.crt")
        context.verify_mode = ssl.CERT_REQUIRED

        class Proxy(socketserver.BaseRequestHandler):
            def handle(self):
                self.request.settimeout(10)
                try:
                    request = b""
                    while len(request) < 8:
                        data = self.request.recv(8 - len(request))
                        if not data:
                            return
                        request += data
                    if request != bytes.fromhex("0000000804d2162f"):
                        return
                    self.request.sendall(b"S")
                    with context.wrap_socket(self.request, server_side=True) as client:
                        with socket.create_connection((upstream.hostname, upstream.port or 5432), 10) as database:
                            while True:
                                readable, _, _ = select.select([client, database], [], [], 10)
                                if not readable:
                                    return
                                for source in readable:
                                    data = source.recv(32768)
                                    if not data:
                                        return
                                    (database if source is client else client).sendall(data)
                except (OSError, ssl.SSLError):
                    # Rejected certificate/hostname checks deliberately interrupt TLS.
                    return

        class Server(socketserver.ThreadingTCPServer):
            daemon_threads = True

        with Server(("127.0.0.1", 0), Proxy) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            userinfo = upstream.netloc.rsplit("@", 1)[0] + "@" if "@" in upstream.netloc else ""
            url = urlunsplit((upstream.scheme, f"{userinfo}localhost:{server.server_address[1]}",
                              upstream.path, upstream.query, ""))
            environment = {**os.environ,
                           "CODER_TEST_POSTGRES_TLS_URL": url,
                           "CODER_TEST_POSTGRES_TLS_CA": str(root / "ca.crt"),
                           "CODER_TEST_POSTGRES_CLIENT_CERT": str(root / "client.crt"),
                           "CODER_TEST_POSTGRES_CLIENT_KEY": str(root / "client.key")}
            try:
                result = subprocess.run(["cargo", "test", "-p", "coder-server", "--test", "postgres",
                                         "--locked", "--", "--ignored", "postgres_tls_verifies"],
                                        cwd=Path(__file__).resolve().parents[1], env=environment)
            finally:
                server.shutdown()
                thread.join()
            return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
