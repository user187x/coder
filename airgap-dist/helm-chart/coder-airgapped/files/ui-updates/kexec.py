"""A command in a pod's container through the Kubernetes exec API (a WebSocket, v4.channel.k8s.io: channel 0 stdin,
1 stdout, 2 stderr, 3 the status), with the platform service's own service account. Standard library only.

    code, out, err = kexec.exec_in(KUBE, "coder", pod, "dev", ["sh", "-c", "id -u"])
    kexec.exec_in(KUBE, ns, pod, "dev", ["python3", "-c", READ_N], stdin=data)   # the command reads len(data) bytes

v4 cannot close stdin: a command given stdin reads exactly the bytes it is told of, not up to an end of file.
"""
import base64
import json
import os
import socket
import struct
import urllib.parse


class Frames:
    """WebSocket frames from the server (unmasked), after the handshake's leftover bytes."""

    def __init__(self, sock, rest):
        self.sock, self.buf = sock, rest

    def _take(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise EOFError
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def next(self):
        """(opcode, payload), or None when the connection ends."""
        try:
            b0, b1 = self._take(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._take(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._take(8))[0]
            mask = self._take(4) if b1 & 0x80 else None
            data = self._take(n)
            if mask:
                data = bytes(c ^ mask[i % 4] for i, c in enumerate(data))
            return b0 & 0x0F, data
        except (EOFError, OSError):
            return None


def frame(payload, opcode=2):
    """A client frame (masked, as clients must)."""
    mask = os.urandom(4)
    n = len(payload)
    head = bytes([0x80 | opcode])
    if n < 126:
        head += bytes([0x80 | n])
    elif n < 65536:
        head += bytes([0x80 | 126]) + struct.pack(">H", n)
    else:
        head += bytes([0x80 | 127]) + struct.pack(">Q", n)
    return head + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(payload))


def exec_stream(kube, namespace, pod, container, command, on_stdout, timeout=30, stdin=None):
    """(exit code, stderr) of command (a list) in the pod's container, its stdout handed to on_stdout(bytes) as it
    comes (a dump of any size never sits in memory); stdin: bytes sent first (frames of at most 64 KiB). timeout: of
    each wait for data, not of the whole run."""
    query = urllib.parse.urlencode([("command", c) for c in command]
                                   + [("container", container), ("stdout", "true"), ("stderr", "true")]
                                   + ([("stdin", "true")] if stdin is not None else []))
    path = "/api/v1/namespaces/%s/pods/%s/exec?%s" % (namespace, pod, query)
    host = urllib.parse.urlsplit(kube.base)
    with open(kube.SA + "/token") as f:
        token = f.read().strip()
    raw = socket.create_connection((host.hostname, host.port or 443), timeout=timeout)
    sock = kube.ctx.wrap_socket(raw, server_hostname=host.hostname)
    err, status_raw, channel = b"", b"", None
    try:
        key = base64.b64encode(os.urandom(16)).decode()
        sock.sendall(("GET %s HTTP/1.1\r\nHost: %s\r\nAuthorization: Bearer %s\r\nUpgrade: websocket\r\n"
                      "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n"
                      "Sec-WebSocket-Protocol: v4.channel.k8s.io\r\n\r\n"
                      % (path, host.netloc, token, key)).encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                raise RuntimeError("exec: the API server closed the connection")
            buf += chunk
        head, rest = buf.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise RuntimeError("exec refused: %s" % head.split(b"\r\n")[0].decode(errors="replace"))
        if stdin:
            for i in range(0, len(stdin), 65536):
                sock.sendall(frame(b"\0" + stdin[i:i + 65536]))
        frames = Frames(sock, rest)
        while True:
            got = frames.next()
            if got is None or got[0] == 8:
                break
            op, data = got
            if op in (1, 2) and data:
                channel, data = data[0], data[1:]
            elif op != 0 or channel is None:
                continue
            if channel == 1:
                if data:
                    on_stdout(data)
            elif channel == 2:
                err = (err + data)[-65536:]
            elif channel == 3:
                status_raw += data
    finally:
        sock.close()
    status = {}
    if status_raw:
        try:
            status = json.loads(status_raw)
        except ValueError:
            status = {}
    code = 0
    if status.get("status") and status.get("status") != "Success":
        code = 1
        for cause in (status.get("details") or {}).get("causes") or []:
            if cause.get("reason") == "ExitCode":
                code = int(cause.get("message") or 1)
    return code, err.decode(errors="replace")


def exec_in(kube, namespace, pod, container, command, timeout=30, stdin=None):
    """(exit code, stdout, stderr) of command (a list) in the pod's container; stdin: bytes sent to it (in frames of
    at most 64 KiB) before its output is read."""
    out = []
    code, err = exec_stream(kube, namespace, pod, container, command, out.append, timeout=timeout, stdin=stdin)
    return code, b"".join(out).decode(errors="replace"), err
