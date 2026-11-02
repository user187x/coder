"""A small PostgreSQL client in pure Python (standard library only), enough for coder-ui-updates:

  - TLS when the server offers it (SSLRequest), verified against a CA file when one is given
  - SCRAM-SHA-256, MD5 and cleartext password authentication
  - the extended query protocol with text parameters ($1, $2 ...): values are always sent as parameters, never
    spliced into SQL. bytes are sent as bytea hex; results come back as str (bytea as bytes), None for NULL.

    db = Connection("postgresql://user:pass@host:5432/dbname", cafile="/etc/ca.crt")
    rows = db.query("SELECT id, name FROM t WHERE id = $1", [42])

A Connection is not thread-safe; Pool hands one out per call and reconnects after errors.
"""
import base64
import hashlib
import hmac
import os
import socket
import ssl
import struct
import threading
import urllib.parse


class PgError(Exception):
    def __init__(self, fields):
        self.fields = fields
        super().__init__("%s: %s" % (fields.get("C", "?"), fields.get("M", "error")))


class Connection:
    def __init__(self, url, cafile=None, timeout=10, application_name="coder-ui-updates"):
        u = urllib.parse.urlsplit(url)
        self.user = urllib.parse.unquote(u.username or "postgres")
        self.password = urllib.parse.unquote(u.password or "")
        self.database = (u.path or "/").lstrip("/") or self.user
        q = urllib.parse.parse_qs(u.query)
        self.sslmode = (q.get("sslmode") or ["prefer"])[0]
        self.sock = socket.create_connection((u.hostname, u.port or 5432), timeout=timeout)
        self.buf = b""
        self._tls(u.hostname, cafile)
        self._startup(application_name)

    # ---- low level
    def _send(self, kind, payload=b""):
        self.sock.sendall((kind or b"") + struct.pack("!I", len(payload) + 4) + payload)

    def _recv_exact(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("PostgreSQL closed the connection")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _read(self):
        kind = self._recv_exact(1)
        (length,) = struct.unpack("!I", self._recv_exact(4))
        return kind, self._recv_exact(length - 4)

    @staticmethod
    def _fields(payload):
        out = {}
        for part in payload.split(b"\0"):
            if part:
                out[chr(part[0])] = part[1:].decode(errors="replace")
        return out

    def _tls(self, host, cafile):
        if self.sslmode == "disable":
            return
        self.sock.sendall(struct.pack("!II", 8, 80877103))
        answer = self._recv_exact(1)
        if answer == b"S":
            ctx = ssl.create_default_context(cafile=cafile) if cafile and os.path.exists(cafile) else ssl.create_default_context()
            ctx.verify_flags &= ~getattr(ssl, "VERIFY_X509_STRICT", 0)
            if not (cafile and os.path.exists(cafile)):
                ctx.check_hostname = False          # sslmode=require semantics: encrypted, not verified
                ctx.verify_mode = ssl.CERT_NONE
            self.sock = ctx.wrap_socket(self.sock, server_hostname=host)
        elif self.sslmode in ("require", "verify-ca", "verify-full"):
            raise ConnectionError("the server does not offer TLS")

    def _startup(self, app):
        params = b"".join(k.encode() + b"\0" + v.encode() + b"\0" for k, v in
                          (("user", self.user), ("database", self.database), ("application_name", app), ("client_encoding", "UTF8")))
        self._send(None, struct.pack("!I", 196608) + params + b"\0")
        while True:
            kind, payload = self._read()
            if kind == b"R":
                self._auth(payload)
            elif kind == b"E":
                raise PgError(self._fields(payload))
            elif kind == b"Z":
                return

    def _auth(self, payload):
        (code,) = struct.unpack("!I", payload[:4])
        if code == 0:
            return
        if code == 3:  # cleartext
            self._send(b"p", self.password.encode() + b"\0")
        elif code == 5:  # md5
            salt = payload[4:8]
            inner = hashlib.md5(self.password.encode() + self.user.encode()).hexdigest().encode()
            self._send(b"p", b"md5" + hashlib.md5(inner + salt).hexdigest().encode() + b"\0")
        elif code == 10:  # SASL
            mechs = payload[4:].split(b"\0")
            if b"SCRAM-SHA-256" not in mechs:
                raise ConnectionError("no supported SASL mechanism (%s)" % mechs)
            self._scram()
        else:
            raise ConnectionError("unsupported authentication method %d" % code)

    def _scram(self):
        nonce = base64.b64encode(os.urandom(18)).decode()
        first_bare = "n=,r=" + nonce
        msg = ("n,," + first_bare).encode()
        self._send(b"p", b"SCRAM-SHA-256\0" + struct.pack("!I", len(msg)) + msg)
        kind, payload = self._read()
        if kind == b"E":
            raise PgError(self._fields(payload))
        server_first = payload[4:].decode()
        attrs = dict(p.split("=", 1) for p in server_first.split(","))
        if not attrs["r"].startswith(nonce):
            raise ConnectionError("SCRAM nonce mismatch")
        salted = hashlib.pbkdf2_hmac("sha256", self.password.encode(), base64.b64decode(attrs["s"]), int(attrs["i"]))
        client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
        stored_key = hashlib.sha256(client_key).digest()
        final_bare = "c=biws,r=" + attrs["r"]
        auth_message = ",".join((first_bare, server_first, final_bare)).encode()
        signature = hmac.new(stored_key, auth_message, hashlib.sha256).digest()
        proof = bytes(a ^ b for a, b in zip(client_key, signature))
        server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
        self.expected_server_signature = base64.b64encode(hmac.new(server_key, auth_message, hashlib.sha256).digest()).decode()
        self._send(b"p", (final_bare + ",p=" + base64.b64encode(proof).decode()).encode())
        kind, payload = self._read()
        if kind == b"E":
            raise PgError(self._fields(payload))
        final = payload[4:].decode()
        if dict(p.split("=", 1) for p in final.split(",")).get("v") != self.expected_server_signature:
            raise ConnectionError("SCRAM server signature mismatch")

    # ---- queries
    @staticmethod
    def _param(v):
        if v is None:
            return None
        if isinstance(v, (bytes, bytearray)):
            return b"\\x" + bytes(v).hex().encode()
        if isinstance(v, bool):
            return b"t" if v else b"f"
        return str(v).encode()

    def query(self, sql, params=()):
        """Runs one statement; returns a list of row tuples (empty for statements without rows)."""
        enc = [self._param(p) for p in params]
        parse = b"\0" + sql.encode() + b"\0" + struct.pack("!H", 0)
        bind = b"\0\0" + struct.pack("!H", 0) + struct.pack("!H", len(enc))
        for p in enc:
            bind += struct.pack("!i", -1) if p is None else struct.pack("!I", len(p)) + p
        bind += struct.pack("!H", 0)
        self._send(b"P", parse)
        self._send(b"B", bind)
        self._send(b"D", b"P\0")
        self._send(b"E", b"\0" + struct.pack("!I", 0))
        self._send(b"S")
        rows, types, error = [], [], None
        while True:
            kind, payload = self._read()
            if kind == b"T":
                (n,) = struct.unpack("!H", payload[:2])
                pos, types = 2, []
                for _ in range(n):
                    end = payload.index(b"\0", pos)
                    pos = end + 1
                    _table, _col, type_oid, _size, _mod, _fmt = struct.unpack("!IhIhiH", payload[pos:pos + 18])
                    types.append(type_oid)
                    pos += 18
            elif kind == b"D":
                (n,) = struct.unpack("!H", payload[:2])
                pos, row = 2, []
                for i in range(n):
                    (size,) = struct.unpack("!i", payload[pos:pos + 4])
                    pos += 4
                    if size < 0:
                        row.append(None)
                        continue
                    raw = payload[pos:pos + size]
                    pos += size
                    if i < len(types) and types[i] == 17 and raw.startswith(b"\\x"):  # bytea
                        row.append(bytes.fromhex(raw[2:].decode()))
                    else:
                        row.append(raw.decode())
                rows.append(tuple(row))
            elif kind == b"E":
                error = PgError(self._fields(payload))
            elif kind == b"Z":
                if error:
                    raise error
                return rows

    def close(self):
        try:
            self._send(b"X")
            self.sock.close()
        except OSError:
            pass


class Pool:
    """A few connections to one database, created on demand; a connection that failed is thrown away."""

    def __init__(self, url, cafile=None, size=4):
        self.url, self.cafile, self.size = url, cafile, size
        self.idle = []
        self.lock = threading.Lock()

    def query(self, sql, params=()):
        with self.lock:
            conn = self.idle.pop() if self.idle else None
        try:
            if conn is None:
                conn = Connection(self.url, self.cafile)
            rows = conn.query(sql, params)
        except PgError:
            with self.lock:
                if len(self.idle) < self.size:
                    self.idle.append(conn)
            raise
        except Exception:
            if conn:
                conn.close()
            raise
        with self.lock:
            if len(self.idle) < self.size:
                self.idle.append(conn)
            else:
                conn.close()
        return rows
