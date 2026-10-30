#!/usr/bin/env python3
"""Compose browser workspace templates with the deployment's rendered base template."""
import argparse
import json
import pathlib
import re
import shutil
import tarfile

ROOT = pathlib.Path(__file__).resolve().parent


def kasm_template(base, output):
    output.mkdir(parents=True, exist_ok=True)
    for name in ('main.tf', 'workspace-vm.tf'):
        shutil.copy2(base / name, output / name)
    shutil.copytree(base / 'scripts', output / 'scripts', dirs_exist_ok=True)
    shutil.copy2(ROOT / 'kasm-browser.py', output / 'kasm-browser.py')
    source = (output / 'main.tf').read_text()
    for feature in ('code_server', 'desktop', 'file_browser'):
        source = re.sub(r'(variable "' + feature + r'" \{.*?default\s*=\s*)true', r'\g<1>false', source, count=1, flags=re.S)
    source = re.sub(r'(variable "default_memory" \{.*?default\s*=\s*)"2"', r'\g<1>"4"', source, count=1, flags=re.S)
    source = re.sub(r'\bvar\.(code_server|desktop|file_browser)\b', 'false', source)
    marker = '        container {\n          name  = "dev"'
    if source.count(marker) != 1:
        raise ValueError('The base template has no unique workspace container.')
    container = '''        container {
          name = "kasm"
          image = "kasmweb/desktop:1.18.0@sha256:40750c44f43b771208087c81c3b74a945df25c1afd305d20a9a6daa68b98c711"
          command = __KASM_COMMAND__
          env {
            name = "VNC_PW"
            value = sha256(coder_agent.main.token)
          }
          env {
            name = "BROWSER_CODE_B64"
            value = filebase64("${path.module}/kasm-browser.py")
          }
          env {
            name = "WORKSPACE_OWNER"
            value = data.coder_workspace_owner.me.name
          }
          resources {
            requests = { cpu = "500m", memory = "1Gi" }
            limits = { cpu = "2", memory = "4Gi" }
          }
          volume_mount {
            name = "home"
            mount_path = "/home/kasm-user"
          }
          volume_mount {
            name = "dshm"
            mount_path = "/dev/shm"
          }
        }


'''
    command = 'cp -an /home/kasm-default-profile/. "$HOME/"; /dockerstartup/kasm_default_profile.sh /dockerstartup/vnc_startup.sh /dockerstartup/kasm_startup.sh --wait & exec python3 -c "import base64,os;exec(base64.b64decode(os.environ[\'BROWSER_CODE_B64\']))"'
    container = container.replace('__KASM_COMMAND__', json.dumps(['bash', '-c', command]))
    source = source.replace(marker, container + marker)
    (output / 'main.tf').write_text(source)
    (output / 'browser.tf').write_text('''resource "coder_app" "kasm" {
  agent_id = coder_agent.main.id
  slug = "kasm"
  display_name = "Kasm Desktop"
  icon = "/icon/desktop.svg"
  url = "http://127.0.0.1:8088"
  subdomain = true
  share = "owner"
  healthcheck {
    url = "http://127.0.0.1:8088/health"
    interval = 5
    threshold = 12
  }
}
''')
    (output / 'terraform.tfvars').write_text('''code_server = false
desktop = false
file_browser = false
terminal = true
default_memory = "4"
''')
    archive = output.with_suffix('.tar')
    with tarfile.open(archive, 'w', format=tarfile.USTAR_FORMAT) as tar:
        for path in sorted(output.rglob('*')):
            tar.add(path, arcname=str(path.relative_to(output)), recursive=False)
    return archive


