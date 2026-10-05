"""Live channel for the Coder banner: a small WebSocket publish/subscribe hub (standard library only).

Every open Coder tab subscribes to  wss://<coder host>/__banner/live . The hub

  * sends the current banner the moment a tab connects (so a reconnect always catches up),
  * pushes every change to all subscribers the instant an admin publishes, hides, resets or re-shows it,
  * sends a heartbeat so a tab can tell the connection is alive, and drops connections that stop answering,
  * re-reads the stored banner every few seconds, so edits made outside the admin page (`kubectl edit`, another
    replica) are pushed as well.

It runs an asyncio event loop in its own thread, next to the threaded HTTP server that handles the admin page
and API, so thousands of idle sockets cost little (no thread per connection). The banner is public content, so
subscribing needs no login; the handshake only insists on a same-origin browser (Origin must match Host).

Messages are JSON text frames:
    server -> client   {"type": "banner", "banner": {...same object as banner.json...}}
                       {"type": "hb"}                                      (every heartbeat interval)
    client -> server   nothing is required; pongs to the server's pings are handled by the browser itself.
"""
import asyncio
import base64
import hashlib
import json
import sys
import threading
import time
from urllib.parse import urlsplit

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
LIVE_PATH = "/__banner/live"
MAX_INBOUND = 1024  # a subscriber has nothing to say; refuse anything bigger than a pong/close/tiny message


def log(**kv):
    sys.stderr.write(json.dumps(kv, sort_keys=True) + "\n")
    sys.stderr.flush()


def frame(opcode, payload=b""):
    """One unfragmented, unmasked server->client WebSocket frame."""
    n = len(payload)
    if n < 126:
        head = bytes([0x80 | opcode, n])
    elif n < 65536:
        head = bytes([0x80 | opcode, 126]) + n.to_bytes(2, "big")
    else:
        head = bytes([0x80 | opcode, 127]) + n.to_bytes(8, "big")
    return head + payload


def close_frame(code, reason=""):
    return frame(0x8, code.to_bytes(2, "big") + reason.encode()[:100])


class Client:
    __slots__ = ("writer", "queue", "last_seen", "closing")

    def __init__(self, writer, loop):
        self.writer = writer
        self.queue = asyncio.Queue(maxsize=16)  # a subscriber that falls this far behind is dropped
        self.last_seen = loop.time()
        self.closing = False


