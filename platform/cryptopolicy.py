"""Apply explicit TLS and SSH policy without claiming module validation."""
import argparse
import pathlib
import re
import subprocess


def section_value(text, section, key, value):
    pattern = re.compile(r'(?ms)^\[\s*' + re.escape(section) + r'\s*\][^\n]*\n(.*?)(?=^\[|\Z)')
    match = pattern.search(text)
    entry = key + ' = ' + value + '\n'
    if not match:
        return text.rstrip() + '\n\n[' + section + ']\n' + entry
    body = match.group(1)
    key_pattern = re.compile(r'(?m)^[ \t]*' + re.escape(key) + r'[ \t]*=.*\n?')
    body = key_pattern.sub('', body).strip('\n')
    body = (body + '\n' if body else '') + entry
    if match.end(1) < len(text):
        body += '\n'
    return text[:match.start(1)] + body + text[match.end(1):]


def tls_config(text, minimum):
    # OpenSSL reads openssl_conf from the unnamed section, before any named one.
    preamble = text.split('[', 1)[0]
    active = re.findall(r'^\s*openssl_conf\s*=\s*([^\s#]+)', preamble, re.M)
    init = active[-1] if active else 'coder_init'
    if not active:
        text = 'openssl_conf = coder_init\n' + text
    text = section_value(text, init, 'ssl_conf', 'coder_tls')
    text = section_value(text, 'coder_tls', 'system_default', 'coder_tls_defaults')
    text = section_value(text, 'coder_tls_defaults', 'MinProtocol', minimum)
    return section_value(text, 'coder_tls_defaults', 'CipherString', 'DEFAULT:@SECLEVEL=2')


def tls_minimum(text):
    sections = {'': {}}
    section = ''
    for line in text.splitlines():
        line = line.split('#', 1)[0].strip()
        if line.startswith('[') and line.endswith(']'):
            section = line[1:-1].strip()
            sections.setdefault(section, {})
        elif '=' in line:
            key, value = line.split('=', 1)
            sections[section][key.strip()] = value.strip()
    current = sections[''].get('openssl_conf')
    for key in ('ssl_conf', 'system_default', 'MinProtocol'):
        current = sections.get(current, {}).get(key)
    return current


def apply(root, rules, provider=False):
    root = pathlib.Path(root)
    openssl = root / 'etc/ssl/openssl.cnf'
    openssl.parent.mkdir(parents=True, exist_ok=True)
    text = tls_config(openssl.read_text() if openssl.exists() else '', rules['tls']['minProtocol'])
    modules = sorted(root.glob('usr/lib/*/ossl-modules/fips.so'))
    if provider and modules:
        subprocess.run(['openssl', 'fipsinstall', '-module', str(modules[0]), '-out',
                        str(openssl.with_name('fipsmodule.cnf'))], check=True)
        init = re.findall(r'^\s*openssl_conf\s*=\s*([^\s#]+)', text.split('[', 1)[0], re.M)[-1]
        text = section_value(text, init, 'providers', 'coder_providers')
        text = section_value(text, init, 'alg_section', 'coder_properties')
        text = section_value(text, 'coder_providers', 'fips', 'fips_sect')
        text = section_value(text, 'coder_providers', 'base', 'coder_base')
        text = section_value(text, 'coder_base', 'activate', '1')
        text = section_value(text, 'coder_properties', 'default_properties', 'fips=yes')
        include = '.include /etc/ssl/fipsmodule.cnf\n'
        text = text.replace(include, '').rstrip() + '\n' + include
    openssl.write_text(text)
    ssh = rules['ssh']
    policy = '\n'.join(key + ' ' + ','.join(ssh[name]) for key, name in
                       [('Ciphers', 'ciphers'), ('MACs', 'macs'), ('KexAlgorithms', 'kex')]) + '\n'
    # OpenSSH uses the first value: put the include before vendor defaults and Host/Match blocks.
    for filename in ('ssh_config', 'sshd_config'):
        config = root / 'etc/ssh' / filename
        directory = config.with_name(filename + '.d')
        directory.mkdir(parents=True, exist_ok=True)
        dropin = directory / '00-coder-crypto.conf'
        dropin.write_text(policy)
        text = config.read_text() if config.exists() else ''
        include = 'Include /etc/ssh/' + filename + '.d/00-coder-crypto.conf\n'
        text = text.replace(include, '')
        config.write_text(include + text)


def verify_runtime():
    """Check certificate-verified curl over both allowed TLS versions, without internet."""
    import http.server
    import ssl
    import tempfile
    import threading

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header('Content-Length', str(len(b'coder-crypto-ok')))
            self.end_headers()
            self.wfile.write(b'coder-crypto-ok')

        def log_message(self, *args):
            pass

    with tempfile.TemporaryDirectory() as directory:
        cert = str(pathlib.Path(directory) / 'cert.pem')
        key = str(pathlib.Path(directory) / 'key.pem')
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'ec', '-pkeyopt',
                        'ec_paramgen_curve:P-256', '-sha256', '-nodes', '-days', '1',
                        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
                        '-keyout', key, '-out', cert], check=True, capture_output=True)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(cert, key)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for version in ('1.2', '1.3'):
                result = subprocess.run(['curl', '--silent', '--show-error', '--fail', '--noproxy', '*',
                    '--cacert', cert, '--connect-timeout', '5', '--max-time', '10',
                    '--tlsv' + version, '--tls-max', version,
                    'https://localhost:%d/' % server.server_port], check=True, capture_output=True)
                if result.stdout != b'coder-crypto-ok':
                    raise RuntimeError('curl TLS validation returned an unexpected response.')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == '__main__':
    import json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default='/')
    parser.add_argument('--rules', required=True)
    args = parser.parse_args()
    apply(args.root, json.loads(pathlib.Path(args.rules).read_text()))
    if args.root == '/':
        verify_runtime()
