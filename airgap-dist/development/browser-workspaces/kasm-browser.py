#!/usr/bin/env python3
"""Private Coder app gateway for KasmVNC, audio and owner certificate import."""
import base64
import hashlib
import hmac
import http.client
import http.server
import json
import os
import pathlib
import re
import secrets
import select
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request

HOME = pathlib.Path(os.environ['HOME'])
OWNER = os.environ['WORKSPACE_OWNER']
CSRF = secrets.token_urlsafe(32)
PASSWORD = os.environ.get('VNC_PW', '')
AUTH = 'Basic ' + base64.b64encode(('kasm_user:' + PASSWORD).encode()).decode()
LOCK = threading.Lock()
STATUS = {'state': 'checking', 'message': 'Checking your saved certificate.'}
DB = HOME / '.pki/nssdb'
CERT_DIR = HOME / '.cert'
BROWSER = pathlib.Path('/usr/bin/google-chrome')
PROCESS = None
INSTALLED_DIGEST = None


def certificate_path():
    saved = CERT_DIR / (OWNER + '.p12')
    return saved if saved.is_file() else CERT_DIR / 'browser-upload.p12'


def import_certificate(path, password):
    global INSTALLED_DIGEST
    DB.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='browser-certificate-') as directory:
        key = pathlib.Path(directory) / 'password'
        key.write_text(password + '\n')
        key.chmod(0o600)
        if not (DB / 'cert9.db').exists():
            subprocess.run(['certutil', '-N', '-d', 'sql:' + str(DB), '--empty-password'], check=True, capture_output=True)
        result = subprocess.run(['pk12util', '-i', str(path), '-d', 'sql:' + str(DB), '-K', '', '-w', str(key)], capture_output=True)
        if result.returncode:
            raise ValueError('The certificate could not be unlocked. Check its password and try again.')
        INSTALLED_DIGEST = hashlib.sha256(path.read_bytes()).digest()