def neko_template(base, output, image, turn_secret):
    kasm_template(base, output)
    source = (output / 'main.tf').read_text()
    start = source.index('        container {\n          name = "kasm"')
    end = source.index('        container {\n          name  = "dev"', start)
    env = {
        'USER': 'neko', 'NEKO_SERVER_BIND': '127.0.0.1:8090', 'NEKO_SERVER_PROXY': 'true',
        'NEKO_MEMBER_PROVIDER': 'noauth', 'NEKO_SESSION_IMPLICIT_HOSTING': 'true', 'NEKO_SESSION_COOKIE_SECURE': 'true',
        'NEKO_SESSION_COOKIE_HTTP_ONLY': 'true', 'NEKO_SESSION_COOKIE_ENABLED': 'true', 'NEKO_WEBRTC_UDPMUX': '30590',
        'NEKO_WEBRTC_ICELITE': 'false', 'NEKO_WEBRTC_ICESERVERS_BACKEND': '[]',
    }
    command = 'exec /usr/bin/python3 /opt/coder/neko-start.py'
    if not turn_secret or not re.fullmatch(r'[a-z0-9][a-z0-9.-]*', turn_secret):
        raise ValueError('A valid operator-provided TURN Secret name is required.')
    container = '        container {\n          name = "neko"\n          image = ' + json.dumps(image) + '\n'
    container += '          command = ' + json.dumps(['sh', '-c', command]) + '\n'
    container += '''          security_context {
            run_as_user = 0
            run_as_non_root = false
            allow_privilege_escalation = false
            capabilities {
              drop = ["ALL"]
              add = ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE"]
            }
          }
          env {
            name = "WORKSPACE_OWNER"
            value = data.coder_workspace_owner.me.name
          }
'''
    container += '          env {\n            name = "NEKO_WEBRTC_ICESERVERS_FRONTEND"\n            value_from {\n              secret_key_ref {\n                name = ' + json.dumps(turn_secret) + '\n                key = "ice-servers"\n              }\n            }\n          }\n'
    container += '''          env {
            name = "NEKO_WEBRTC_NAT1TO1"
            value_from {
              field_ref {
                field_path = "status.podIP"
              }
            }
          }
'''
    for key, value in env.items():
        container += '          env {\n            name = ' + json.dumps(key) + '\n            value = ' + json.dumps(value) + '\n          }\n'
    container += '''          resources {
            requests = { cpu = "500m", memory = "512Mi" }
            limits = { cpu = "2", memory = "3Gi" }
          }
          volume_mount {
            name = "home"
            mount_path = "/home/neko"
          }
          volume_mount {
            name = "dshm"
            mount_path = "/dev/shm"
          }
        }
'''
    (output / 'main.tf').write_text(source[:start] + container + source[end:])
    (output / 'browser.tf').write_text('''resource "coder_app" "browser" {
  agent_id = coder_agent.main.id
  slug = "neko-browser"
  display_name = "Web Browser"
  icon = "/icon/browser-web-icon.png"
  url = "http://127.0.0.1:8090/?embed=1"
  subdomain = false
  share = "owner"
  healthcheck {
    url = "http://127.0.0.1:8090"
    interval = 5
    threshold = 12
  }
}
resource "coder_app" "browser_certificate" {
  agent_id = coder_agent.main.id
  slug = "certificate"
  display_name = "Browser Certificate"
  icon = "/icon/certificate.svg"
  url = "http://127.0.0.1:8088"
  subdomain = false
  share = "owner"
  healthcheck {
    url = "http://127.0.0.1:8088/health"
    interval = 5
    threshold = 12
  }
}
''')
    # Media permissions must follow the workspace lifecycle, including recreation.
    workspace = {'com.coder.workspace.id': '${data.coder_workspace.me.id}'}
    policy = {
        'count': '${var.workspace_vm_enabled ? 0 : data.coder_workspace.me.start_count}',
        'metadata': [{'name': 'coder-neko-${data.coder_workspace.me.id}', 'namespace': '${var.namespace}',
                      'labels': workspace}],
        'spec': [{
            'pod_selector': [{'match_labels': {'app.kubernetes.io/name': turn_secret}}],
            'policy_types': ['Ingress', 'Egress'],
            'ingress': [{'from': [{'pod_selector': [{'match_labels': workspace}]}],
                         'ports': [{'protocol': 'UDP', 'port': '49160', 'end_port': 49200}]}],
            'egress': [{'to': [{'pod_selector': [{'match_labels': workspace}]}],
                        'ports': [{'protocol': 'UDP', 'port': '30590', 'end_port': 30595}]}],
        }],
    }
    (output / 'browser-network.tf.json').write_text(json.dumps({
        'resource': {'kubernetes_network_policy_v1': {'browser_media': policy}},
    }, indent=2) + '\n')
    archive = output.with_suffix('.tar')
    with tarfile.open(archive, 'w', format=tarfile.USTAR_FORMAT) as tar:
        for path in sorted(output.rglob('*')):
            tar.add(path, arcname=str(path.relative_to(output)), recursive=False)
    return archive


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('base', type=pathlib.Path)
    parser.add_argument('output', type=pathlib.Path)
    parser.add_argument('--kind', choices=('kasm', 'neko'), default='kasm')
    parser.add_argument('--image', help='The built N.eko browser image, preferably pinned by digest')
    parser.add_argument('--turn-secret', default='coder-neko-turn', help='Operator-provided Secret containing TLS port 443 ICE servers')
    args = parser.parse_args()
    if args.kind == 'neko' and not args.image:
        parser.error('--image is required for N.eko')
    print(neko_template(args.base, args.output, args.image, args.turn_secret) if args.kind == 'neko' else kasm_template(args.base, args.output))