class Hub:
    def __init__(self, banner, port, max_clients=5000, heartbeat=20, stale_after=70, watch_every=5):
        self.banner = banner  # provides .public(): the current banner as a dict
        self.port = port
        self.max_clients = max_clients
        self.heartbeat = heartbeat
        self.stale_after = stale_after
        self.watch_every = watch_every
        self.count = 0  # subscribers right now (read by other threads)
        self.loop = None
        self.thread = None
        self.ready = threading.Event()
        self.clients = set()
        self.latest = None  # the last banner message sent (JSON text)

    # ------------------------------------------------------------------ lifecycle (called from the HTTP side)
    def start(self):
        self.thread = threading.Thread(target=self._run, name="live-hub", daemon=True)
        self.thread.start()
        if not self.ready.wait(10):
            raise RuntimeError("live hub did not start")

    def alive(self):
        return self.ready.is_set() and self.thread is not None and self.thread.is_alive()

    def publish(self, banner):
        """Push a banner to every subscriber. Thread-safe. Returns how many subscribers it was sent to."""
        message = json.dumps({"type": "banner", "banner": banner})
        self.loop.call_soon_threadsafe(self._broadcast, message)
        return self.count

    # ------------------------------------------------------------------ event loop
    def _run(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        try:
            self.loop.run_until_complete(self._serve())
        except Exception as e:  # /healthz reports the hub as dead, so Kubernetes restarts the pod
            log(event="live-hub-crashed", error=str(e))
        finally:
            self.ready.clear()

    async def _serve(self):
        server = await asyncio.start_server(self._client, "0.0.0.0", self.port, limit=8192, backlog=1024)
        await self._refresh()
        self.loop.create_task(self._heartbeat_loop())
        self.loop.create_task(self._watch_loop())
        self.ready.set()
        log(event="live-listening", port=self.port, max_clients=self.max_clients, heartbeat=self.heartbeat)
        async with server:
            await server.serve_forever()

    async def _refresh(self):
        """Read the stored banner (may touch the Kubernetes API, so keep it off the event loop)."""
        banner = await self.loop.run_in_executor(None, self.banner.public)
        message = json.dumps({"type": "banner", "banner": banner})
        changed = message != self.latest
        if changed:
            first = self.latest is None
            self.latest = message
            if not first:
                self._broadcast(message)
        return changed

    def _broadcast(self, message):
        self.latest = message
        data = frame(0x1, message.encode())
        for client in list(self.clients):
            self._send(client, data)

    def _send(self, client, data):
        if client.closing:
            return
        try:
            client.queue.put_nowait(data)
        except asyncio.QueueFull:
            self._drop(client, "too slow")

    def _drop(self, client, reason):
        if not client.closing:
            client.closing = True
            log(event="live-drop", reason=reason)
            client.writer.close()

    async def _watch_loop(self):
        while True:
            await asyncio.sleep(self.watch_every)
            try:
                await self._refresh()
            except Exception as e:
                log(event="live-refresh-failed", error=str(e))

    async def _heartbeat_loop(self):
        hb = frame(0x1, b'{"type": "hb"}')
        ping = frame(0x9, b"")
        while True:
            await asyncio.sleep(self.heartbeat)
            now = self.loop.time()
            for client in list(self.clients):
                if now - client.last_seen > self.stale_after:
                    self._drop(client, "no answer to pings")
                else:
                    self._send(client, hb)
                    self._send(client, ping)

    # ------------------------------------------------------------------ one subscriber
    @staticmethod
    async def _reject(writer, status, reason):
        body = reason.encode()
        writer.write(
            b"HTTP/1.1 %d %s\r\nContent-Type: text/plain\r\nContent-Length: %d\r\nConnection: close\r\n\r\n"
            % (status, reason.encode(), len(body))
            + body
        )
        try:
            await writer.drain()
        except Exception:
            pass
        writer.close()

    async def _client(self, reader, writer):
        client = None
        sender = None
        try:
            try:
                head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 10)
            except (asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError, ConnectionError):
                writer.close()
                return
            lines = head.decode("latin-1").split("\r\n")
            parts = lines[0].split(" ")
            headers = {}
            for line in lines[1:]:
                if ":" in line:
                    k, v = line.split(":", 1)
                    headers[k.strip().lower()] = v.strip()

            if len(parts) < 2 or parts[0] != "GET" or urlsplit(parts[1]).path != LIVE_PATH:
                return await self._reject(writer, 404, "Not Found")
            if "websocket" not in headers.get("upgrade", "").lower() or "upgrade" not in headers.get("connection", "").lower():
                return await self._reject(writer, 426, "Upgrade Required")
            key = headers.get("sec-websocket-key", "")
            if headers.get("sec-websocket-version") != "13" or not key:
                return await self._reject(writer, 400, "Bad Request")
            origin = headers.get("origin")
            if origin and urlsplit(origin).netloc != headers.get("host"):
                return await self._reject(writer, 403, "Forbidden")
            if len(self.clients) >= self.max_clients:
                return await self._reject(writer, 503, "Too many subscribers")

            accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
            writer.write(
                ("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                 "Sec-WebSocket-Accept: %s\r\n\r\n" % accept).encode()
            )
            client = Client(writer, self.loop)
            self.clients.add(client)
            self.count = len(self.clients)
            if self.latest is None:
                await self._refresh()
            self._send(client, frame(0x1, self.latest.encode()))  # catch up immediately
            sender = self.loop.create_task(self._sender(client))
            await self._receive(reader, client)
        except (asyncio.IncompleteReadError, ConnectionError, asyncio.CancelledError):
            pass
        except Exception as e:
            log(event="live-client-error", error=str(e))
        finally:
            if client is not None:
                if not client.closing:  # ended by us or the peer politely: let a queued close frame go out first
                    try:
                        await asyncio.wait_for(client.queue.join(), 1)
                    except Exception:
                        pass
                client.closing = True
                self.clients.discard(client)
                self.count = len(self.clients)
            if sender is not None:
                sender.cancel()
            try:
                writer.close()
            except Exception:
                pass

    async def _sender(self, client):
        try:
            while True:
                data = await client.queue.get()
                client.writer.write(data)
                await asyncio.wait_for(client.writer.drain(), 10)
                client.queue.task_done()
        except Exception:
            self._drop(client, "write failed")

    async def _receive(self, reader, client):
        """Read frames the browser sends (pongs, pings, close). Anything else is ignored or refused."""
        while True:
            b1, b2 = await reader.readexactly(2)
            opcode = b1 & 0x0F
            length = b2 & 0x7F
            if length == 126:
                length = int.from_bytes(await reader.readexactly(2), "big")
            elif length == 127:
                length = int.from_bytes(await reader.readexactly(8), "big")
            if not b2 & 0x80:  # browsers must mask what they send (RFC 6455 5.1)
                self._send(client, close_frame(1002, "unmasked frame"))
                return
            if length > MAX_INBOUND:
                self._send(client, close_frame(1009, "message too big"))
                return
            mask = await reader.readexactly(4)
            payload = bytes(c ^ mask[i % 4] for i, c in enumerate(await reader.readexactly(length)))
            client.last_seen = self.loop.time()
            if opcode == 0x8:  # close: echo it and finish
                self._send(client, close_frame(1000))
                return
            if opcode == 0x9:  # ping -> pong
                self._send(client, frame(0xA, payload))
            elif opcode not in (0x0, 0x1, 0x2, 0xA):
                self._send(client, close_frame(1002, "unsupported opcode"))
                return
