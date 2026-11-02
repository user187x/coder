#!/bin/bash
set -euo pipefail
cd /opt/coder-research/source
test "$(uname -m)" = x86_64
test -e "/lib/modules/$(uname -r)/build/Makefile"
test -s /sys/kernel/btf/vmlinux
# Guest has loopback only; the workspace's agent network is separate.
test "$(ls /sys/class/net)" = lo
for module in sysfs/kobject_example_obj.ko sysfs/kobject_example_kobj.ko sysfs/kobject_example_kset.ko; do
	insmod "$module"
	rmmod "$(basename "$module" .ko)"
done
insmod input_monitoring/input_monitor.ko
rmmod input_monitor
insmod retrive_process_informations/procinfo_module.ko
rmmod procinfo_module
python3 -m http.server 8000 --bind 127.0.0.1 >/tmp/http.log 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for _ in {1..50}; do
	if wget -q -O /dev/null http://127.0.0.1:8000; then break; fi
	sleep .1
done
wget -q -O /dev/null http://127.0.0.1:8000
insmod process_network_blocker/process_network_blocker.ko
if wget -q -t 1 -T 2 -O /dev/null http://127.0.0.1:8000; then
	echo 'Network blocker did not block its target process' >&2
	exit 1
fi
rmmod process_network_blocker
wget -q -O /dev/null http://127.0.0.1:8000
cd privilege_escalation_monitor
make
stdbuf -oL ./privilege_escalation_monitor >/tmp/credentials.log 2>&1 &
monitor=$!
for _ in {1..50}; do
	if grep -q 'monitor starts' /tmp/credentials.log; then break; fi
	kill -0 "$monitor"
	sleep .1
done
runuser -u researcher -- sudo true
for _ in {1..50}; do
	if grep -q 'Old UID: 1000 New UID: 0' /tmp/credentials.log; then break; fi
	sleep .1
done
kill "$monitor"
grep 'Old UID: 1000 New UID: 0' /tmp/credentials.log
echo 'Guest module, process-network and credential-monitor checks passed'
