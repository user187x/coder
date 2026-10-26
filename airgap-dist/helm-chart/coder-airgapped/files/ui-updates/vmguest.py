"""Private, ownership-fenced QGA delivery through Kubernetes exec stdin."""
import base64
import json
import time

import kexec

# The request is stdin, never a Kubernetes exec URL argument or audit command.
WRAPPER = r'''set -euo pipefail
IFS= read -r -n 262145 request
[ "${#request}" -le 262144 ] || exit 1
case "$request" in
  '{"execute":"guest-file-open","arguments":'*|'{"execute":"guest-file-write","arguments":'*|'{"execute":"guest-file-close","arguments":'*|'{"execute":"guest-file-read","arguments":'*|'{"execute":"guest-exec","arguments":'*|'{"execute":"guest-exec-status","arguments":'*) ;;
  *) exit 1 ;;
esac
virsh --connect qemu:///session qemu-agent-command "$1" "$request" --timeout 10 2>/dev/null | head -c 65537
'''



class Guest:
    def __init__(self, kube, namespace, vm, instance, pod):
        self.kube, self.namespace = kube, namespace
        self.vm, self.instance, self.pod = vm, instance, pod

    def fence(self):
        for kind, original in (("virtualmachines", self.vm), ("virtualmachineinstances", self.instance)):
            metadata = original["metadata"]
            status, current = self.kube.call("GET", "/apis/kubevirt.io/v1/namespaces/%s/%s/%s" %
                                             (self.namespace, kind, metadata["name"]))
            if status != 200 or any(current.get("metadata", {}).get(k) != metadata[k] for k in ("uid", "resourceVersion")):
                raise RuntimeError("Guest configuration target changed.")
        vm, instance, pod = self.vm, self.instance, self.pod
        if vm.get("spec", {}).get("runStrategy") != "Always" or not any(
                o.get("controller") and o.get("kind") == "VirtualMachine" and o.get("uid") == vm["metadata"]["uid"]
                for o in instance["metadata"].get("ownerReferences", [])):
            raise RuntimeError("Guest configuration controller mismatch.")
        status, live = self.kube.call("GET", "/api/v1/namespaces/%s/pods/%s" % (self.namespace, pod["metadata"]["name"]))
        if status != 200 or live.get("metadata", {}).get("uid") != pod["metadata"]["uid"] or live.get("metadata", {}).get("deletionTimestamp") or not any(
                o.get("controller") and o.get("kind") == "VirtualMachineInstance" and o.get("uid") == instance["metadata"]["uid"]
                for o in live.get("metadata", {}).get("ownerReferences", [])):
            raise RuntimeError("Guest configuration launcher mismatch.")
        def boot(obj):
            return next((v.get("cloudInitNoCloud", {}).get("secretRef", {}).get("name")
                         for v in obj.get("spec", {}).get("volumes", []) if v.get("name") == "cloudinit"), None)
        if not boot(instance) or boot(instance) != boot(vm["spec"]["template"]):
            raise RuntimeError("Guest configuration profile changed.")

    def _request(self, execute, arguments):
        self.fence()
        data = (json.dumps({"execute": execute, "arguments": arguments}, separators=(",", ":")) + "\n").encode()
        if len(data) > 262144:
            raise ValueError("Guest configuration exceeds delivery limit.")
        domain = self.namespace + "_" + self.vm["metadata"]["name"]
        rc, out, _ = kexec.exec_in(self.kube, self.namespace, self.pod["metadata"]["name"], "compute",
                                  ["bash", "-c", WRAPPER, "coder-qga", domain], stdin=data, timeout=20)
        if rc:
            raise RuntimeError("Private guest configuration delivery failed.")
        try:
            if len(out) > 65536:
                raise ValueError("Guest acknowledgement exceeds its bound.")
            response = json.loads(out)
            if not isinstance(response, dict) or "error" in response or "return" not in response:
                raise ValueError("Guest command was rejected.")
            return response["return"]
        except (ValueError, TypeError) as exc:
            raise RuntimeError("Private guest configuration returned an invalid acknowledgement.") from exc

    def deliver(self, config):
        """Write a private config atomically through the fixed guest apply command."""
        data = json.dumps(config, separators=(",", ":")).encode()
        if len(data) > 131072:
            raise ValueError("Private guest configuration exceeds delivery limit.")
        handle = self._request("guest-file-open", {"path": "/etc/coder-workspace/private-config.next", "mode": "w"})
        if type(handle) is not int or handle < 0:
            raise RuntimeError("Guest file handle was invalid.")
        try:
            result = self._request("guest-file-write", {"handle": handle, "buf-b64": base64.b64encode(data).decode()})
            if not isinstance(result, dict) or result.get("count") != len(data):
                raise RuntimeError("Private guest configuration write was incomplete.")
        finally:
            self._request("guest-file-close", {"handle": handle})
        result = self._request("guest-exec", {"path": "/usr/local/sbin/coder-vm-config-apply", "capture-output": False})
        if not isinstance(result, dict) or type(result.get("pid")) is not int:
            raise RuntimeError("Guest apply did not acknowledge execution.")
        return result["pid"]

    def user_command(self, request, timeout=180):
        """Run only the baked user CLI adapter and read its bounded nonsecret result."""
        data = json.dumps(request, separators=(",", ":")).encode()
        if len(data) > 131072:
            raise ValueError("The user command exceeds its request bound.")
        handle = self._request("guest-file-open", {"path": "/etc/coder-workspace/user-command.next", "mode": "w"})
        try:
            written = self._request("guest-file-write", {"handle": handle, "buf-b64": base64.b64encode(data).decode()})
            if written.get("count") != len(data):
                raise RuntimeError("User command write was incomplete.")
        finally:
            self._request("guest-file-close", {"handle": handle})
        started = self._request("guest-exec", {"path": "/usr/local/sbin/coder-vm-user-command", "capture-output": False})
        pid = started.get("pid")
        if type(pid) is not int:
            raise RuntimeError("Guest user command did not start.")
        deadline = time.monotonic() + min(timeout, 180)
        while not self.applied(pid):
            if time.monotonic() >= deadline:
                raise RuntimeError("Guest user command timed out.")
            time.sleep(0.25)
        handle = self._request("guest-file-open", {"path": "/etc/coder-workspace/user-command-result.json", "mode": "r"})
        output = bytearray()
        try:
            for _ in range(65):
                part = self._request("guest-file-read", {"handle": handle, "count": 16384})
                chunk = base64.b64decode(part.get("buf-b64", ""), validate=True)
                if len(chunk) > 16384 or len(output) + len(chunk) > 1048576 or part.get("count") != len(chunk):
                    raise RuntimeError("Guest user command result exceeded its bound.")
                output.extend(chunk)
                if part.get("eof"):
                    break
                if not chunk:
                    raise RuntimeError("Guest user command result was incomplete.")
            else:
                raise RuntimeError("Guest user command result exceeded its bound.")
        finally:
            self._request("guest-file-close", {"handle": handle})
        result = json.loads(output)
        if not isinstance(result, dict) or result.get("request_id") != request["request_id"]:
            raise RuntimeError("Guest user command result does not match its request.")
        if result.get("error"):
            raise ValueError(str(result["error"])[:1000])
        if type(result.get("exit_code")) is not int or not isinstance(result.get("result"), dict):
            raise RuntimeError("Guest user command returned an invalid result.")
        return result["exit_code"], result["result"]

    def applied(self, pid):
        """Return whether the fixed apply command completed successfully."""
        result = self._request("guest-exec-status", {"pid": pid})
        if not isinstance(result, dict) or not result.get("exited"):
            return False
        if result.get("exitcode") != 0:
            raise RuntimeError("Guest rejected its private configuration.")
        return True
