"""Owner-only Coder app gateway for independent, disposable browser panels."""
import asyncio
import json
import os
import pathlib
import re
import secrets
import shutil
import signal
import tempfile

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web

from browser_pin import BrowserPIN

SESSIONS = {}
LOCK = asyncio.Lock()
CSRF = secrets.token_urlsafe(32)
MAX_SESSIONS = 6
ROOT = pathlib.Path('/tmp/coder-browser-sessions')
HOP_HEADERS = {'host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'content-encoding'}
PIN = BrowserPIN()
UNLOCK_COOKIE = 'coder_browser_unlock'
# Requests reaching browser sessions (pages, signaling and desktop sockets, audio streams): cancelled on lock.
ACTIVE = set()
LOCKED_PAGE = ('<!doctype html><title>Browser locked</title><body style="font:16px system-ui;background:#262626;'
               'color:#e5e5e5;display:grid;place-items:center;height:100vh;margin:0">'
               '<p>This browser is locked. Unlock it with its PIN from the workspace panel.</p></body>')


class HTTPLocked(web.HTTPClientError):
    status_code = 423


def pin_status(request):
    return PIN.status(request.cookies.get(UNLOCK_COOKIE))


def set_unlock_cookie(response, token):
    response.set_cookie(UNLOCK_COOKIE, token, path='', secure=True, httponly=True, samesite='Strict')


def lock_now():
    PIN.lock()
    current = asyncio.current_task()
    for task in list(ACTIVE):
        if task is not current:
            task.cancel()


@web.middleware
async def pin_gate(request, handler):
    """Refuse everything but the lock's own controls while the browser is locked, whatever the path or transport."""
    if request.path in ('/control', '/support'):
        return await handler(request)
    if not PIN.allows(request.cookies.get(UNLOCK_COOKIE)):
        if 'text/html' in request.headers.get('Accept', ''):
            return web.Response(status=423, text=LOCKED_PAGE, content_type='text/html',
                                headers={'Cache-Control': 'no-store'})
        return web.json_response({'locked': True}, status=423, headers={'Cache-Control': 'no-store'})
    task = asyncio.current_task()
    ACTIVE.add(task)
    try:
        return await handler(request)
    finally:
        ACTIVE.discard(task)


async def pin_control(request, data):
    """The PIN actions: set (when none is set), unlock, lock (always allowed) and clear (unlocked, with the PIN)."""
    action = data.get('action')
    token = request.cookies.get(UNLOCK_COOKIE)
    if action == 'pin-unlock':
        new = PIN.unlock(data.get('pin'))
        if not new:
            status = PIN.status(None)
            raise web.HTTPTooManyRequests(text=json.dumps(status), content_type='application/json') \
                if status['retryAfter'] else web.HTTPForbidden(text=json.dumps(status), content_type='application/json')
        response = web.json_response(PIN.status(new))
        set_unlock_cookie(response, new)
        return response
    if action == 'pin-set':
        if PIN.configured:
            raise web.HTTPConflict(text='A PIN is already set. Clear it before choosing another.')
        try:
            new = PIN.configure(data.get('pin'))
        except ValueError as error:
            raise web.HTTPBadRequest(text=str(error))
        response = web.json_response(PIN.status(new))
        set_unlock_cookie(response, new)
        return response
    if action == 'pin-lock':
        if not PIN.configured:
            raise web.HTTPConflict(text='Set a PIN before locking the browser.')
        lock_now()
        response = web.json_response(PIN.status(None))
        response.del_cookie(UNLOCK_COOKIE, path='')
        return response
    if not PIN.allows(token):
        raise HTTPLocked()
    if action == 'pin-clear':
        if not PIN.clear(data.get('pin')):
            raise web.HTTPForbidden(text=json.dumps(PIN.status(token)), content_type='application/json')
        response = web.json_response(PIN.status(None))
        response.del_cookie(UNLOCK_COOKIE, path='')
        return response
    return None


async def stop_session(session_id):
    session = SESSIONS.pop(session_id, None)
    if not session:
        return
    for process in reversed(session['processes']):
        if process.returncode is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    for process in list(session['processes']):
        try:
            await asyncio.wait_for(process.wait(), 5)
        except asyncio.TimeoutError:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()
    shutil.rmtree(session['home'], ignore_errors=True)


async def start_session(session_id):
    if session_id in SESSIONS:
        return SESSIONS[session_id]
    used = {s['slot'] for s in SESSIONS.values()}
    slot = next((i for i in range(MAX_SESSIONS) if i not in used), None)
    if slot is None:
        raise web.HTTPServiceUnavailable(text='Close a browser panel before opening another. Six sessions are already running.')
    home = pathlib.Path(tempfile.mkdtemp(prefix=session_id + '-', dir=ROOT))
    display = f':{110 + slot}'
    port = 8110 + slot
    session = {'slot': slot, 'port': port, 'home': home, 'processes': [],
               'audio_key': secrets.token_urlsafe(32), 'audio_clients': 0}
    SESSIONS[session_id] = session
    env = dict(os.environ, HOME=str(home), DISPLAY=display,
               XDG_RUNTIME_DIR=str(home / 'runtime'), XDG_CONFIG_HOME=str(home / '.config'),
               PULSE_SERVER=f'unix:{home}/pulse.sock', NEKO_SERVER_BIND=f'127.0.0.1:{port}',
               NEKO_WEBRTC_UDPMUX=str(30590 + slot), NEKO_CAPTURE_VIDEO_DISPLAY=display,
               NEKO_DESKTOP_DISPLAY=display, NEKO_DESKTOP_INPUT_SOCKET=str(home / 'input.sock'),
               NEKO_SESSION_COOKIE_NAME='NEKO_' + session_id, NEKO_SESSION_COOKIE_PATH='')
    (home / 'runtime').mkdir(mode=0o700)
    profile = home / '.config/chromium/Default'
    profile.mkdir(parents=True)
    (profile / 'Preferences').write_text(json.dumps({'ntp': {'shortcust_visible': False}, 'session': {'restore_on_startup': 5}}))
    (profile.parent / 'Local State').write_text(json.dumps({'browser': {'enabled_labs_experiments': ['overlay-scrollbars@1']}}))
    # The workspace certificate database stays shared; browser cookies and tabs do not.
    (home / '.pki').symlink_to(pathlib.Path('/home/neko/.pki'))
    xorg = pathlib.Path('/etc/neko/xorg.conf').read_text().replace('/tmp/xf86-input-neko.sock', str(home / 'input.sock'))
    (home / 'xorg.conf').write_text(xorg)
    pulse = pathlib.Path('/etc/pulse/default.pa').read_text().replace('/tmp/pulseaudio.socket', str(home / 'pulse.sock'))
    (home / 'pulse.pa').write_text(pulse)

    async def spawn(name, *args):
        with (home / (name + '.log')).open('wb') as log:
            process = await asyncio.create_subprocess_exec(*args, env=env, stdout=log, stderr=log, start_new_session=True)
        session['processes'].append(process)
        if name == 'chromium':
            session['browser'] = process
            session['browser_args'] = args
            session['env'] = env

    try:
        await spawn('xorg', '/usr/bin/X', display, '-config', str(home / 'xorg.conf'), '-logfile', str(home / 'Xorg.log'), '-noreset', '-nolisten', 'tcp')
        await spawn('pulse', '/usr/bin/pulseaudio', '-n', '-F', str(home / 'pulse.pa'), '--exit-idle-time=-1', '--log-level=error')
        for _ in range(100):
            if pathlib.Path(f'/tmp/.X11-unix/X{110 + slot}').exists() and (home / 'pulse.sock').exists():
                break
            await asyncio.sleep(0.1)
        await spawn('openbox', '/usr/bin/openbox', '--config-file', '/etc/neko/openbox.xml')
        await spawn('chromium', '/usr/bin/chromium', '--no-sandbox', '--no-first-run', '--hide-crash-restore-bubble',
                    '--start-maximized', '--force-dark-mode', '--disable-extensions', '--disable-gpu', '--disable-dev-shm-usage',
                    '--disable-software-rasterizer', '--password-store=basic', '--user-data-dir=' + str(home / '.config/chromium'))
        await spawn('neko', '/usr/bin/neko', 'serve', '--server.static', '/var/www')
        for _ in range(150):
            if any(p.returncode is not None for p in session['processes']):
                raise RuntimeError('Browser process exited during startup')
            try:
                reader, writer = await asyncio.open_connection('127.0.0.1', port)
                writer.close()
                await writer.wait_closed()
                return session
            except OSError:
                await asyncio.sleep(0.1)
        raise RuntimeError('Browser startup timed out')
    except Exception:
        # Keep logs outside the disposable profile for operator diagnostics.
        for log in home.glob('*.log'):
            shutil.copyfile(log, ROOT / ('failed-' + session_id + '-' + log.name))
        await stop_session(session_id)
        raise


async def control(request):
    if request.method == 'GET':
        return web.json_response({'csrf': CSRF, 'pin': pin_status(request)}, headers={'Cache-Control': 'no-store'})
    if not secrets.compare_digest(request.headers.get('X-Browser-CSRF', ''), CSRF):
        raise web.HTTPForbidden()
    data = await request.json()
    if not isinstance(data, dict):
        raise web.HTTPBadRequest()
    if str(data.get('action', '')).startswith('pin-'):
        response = await pin_control(request, data)
        if response is not None:
            return response
        raise web.HTTPBadRequest()
    if data.get('action') == 'reload-certificates':
        async with LOCK:
            for session in SESSIONS.values():
                browser = session['browser']
                if browser.returncode is None:
                    os.killpg(browser.pid, signal.SIGTERM)
                    try:
                        await asyncio.wait_for(browser.wait(), 5)
                    except asyncio.TimeoutError:
                        os.killpg(browser.pid, signal.SIGKILL)
                        await browser.wait()
                with (session['home'] / 'chromium.log').open('ab') as log:
                    process = await asyncio.create_subprocess_exec(*session['browser_args'], env=session['env'], stdout=log, stderr=log, start_new_session=True)
                session['processes'].remove(browser)
                session['processes'].append(process)
                session['browser'] = process
        return web.json_response({'reloaded': True})
    session_id = data.get('id', '')
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', session_id):
        raise web.HTTPBadRequest()
    async with LOCK:
        await stop_session(session_id)
    return web.json_response({'stopped': True})


async def status(request):
    session_id = request.match_info['session']
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', session_id):
        raise web.HTTPBadRequest()
    async with LOCK:
        session = SESSIONS.get(session_id)
        running = bool(session and session['browser'].returncode is None)
        if session and not running:
            await stop_session(session_id)
    return web.json_response({'running': running}, headers={'Cache-Control': 'no-store'})


async def list_sessions(_request):
    async with LOCK:
        sessions = [key for key, session in SESSIONS.items() if session['browser'].returncode is None]
    return web.json_response({'sessions': sessions}, headers={'Cache-Control': 'no-store'})


async def desktop_socket(request):
    # The control token is readable only through this owner's Coder app. Requiring
    # it as a subprotocol also prevents cross-origin WebSocket connections.
    protocols = [p.strip() for p in request.headers.get('Sec-WebSocket-Protocol', '').split(',')]
    if 'binary' not in protocols or not any(
            secrets.compare_digest(p.encode(), ('coder.' + CSRF).encode()) for p in protocols):
        raise web.HTTPForbidden()
    async with LOCK:
        session = SESSIONS.get(request.match_info['session'])
        if not session or session['browser'].returncode is not None:
            raise web.HTTPGone(text='This browser session has closed.')
        path = session['home'] / 'desktop.sock'
        server = session.get('desktop_server')
        if not server or server.returncode is not None:
            path.unlink(missing_ok=True)
            with (session['home'] / 'desktop.log').open('ab') as log:
                server = await asyncio.create_subprocess_exec(
                    '/usr/bin/X0tigervnc', '-display', session['env']['DISPLAY'],
                    '-rfbport', '-1', '-rfbunixpath', str(path), '-rfbunixmode', '0600',
                    '-SecurityTypes', 'None', '-AlwaysShared', '-AcceptCutText=0',
                    '-SendCutText=0', '-AcceptSetDesktopSize=0', '-QueryConnect=0',
                    env=session['env'], stdout=log, stderr=log, start_new_session=True)
            session['desktop_server'] = server
            session['processes'].append(server)
    for _ in range(50):
        try:
            reader, writer = await asyncio.open_unix_connection(path)
            break
        except (FileNotFoundError, ConnectionRefusedError):
            if server.returncode is not None:
                raise web.HTTPServiceUnavailable(text='The desktop connection exited.')
            await asyncio.sleep(0.1)
    else:
        raise web.HTTPServiceUnavailable(text='The desktop connection did not start.')
    ws = web.WebSocketResponse(protocols=('binary',))
    async def from_display():
        while chunk := await reader.read(65536):
            await ws.send_bytes(chunk)
    async def to_display():
        async for message in ws:
            if message.type != WSMsgType.BINARY:
                break
            writer.write(message.data)
            await writer.drain()
    tasks = []
    try:
        await ws.prepare(request)
        tasks = [asyncio.create_task(fn()) for fn in (from_display, to_display)]
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        writer.close()
        try:
            await writer.wait_closed()
        finally:
            await ws.close()
    return ws


async def desktop_audio(request):
    # Authorize the native media element without putting a token in its URL.
    async with LOCK:
        session = SESSIONS.get(request.match_info['session'])
        if not session:
            raise web.HTTPGone()
        if not secrets.compare_digest(request.cookies.get('coder_browser_audio', '').encode(), session['audio_key'].encode()):
            raise web.HTTPForbidden()
        if session['audio_clients'] >= 4:
            raise web.HTTPTooManyRequests()
        process = await asyncio.create_subprocess_exec(
            '/usr/bin/ffmpeg', '-nostdin', '-loglevel', 'error', '-f', 'pulse',
            '-i', 'audio_output.monitor', '-c:a', 'libmp3lame', '-b:a', '96k',
            '-write_xing', '0', '-flush_packets', '1', '-f', 'mp3', 'pipe:1',
            stdout=asyncio.subprocess.PIPE, env=session['env'], start_new_session=True)
        session['audio_clients'] += 1
        session['processes'].append(process)
    stream = web.StreamResponse(headers={'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store',
                                         'Cross-Origin-Resource-Policy': 'same-origin', 'X-Accel-Buffering': 'no'})
    try:
        first = await asyncio.wait_for(process.stdout.read(8192), 10)
        if not first:
            raise web.HTTPServiceUnavailable(text='Browser audio capture failed.')
        await stream.prepare(request)
        await stream.write(first)
        while chunk := await process.stdout.read(8192):
            await stream.write(chunk)
    except asyncio.TimeoutError:
        raise web.HTTPServiceUnavailable(text='Browser audio capture timed out.')
    except ConnectionResetError:
        pass
    finally:
        session['audio_clients'] -= 1
        if process.returncode is None:
            try:
                process.terminate()
            except ProcessLookupError:
                pass
        try:
            await asyncio.wait_for(process.communicate(), 3)
        except asyncio.TimeoutError:
            process.kill()
            await process.communicate()
        if process in session['processes']:
            session['processes'].remove(process)
    return stream


async def support(_request):
    return web.FileResponse('/opt/coder/neko-support.html', headers={
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'same-origin',
    })


async def proxy(request):
    session_id = request.match_info['session']
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', session_id):
        raise web.HTTPBadRequest()
    async with LOCK:
        if session_id not in SESSIONS and (request.match_info.get('path', '') or request.query.get('existing') == '1'):
            raise web.HTTPGone(text='This browser session has closed. Reopen its panel.')
        session = await start_session(session_id)
    path = '/' + request.match_info.get('path', '')
    if request.query_string:
        path += '?' + request.query_string
    url = f'http://127.0.0.1:{session["port"]}{path}'
    headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_HEADERS}
    headers['Accept-Encoding'] = 'identity'
    client = request.app['client']
    if request.headers.get('Upgrade', '').lower() == 'websocket':
        async with client.ws_connect(url, headers=headers, autoclose=True) as upstream:
            downstream = web.WebSocketResponse()
            await downstream.prepare(request)

            async def copy(source, target):
                async for message in source:
                    if message.type == WSMsgType.TEXT:
                        await target.send_str(message.data)
                    elif message.type == WSMsgType.BINARY:
                        await target.send_bytes(message.data)
                    else:
                        break
                await target.close()

            await asyncio.gather(copy(upstream, downstream), copy(downstream, upstream))
            return downstream
    async with client.request(request.method, url, headers=headers, data=await request.read(), allow_redirects=False) as response:
        result = web.Response(status=response.status, body=await response.read())
        for key, value in response.headers.items():
            if key.lower() not in HOP_HEADERS:
                result.headers.add(key, value)
        if request.match_info.get('path') == 'compatibility.html' and result.status == 200:
            result.set_cookie('coder_browser_audio', session['audio_key'], path='', secure=True,
                              httponly=True, samesite='Strict')
            result.headers['Cache-Control'] = 'no-store'
        return result


async def index(request):
    if 'embed' in request.query:
        raise web.HTTPFound('sessions/default/?embed=1')
    return web.Response(text='Browser sessions ready')


async def lifecycle(app):
    ROOT.mkdir(mode=0o700, exist_ok=True)
    async with ClientSession(timeout=ClientTimeout(total=None), auto_decompress=False) as client:
        app['client'] = client
        yield
        for session_id in list(SESSIONS):
            await stop_session(session_id)


def application():
    app = web.Application(client_max_size=2 * 1024 * 1024, middlewares=[pin_gate])
    app.cleanup_ctx.append(lifecycle)
    app.router.add_route('*', '/control', control)
    app.router.add_get('/', index)
    app.router.add_get('/sessions', list_sessions)
    app.router.add_get('/support', support)
    app.router.add_get('/sessions/{session}/status', status)
    app.router.add_get('/sessions/{session}/desktop-socket', desktop_socket)
    app.router.add_get('/sessions/{session}/desktop-audio', desktop_audio, allow_head=False)
    app.router.add_route('*', '/sessions/{session}/{path:.*}', proxy)
    return app


if __name__ == '__main__':
    web.run_app(application(), host='127.0.0.1', port=8090, access_log=None)
