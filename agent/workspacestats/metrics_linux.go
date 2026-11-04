// Package workspacestats collects Linux workspace metrics in the format displayed by the dashboard.
package workspacestats

import (
	"context"
	"fmt"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/natefinch/atomic"
	"golang.org/x/sys/unix"
	"golang.org/x/xerrors"

	"github.com/coder/clistat"
)

// Collect returns one current measurement. Each invocation runs as the workspace user.
func Collect(ctx context.Context, key string) (string, error) {
	switch key {
	case "net":
		raw, err := os.ReadFile("/proc/net/dev")
		if err != nil {
			return "", err
		}
		return networkTotals(string(raw))
	case "load":
		load, err := workspaceLoad(ctx)
		if err != nil {
			return "", err
		}
		return formatLoad(load, cpuLimit()), nil
	case "load_host":
		raw, err := os.ReadFile("/proc/loadavg")
		if err != nil {
			return "", err
		}
		fields := strings.Fields(string(raw))
		if len(fields) == 0 {
			return "", xerrors.New("empty host load sample")
		}
		load, err := strconv.ParseFloat(fields[0], 64)
		if err != nil {
			return "", err
		}
		cpus, err := os.ReadFile("/proc/stat")
		if err != nil {
			return "", err
		}
		return formatLoad(load, float64(strings.Count(string(cpus), "\ncpu"))), nil
	}
	stat, err := clistat.New()
	if err != nil {
		return "", err
	}
	var result *clistat.Result
	switch key {
	case "ram", "ram_host":
		inContainer, err := stat.IsContainerized()
		if err != nil {
			return "", err
		}
		if inContainer && key == "ram" {
			result, err = stat.ContainerMemory(clistat.PrefixGibi)
		} else {
			result, err = stat.HostMemory(clistat.PrefixGibi)
		}
		if err != nil {
			return "", err
		}
		return formatBytes(result, 2), nil
	case "disk_host":
		result, err = stat.Disk(clistat.PrefixGibi, "/")
	case "disk":
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return "", homeErr
		}
		result, err = stat.Disk(clistat.PrefixGibi, home)
		if err == nil {
			volume := volumeBytes(os.Getenv("CODER_HOME_DISK_SIZE"))
			if volume > 0 && result.Total != nil && *result.Total > volume*1.1 {
				used, usageErr := allocatedBytes(ctx, home)
				if usageErr != nil {
					return "", usageErr
				}
				result.Used = float64(used)
				result.Total = &volume
				err = atomic.WriteFile("/tmp/coder-home-disk", strings.NewReader(fmt.Sprintf("%.0f %d\n", volume, used)))
			} else if removeErr := os.Remove("/tmp/coder-home-disk"); removeErr != nil && !os.IsNotExist(removeErr) {
				return "", removeErr
			}
		}
	default:
		return "", xerrors.Errorf("unknown workspace measurement %q", key)
	}
	if err != nil {
		return "", err
	}
	return formatBytes(result, 1), nil
}

func networkTotals(raw string) (string, error) {
	var rx, tx uint64
	for _, line := range strings.Split(raw, "\n") {
		iface, samples, ok := strings.Cut(line, ":")
		if !ok || strings.TrimSpace(iface) == "lo" {
			continue
		}
		fields := strings.Fields(samples)
		if len(fields) < 9 {
			return "", xerrors.New("incomplete network counters")
		}
		in, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			return "", err
		}
		out, err := strconv.ParseUint(fields[8], 10, 64)
		if err != nil {
			return "", err
		}
		rx += in
		tx += out
	}
	return fmt.Sprintf("%d %d", rx, tx), nil
}

func formatBytes(r *clistat.Result, precision int) string {
	if r.Total == nil || *r.Total <= 0 {
		return fmt.Sprintf("%.*f GB", precision, r.Used/1e9)
	}
	return fmt.Sprintf("%.*f/%.*f GB (%.0f%%)", precision, r.Used/1e9, precision, *r.Total/1e9, 100*r.Used / *r.Total)
}

