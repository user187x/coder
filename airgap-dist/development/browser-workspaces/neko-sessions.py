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

SESSIONS = {}
LOCK = asyncio.Lock()
CSRF = secrets.token_urlsafe(32)
MAX_SESSIONS = 6
ROOT = pathlib.Path('/tmp/coder-browser-sessions')
HOP_HEADERS = {'host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'content-encoding'}


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
    for process in session['processes']:
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
    session = {'slot': slot, 'port': port, 'home': home, 'processes': []}
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
        return web.json_response({'csrf': CSRF}, headers={'Cache-Control': 'no-store'})
    if not secrets.compare_digest(request.headers.get('X-Browser-CSRF', ''), CSRF):
        raise web.HTTPForbidden()
    data = await request.json()
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


async def proxy(request):
    session_id = request.match_info['session']
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', session_id):
        raise web.HTTPBadRequest()
    async with LOCK:
        if session_id not in SESSIONS and request.match_info.get('path', ''):
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
    app = web.Application(client_max_size=2 * 1024 * 1024)
    app.cleanup_ctx.append(lifecycle)
    app.router.add_route('*', '/control', control)
    app.router.add_get('/', index)
    app.router.add_route('*', '/sessions/{session}/{path:.*}', proxy)
    return app


if __name__ == '__main__':
    web.run_app(application(), host='127.0.0.1', port=8090, access_log=None)
