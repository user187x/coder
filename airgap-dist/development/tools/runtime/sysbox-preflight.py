#!/usr/bin/env python3
"""Check a native containerd Sysbox worker before running admission smoke tests.

Run on the Ubuntu worker as root. This is read-only and never labels a worker
ready. A successful real Kubernetes pod and ephemeral-container smoke test is
still required before workspace migration.
"""
import argparse
import json
import re
import pathlib
import shutil
import subprocess
import sys
import tomllib


def command(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT).strip()


def feature_gate(config, flags, name):
    """Read an explicit gate from supported kubelet YAML/JSON or process flags.

    Ambiguous or unsupported YAML layouts fail closed rather than treating an
    absent gate as false. A worker still needs real parent-cgroup smoke tests.
    """
    overrides = dict(value.split('=', 1) for value in flags.get('feature-gates', '').split(',') if '=' in value)
    if name in overrides:
        return overrides[name] if overrides[name] in ('true', 'false') else None
    if config.lstrip().startswith('{'):
        value = json.loads(config).get('featureGates', {}).get(name)
        return str(value).lower() if isinstance(value, bool) else None
    sections = list(re.finditer(r'^featureGates:[ \t]*(.*)$', config, re.MULTILINE))
    if len(sections) != 1:
        return None
    header = sections[0]
    inline = header[1].split('#', 1)[0].strip()
    if inline:
        if not (inline.startswith('{') and inline.endswith('}')):
            return None
        content = inline[1:-1]
    else:
        lines = []
        for line in config[header.end():].splitlines():
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            if not line[0].isspace():
                break
            lines.append(line)
        content = '\n'.join(lines)
    matches = re.findall(r'(?:^|[,\n])[ \t]*["\']?' + re.escape(name) + r'["\']?[ \t]*:[ \t]*(true|false)(?=[ \t]*(?:$|[,#\n]))', content)
    return matches[0] if len(matches) == 1 else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kubelet-config', default='/var/lib/kubelet/config.yaml')
    args = parser.parse_args()
    pid = int(command('systemctl', 'show', '--property=MainPID', '--value', 'kubelet'))
    arguments = pathlib.Path('/proc', str(pid), 'cmdline').read_bytes().decode().split('\0')
    flags = {}
    for index, argument in enumerate(arguments):
        if argument.startswith('--'):
            key, _, value = argument[2:].partition('=')
            parsed = value or (arguments[index + 1] if index + 1 < len(arguments) and not arguments[index + 1].startswith('--') else '')
            flags[key] = flags.get(key, '') + ',' + parsed if key == 'feature-gates' else parsed
    config_path = flags.get('config') or args.kubelet_config
    kubelet_config = pathlib.Path(config_path).read_text()
    def kubelet_value(key):
        match = re.search(r'^' + re.escape(key) + r':[ \t]*([^\n#]+)', kubelet_config, re.MULTILINE)
        return match[1].strip().strip("\"'") if match else ''
    config = tomllib.loads(command('containerd', 'config', 'dump'))
    version = config.get('version')
    plugin = 'io.containerd.cri.v1.runtime' if version == 3 else 'io.containerd.grpc.v1.cri'
    runtime = config.get('plugins', {}).get(plugin, {}).get('containerd', {}).get('runtimes', {}).get('sysbox-runc', {})
    options = runtime.get('options', {})
    release = dict(line.split('=', 1) for line in pathlib.Path('/etc/os-release').read_text().splitlines() if '=' in line)
    checks = {
        'supported_ubuntu_worker': release.get('ID', '').strip('"') == 'ubuntu' and release.get('VERSION_ID', '').strip('"') in ('20.04', '22.04', '24.04'),
        'unified_cgroup_v2': command('stat', '-f', '-c', '%T', '/sys/fs/cgroup') == 'cgroup2fs',
        'no_uninspected_kubelet_dropins': not flags.get('config-dir'),
        'kubernetes_version_qualified': bool(re.search(r'\bv1\.35\.', command('/proc/' + str(pid) + '/exe', '--version'))),
        'exclusive_cpu_quota_optimization_disabled': feature_gate(kubelet_config, flags, 'DisableCPUQuotaWithExclusiveCPUs') == 'false',
        'cpu_manager_static': (flags.get('cpu-manager-policy') or kubelet_value('cpuManagerPolicy')) == 'static',
        'cpu_cfs_quota_enabled': (flags.get('cpu-cfs-quota') or kubelet_value('cpuCFSQuota')) != 'false',
        'pod_cgroup_parent_enabled': (flags.get('cgroups-per-qos') or kubelet_value('cgroupsPerQOS')) != 'false',
        'containerd_config_version_supported': version in (2, 3),
        'fusermount3_installed': shutil.which('fusermount3') is not None,
        'native_sysbox_runtime': runtime.get('runtime_type') == 'io.containerd.runc.v2',
        'sysbox_binary': options.get('BinaryName') == '/usr/bin/sysbox-runc' and pathlib.Path('/usr/bin/sysbox-runc').is_file(),
        'systemd_cgroups': options.get('SystemdCgroup') is True,
    }
    for service in ('sysbox-fs', 'sysbox-mgr', 'lxcfs', 'containerd', 'kubelet'):
        checks[service + '_active'] = command('systemctl', 'is-active', service) == 'active'
    service = command('systemctl', 'show', '--property=ExecStart', 'lxcfs')
    checks['lxcfs_cfs_quota_enabled'] = '--enable-cfs' in service
    for path in ('proc/cpuinfo', 'proc/meminfo', 'proc/stat', 'proc/swaps', 'proc/uptime', 'sys/devices/system/cpu'):
        checks['lxcfs_' + path] = pathlib.Path('/var/lib/lxcfs', path).exists()
    checks['lxcfs_fuse_mounted'] = 'fuse.lxcfs' in command('findmnt', '-n', '-o', 'FSTYPE', '/var/lib/lxcfs')
    print(json.dumps({'checks': checks, 'configuration_valid': all(checks.values()),
                      'ready_for_workspaces': False,
                      'next': 'Run real native Sysbox/LXCFS Guaranteed pod; verify finite parent cpu.max/memory.max, cpuset, btop and ephemeral hard limits.'}, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, subprocess.CalledProcessError, ValueError) as exc:
        print('Sysbox preflight failed: ' + str(exc), file=sys.stderr)
        sys.exit(1)