def relaunch():
    global PROCESS
    if os.environ.get('BROWSER_MODE') == 'certificates':
        with urllib.request.urlopen('http://127.0.0.1:8090/control', timeout=10) as response:
            csrf = json.load(response)['csrf']
        request = urllib.request.Request('http://127.0.0.1:8090/control', data=b'{"action":"reload-certificates"}', headers={'Content-Type': 'application/json', 'X-Browser-CSRF': csrf})
        with urllib.request.urlopen(request, timeout=45) as response:
            response.read()
        return
    # Only terminate this workspace user's browser, leaving KasmVNC and the desktop running.
    subprocess.run(['pkill', '-u', str(os.getuid()), '-x', 'chrome'], capture_output=True)
    PROCESS = subprocess.Popen([str(BROWSER), '--no-first-run', '--no-default-browser-check', '--password-store=basic', '--start-maximized', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def watch_certificate():
    previous = None
    while True:
        try:
            path = certificate_path()
            signature = (str(path), path.stat().st_mtime_ns) if path.is_file() else None
            if signature != previous or STATUS['state'] == 'checking':
                with LOCK:
                    if signature:
                        try:
                            if hashlib.sha256(path.read_bytes()).digest() != INSTALLED_DIGEST:
                                import_certificate(path, '')
                                relaunch()
                            STATUS.update(state='ready', message='Your client certificate is installed in the browser.')
                        except ValueError:
                            STATUS.update(state='locked', message='Your saved certificate needs its password. Unlock it below, then relaunch.')
                    else:
                        STATUS.update(state='missing', message='No client certificate is configured. Add one in Coder Settings > Certificates and restart this workspace, or supply one here.')
                    previous = signature
        except OSError:
            STATUS.update(state='error', message='The certificate file could not be read.')
        time.sleep(2)


PAGE = '''<!doctype html><html><head><meta charset="utf-8"><title>Kasm Desktop</title>
<style>html,body{height:100%;margin:0;background:#111;color:#eee;font:14px system-ui}body{display:flex;flex-direction:column}header{display:flex;align-items:center;gap:14px;padding:8px 14px;background:#202329}iframe{width:100%;flex:1;border:0}button,input{font:inherit}button{cursor:pointer;padding:7px 12px}audio{height:30px}dialog{max-width:570px;color:inherit;background:#202329;border:1px solid #555;border-radius:12px}dialog::backdrop{backdrop-filter:blur(8px)}form{display:grid;gap:12px}label{display:grid;gap:6px}input{padding:8px}p{line-height:1.5}.actions{display:flex;gap:10px;justify-content:end}#status{color:#bbb}</style></head>
<body><header><strong>Kasm Desktop</strong><button id="certificates">Client certificate</button><span id="status"></span><audio controls preload="none" src="audio.mp3" aria-label="Desktop audio"></audio></header>
<iframe title="Kasm desktop" src="desktop/?resize=remote" allow="clipboard-read; clipboard-write; autoplay; fullscreen"></iframe>
<dialog id="certificate"><form id="form"><h2>Client certificate</h2><p id="detail"></p><label>Certificate file (.p12 or .pfx), optional when using your saved certificate<input id="file" type="file" accept=".p12,.pfx"></label><label>Certificate password<input id="password" type="password" autocomplete="off"></label><p id="result" role="status"></p><div class="actions"><button id="close" type="button">Close</button><button id="apply">Import and relaunch browser</button></div></form></dialog>
<script>const csrf=__CSRF__;const dialog=document.getElementById('certificate');async function refresh(){const r=await fetch('status');const s=await r.json();document.getElementById('status').textContent=s.state==='ready'?'Certificate ready':s.state==='locked'?'Certificate locked':'Certificate optional';document.getElementById('detail').textContent=s.message;}document.getElementById('certificates').onclick=()=>{refresh();dialog.showModal()};document.getElementById('close').onclick=()=>dialog.close();document.getElementById('form').onsubmit=async e=>{e.preventDefault();const button=document.getElementById('apply');button.disabled=true;try{const file=document.getElementById('file').files[0];let certificate='';if(file){if(file.size>1048576)throw Error('Choose a certificate smaller than 1 MiB.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);certificate=btoa(binary);}const response=await fetch('certificate',{method:'POST',headers:{'Content-Type':'application/json','X-Browser-CSRF':csrf},body:JSON.stringify({certificate,password:document.getElementById('password').value})});document.getElementById('password').value='';const result=await response.json();document.getElementById('result').textContent=result.message;await refresh();}catch(error){document.getElementById('result').textContent=error.message;}finally{button.disabled=false;}};refresh();setInterval(refresh,10000);</script></body></html>'''


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, content, content_type='application/json'):
        data = content.encode() if isinstance(content, str) else content
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path in ('/', '/index.html'):
            page = PAGE
            if os.environ.get('BROWSER_MODE') == 'certificates':
                page = re.sub(r'<iframe\b[^>]*>.*?</iframe>|<audio\b[^>]*>.*?</audio>', '', page, flags=re.S)
                page = page.replace('Kasm Desktop', 'Browser certificate').replace('</script></body>', 'dialog.showModal();</script></body>')
            return self.reply(200, page.replace('__CSRF__', json.dumps(CSRF)), 'text/html; charset=utf-8')
        if path == '/status':
            return self.reply(200, json.dumps({**STATUS, "csrf": CSRF}))
        if path == '/health':
            return self.reply(200, '{"ready":true}')
        if os.environ.get('BROWSER_MODE') == 'certificates':
            return self.reply(404, '{"error":"Not found"}')
        if path == '/audio.mp3':
            self.send_response(200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            command = ['ffmpeg', '-nostdin', '-loglevel', 'error', '-f', 'pulse', '-i', 'default', '-ac', '2', '-ar', '44100', '-b:a', '128k', '-f', 'mp3', 'pipe:1']
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            try:
                while chunk := process.stdout.read(4096):
                    self.wfile.write(chunk)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                process.terminate()
                process.wait(timeout=5)
            return
        if path == '/websockify':
            self.path = '/desktop' + self.path
            return self.proxy()
        if path.startswith('/desktop/'):
            return self.proxy()
        return self.reply(404, '{"message":"Not found"}')

    def do_POST(self):
        if self.path != '/certificate' or not hmac.compare_digest(self.headers.get('X-Browser-CSRF', ''), CSRF):
            return self.reply(403, '{"message":"Open the certificate panel again."}')
        try:
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= 1500000:
                raise ValueError('The certificate request is too large.')
            data = json.loads(self.rfile.read(length))
            password = data.get('password', '')
            if not isinstance(password, str) or len(password) > 4096:
                raise ValueError('Invalid certificate password.')
            with LOCK:
                path = certificate_path()
                upload = data.get('certificate', '')
                if upload:
                    raw = base64.b64decode(upload, validate=True)
                    if len(raw) > 1048576:
                        raise ValueError('Choose a certificate smaller than 1 MiB.')
                    CERT_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
                    with tempfile.NamedTemporaryFile(dir=CERT_DIR, prefix='.browser-import-', delete=True) as target:
                        target.write(raw)
                        target.flush()
                        import_certificate(pathlib.Path(target.name), password)
                    path = CERT_DIR / 'browser-upload.p12'
                    path.write_bytes(raw)
                    path.chmod(0o600)
                else:
                    if not path.is_file():
                        raise ValueError('Choose a certificate file or upload one in Coder Settings > Certificates.')
                    import_certificate(path, password)
                relaunch()
                STATUS.update(state='ready', message='Your client certificate is installed in the browser.')
            return self.reply(200, '{"message":"Certificate imported. The browser has relaunched."}')
        except (ValueError, OSError, subprocess.SubprocessError):
            return self.reply(400, '{"message":"Could not import the certificate. Check the file and its password, then try again."}')

    def websocket(self, path):
        upstream = ssl._create_unverified_context().wrap_socket(socket.create_connection(('127.0.0.1', 6901), timeout=30), server_hostname='localhost')
        try:
            headers = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'authorization', 'cookie')}
            headers.update(Host='localhost:6901', Authorization=AUTH)
            upstream.sendall(('GET ' + path + ' HTTP/1.1\r\n' + ''.join(k + ': ' + v + '\r\n' for k, v in headers.items()) + '\r\n').encode())
            handshake = b''
            while b'\r\n\r\n' not in handshake:
                byte = upstream.recv(1)
                if not byte or len(handshake) > 65536:
                    return
                handshake += byte
            self.connection.sendall(handshake)
            if not handshake.startswith(b'HTTP/1.1 101'):
                return
            upstream.settimeout(None)
            while True:
                ready = [upstream] if upstream.pending() else select.select([self.connection, upstream], [], [], 60)[0]
                for source in ready:
                    chunk = source.recv(65536)
                    if not chunk:
                        return
                    (upstream if source is self.connection else self.connection).sendall(chunk)
        except OSError:
            pass
        finally:
            self.close_connection = True
            upstream.close()

    def proxy(self):
        # Kasm generates a private self-signed certificate for its loopback endpoint.
        connection = http.client.HTTPSConnection('127.0.0.1', 6901, context=ssl._create_unverified_context(), timeout=30)
        headers = {k: v for k, v in self.headers.items() if k.lower() not in ('host', 'authorization', 'cookie', 'connection')}
        headers['Authorization'] = AUTH
        if self.headers.get('Upgrade', '').lower() == 'websocket':
            headers['Connection'] = 'Upgrade'
        path = '/' + self.path.removeprefix('/desktop/')
        if self.headers.get('Upgrade', '').lower() == 'websocket':
            return self.websocket(path)
        try:
            connection.request(self.command, path, headers=headers)
            response = connection.getresponse()
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in ('connection', 'transfer-encoding', 'content-length', 'x-frame-options'):
                    self.send_header(key, value)
            body = response.read()
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (OSError, http.client.HTTPException):
            self.close_connection = True
        finally:
            connection.close()


if __name__ == '__main__':
    if not OWNER or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._@+-' for c in OWNER):
        raise SystemExit('Invalid workspace owner')
    threading.Thread(target=watch_certificate, daemon=True).start()
    http.server.ThreadingHTTPServer((os.environ.get('BROWSER_LISTEN_ADDRESS', '127.0.0.1'), 8088), Handler).serve_forever()
