"use strict";
(() => {
  const host = document.getElementById("terminal");
  if (!host || !window.Terminal) return;
  const status = document.getElementById("terminal-status");
  const disconnect = document.getElementById("terminal-disconnect");
  const term = new Terminal({
    cursorBlink: true, fontSize: 14, lineHeight: 1.25, fontFamily: "monospace",
    scrollback: 3000, screenReaderMode: true, disableStdin: true,
    theme: { background: "#10131b", foreground: "#ecedf0" }
  });
  term.open(host);
  const url = new URL(host.dataset.endpoint, location.origin);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  let ready = false, queued = 0;
  const send = bytes => {
    if (!ready || socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 128 * 1024) {
      status.textContent = "Input stalled. Reconnect to open a new shell.";
      socket.close(); return;
    }
    socket.send(bytes);
  };
  const fit = () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = "14px monospace";
    const cols = Math.max(2, Math.min(500, Math.floor((host.clientWidth - 20) / ctx.measureText("W").width)));
    const rows = Math.max(2, Math.min(500, Math.floor(host.clientHeight / 18)));
    term.resize(cols, rows);
    send(new Uint8Array([1, rows >> 8, rows & 255, cols >> 8, cols & 255]));
  };
  const input = term.onData(text => {
    const data = new TextEncoder().encode(text);
    for (let i = 0; i < data.length; i += 16384) {
      const bytes = new Uint8Array(1 + Math.min(16384, data.length - i));
      bytes.set(data.subarray(i, i + 16384), 1); send(bytes);
    }
  });
  socket.onmessage = event => {
    if (typeof event.data === "string") {
      if (event.data === "ready" && !ready) {
        ready = true; term.options.disableStdin = false;
        status.textContent = "Connected"; fit(); term.focus();
      } else if (event.data === "eof") {
        status.textContent = "Shell exited"; socket.close();
      } else socket.close();
      return;
    }
    queued += event.data.byteLength;
    if (queued > 1024 * 1024) { socket.close(); return; }
    const length = event.data.byteLength;
    term.write(new Uint8Array(event.data), () => { queued -= length; });
  };
  socket.onerror = () => { status.textContent = "Connection failed. Check permissions and agent terminal settings."; };
  socket.onclose = () => {
    ready = false; term.options.disableStdin = true; input.dispose(); resize.disconnect();
    disconnect.disabled = true;
    if (status.textContent === "Connected" || status.textContent === "Connecting…") status.textContent = "Disconnected. Reload to open a new shell.";
  };
  disconnect.onclick = () => socket.close();
  window.addEventListener("pagehide", () => socket.close(), { once: true });
  const resize = new ResizeObserver(fit); resize.observe(host); fit();
})();
