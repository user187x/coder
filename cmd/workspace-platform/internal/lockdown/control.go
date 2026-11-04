//go:build linux

package workspacelockdown

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"golang.org/x/xerrors"
)

const (
	sudoRule   = "etc/sudoers.d/zz-coder-lockdown"
	frozenFile = "run/coder-lockdown-frozen"
	sudoDeny   = "# Coder workspace Lock Down\nALL ALL=(ALL:ALL) !ALL\n"
)

func readPolicy(raw string) (string, error) {
	if file, ok := strings.CutPrefix(raw, "file:"); ok {
		b, err := os.ReadFile(file)
		switch {
		case os.IsNotExist(err):
			raw = "off"
		case err != nil:
			return "", err
		default:
			raw = strings.TrimSpace(string(b))
		}
	}
	if raw == "" {
		return "off", nil
	}
	return raw, nil
}

func parseModes(raw string) (map[string]bool, error) {
	modes := map[string]bool{}
	for _, m := range strings.Split(raw, ",") {
		switch m {
		case "", "off":
			continue
		case "sudo", "network", "freeze", "sandbox":
			modes[m] = true
		default:
			return nil, xerrors.Errorf("invalid lockdown mode %q", m)
		}
	}
	return modes, nil
}

func writePolicy(root *os.Root, path, data string, mode os.FileMode) error {
	tmp := path + ".new-" + rand.Text()
	f, err := root.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer func() { _ = root.Remove(tmp) }()
	if _, err = io.WriteString(f, data); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return root.Rename(tmp, path)
}

func setSudo(root *os.Root, modes map[string]bool) error {
	if modes["sudo"] {
		return writePolicy(root, sudoRule, sudoDeny, 0o440)
	}
	if err := root.Remove(sudoRule); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func start(ctx context.Context, policy string) error {
	value, err := readPolicy(policy)
	if err != nil {
		return err
	}
	modes, err := parseModes(value)
	if err != nil || !modes["sudo"] {
		return err
	}
	if os.Geteuid() != 0 {
		exe, err := os.Executable()
		if err != nil {
			return err
		}
		cmd := exec.CommandContext(ctx, "sudo", "-n", exe, "lockdown", "start", policy)
		cmd.Stderr = os.Stderr
		return cmd.Run()
	}
	root, err := os.OpenRoot("/")
	if err != nil {
		return err
	}
	defer root.Close()
	return setSudo(root, modes)
}

type process struct {
	pid          int
	start, state string
}

// Match tasks in the target PID namespace, including nested workspace sandboxes.
// Exclude PID 1 and the maintenance container's own processes.
func workspaceProcess(pid int) (process, bool) {
	if pid <= 1 {
		return process{}, false
	}
	path := filepath.Join("/proc", strconv.Itoa(pid))
	theirs, err := os.Stat(filepath.Join(path, "root"))
	if err != nil {
		return process{}, false
	}
	ours, err := os.Stat("/proc/self/root")
	if err != nil || os.SameFile(ours, theirs) {
		return process{}, false
	}
	b, err := os.ReadFile(filepath.Join(path, "stat"))
	if err != nil {
		return process{}, false
	}
	i := strings.LastIndex(string(b), ") ")
	if i < 0 {
		return process{}, false
	}
	fields := strings.Fields(string(b[i+2:]))
	if len(fields) < 20 {
		return process{}, false
	}
	return process{pid: pid, state: fields[0], start: fields[19]}, true
}

func frozenProcesses(root *os.Root, modes map[string]bool, out io.Writer) error {
	raw, err := root.ReadFile(frozenFile)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	recorded := map[int]string{}
	for _, line := range strings.Split(string(raw), "\n") {
		f := strings.Fields(line)
		if len(f) == 0 {
			continue
		}
		pid, e := strconv.Atoi(f[0])
		if e != nil || pid <= 1 {
			continue
		}
		born := ""
		if len(f) > 1 {
			born = f[1]
		}
		recorded[pid] = born
	}
	if !modes["freeze"] {
		for pid, born := range recorded {
			p, ok := workspaceProcess(pid)
			if !ok || (born != "" && p.start != born) {
				continue
			}
			if err := syscall.Kill(pid, syscall.SIGCONT); err != nil && !errors.Is(err, syscall.ESRCH) {
				return err
			}
		}
		if err := root.Remove(frozenFile); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	f, err := root.OpenFile(frozenFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	for range 3 {
		dirs, err := os.ReadDir("/proc")
		if err != nil {
			return err
		}
		for _, d := range dirs {
			pid, _ := strconv.Atoi(d.Name())
			p, ok := workspaceProcess(pid)
			if !ok || p.state == "T" || p.state == "t" || p.state == "Z" {
				continue
			}
			if born, seen := recorded[pid]; !seen || p.start != born {
				if _, err = fmt.Fprintf(f, "%d %s\n", pid, p.start); err != nil {
					return err
				}
				recorded[pid] = p.start
			}
			if err = syscall.Kill(pid, syscall.SIGSTOP); err != nil && !errors.Is(err, syscall.ESRCH) {
				return err
			}
		}
	}
	for pid, born := range recorded {
		p, ok := workspaceProcess(pid)
		if !ok || (born != "" && p.start != born) {
			continue
		}
		cmd, _ := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
		if len(cmd) > 200 {
			cmd = cmd[:200]
		}
		if _, err := fmt.Fprintf(out, "lockdown:   %d %s\n", pid, strings.ReplaceAll(string(cmd), "\x00", " ")); err != nil {
			return err
		}
	}
	return nil
}

// Run applies the requested modes, or enforces the startup sudo rule as the workspace user.
func Run(ctx context.Context, args []string, out io.Writer) error {
	if len(args) == 2 && args[0] == "start" {
		return start(ctx, args[1])
	}
	if len(args) < 2 || len(args) > 5 {
		return xerrors.New("expected modes, control host, and optional target root, control IPs and peer IPs")
	}
	raw, err := readPolicy(args[0])
	if err != nil {
		return err
	}
	modes, err := parseModes(raw)
	if err != nil {
		return err
	}
	var root *os.Root
	if len(args) > 2 && args[2] != "" {
		root, err = os.OpenRoot(args[2])
		if err != nil {
			return err
		}
		defer root.Close()
	}
	var ips, peers string
	if len(args) > 3 {
		ips = args[3]
	}
	if len(args) > 4 {
		peers = args[4]
	}
	locked := modes["network"] || modes["sandbox"]
	if err := applyNetwork(ctx, modes, args[1], ips, peers, root); err != nil {
		return err
	}
	if root != nil {
		if err := setSudo(root, modes); err != nil {
			return err
		}
		if err := frozenProcesses(root, modes, out); err != nil {
			return err
		}
	}
	if _, err := fmt.Fprintf(out, "lockdown: modes %s\n", raw); err != nil {
		return err
	}
	_, err = fmt.Fprintf(out, "lockdown: network %t, sudo %t, freeze %t\n", locked, modes["sudo"], modes["freeze"])
	return err
}