func volumeBytes(raw string) float64 {
	for _, unit := range []struct {
		suffix string
		scale  float64
	}{
		{"Ki", 1 << 10},
		{"Mi", 1 << 20},
		{"Gi", 1 << 30},
		{"Ti", 1 << 40},
		{"Pi", 1 << 50},
		{"k", 1e3},
		{"K", 1e3},
		{"M", 1e6},
		{"G", 1e9},
		{"T", 1e12},
		{"P", 1e15},
		{"", 1},
	} {
		if number, ok := strings.CutSuffix(raw, unit.suffix); ok {
			n, err := strconv.ParseFloat(number, 64)
			if err == nil && n > 0 && !math.IsInf(n, 0) {
				return n * unit.scale
			}
		}
	}
	return 0
}

// A directory-backed PVC shares a much larger filesystem. Count its allocated blocks,
// excluding other mounts and counting hard links only once.
func allocatedBytes(ctx context.Context, home string) (int64, error) {
	var root unix.Stat_t
	if err := unix.Stat(home, &root); err != nil {
		return 0, err
	}
	seen := map[uint64]bool{}
	var used int64
	err := filepath.WalkDir(home, func(path string, d fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil && path == home {
			return walkErr
		}
		if walkErr != nil {
			return nil
		}
		var st unix.Stat_t
		if err := unix.Lstat(path, &st); err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if st.Dev != root.Dev {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.IsDir() && st.Nlink > 1 {
			if seen[st.Ino] {
				return nil
			}
			seen[st.Ino] = true
		}
		used += st.Blocks * 512
		return nil
	})
	return used, err
}

func formatLoad(load, cores float64) string {
	percent := 0.0
	if cores > 0 {
		percent = 100 * load / cores
	}
	return fmt.Sprintf("%.2f / %g cores (%.0f%%)", load, cores, percent)
}

func cpuLimit() float64 {
	data, _ := os.ReadFile("/sys/fs/cgroup/cpu.max")
	var quota, period float64
	if _, err := fmt.Sscan(string(data), &quota, &period); err != nil {
		q, _ := os.ReadFile("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")
		p, _ := os.ReadFile("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
		_, _ = fmt.Sscan(string(q), &quota)
		_, _ = fmt.Sscan(string(p), &period)
	}
	if period > 0 && quota > 0 {
		return quota / period
	}
	return float64(runtime.NumCPU())
}

func workspaceLoad(ctx context.Context) (float64, error) {
	var total int
	for i := range 5 {
		if i > 0 {
			select {
			case <-ctx.Done():
				return 0, ctx.Err()
			case <-time.After(100 * time.Millisecond):
			}
		}
		procs, err := os.ReadDir("/proc")
		if err != nil {
			return 0, err
		}
		for _, proc := range procs {
			pid, err := strconv.Atoi(proc.Name())
			if err != nil || pid == os.Getpid() {
				continue
			}
			cmdline, _ := os.ReadFile(filepath.Join("/proc", proc.Name(), "cmdline"))
			if strings.Contains(string(cmdline), "coder\x00stat\x00") {
				continue
			}
			threads, _ := filepath.Glob(filepath.Join("/proc", proc.Name(), "task", "*", "stat"))
			for _, thread := range threads {
				stat, err := os.ReadFile(thread)
				if err != nil {
					continue
				}
				pos := strings.LastIndexByte(string(stat), ')') + 2
				if pos >= 2 && pos < len(stat) && (stat[pos] == 'R' || stat[pos] == 'D') {
					total++
				}
			}
		}
	}
	now := float64(time.Now().UnixMilli()) / 1000
	avg := float64(total) / 5
	const file = "/tmp/.coder-metadata-load"
	last, _ := os.ReadFile(file)
	var at, prev float64
	if _, err := fmt.Sscan(string(last), &at, &prev); err == nil && now >= at && now-at < 600 && prev >= 0 && !math.IsInf(prev, 0) {
		weight := math.Exp(-(now - at) / 60)
		avg = prev*weight + avg*(1-weight)
	}
	return avg, atomic.WriteFile(file, strings.NewReader(fmt.Sprintf("%.6f %.6f\n", now, avg)))
}
