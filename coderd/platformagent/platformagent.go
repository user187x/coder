// Package platformagent supplies deployment-owned scripts and metadata to
// Kubernetes workspace agents without changing the template's Terraform.
package platformagent

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"

	"golang.org/x/xerrors"
	"google.golang.org/protobuf/proto"

	sdkproto "github.com/coder/coder/v2/provisionersdk/proto"
)

// Config is a single, atomically projected ConfigMap file. Reading it once per
// build keeps every agent on the same revision without a process restart.
type Config struct {
	Scripts  []*sdkproto.Script         `json:"scripts"`
	Metadata []*sdkproto.Agent_Metadata `json:"metadata"`
}

// Load reads agent.json from directory. An empty directory disables the feature;
// an unreadable or invalid configured file refuses the build.
func Load(directory string) (*Config, error) {
	if directory == "" {
		return &Config{}, nil
	}
	f, err := os.Open(filepath.Join(directory, "agent.json"))
	if err != nil {
		return nil, xerrors.Errorf("open platform agent configuration: %w", err)
	}
	defer f.Close()
	const maxSize = 2 << 20
	data, err := io.ReadAll(io.LimitReader(f, maxSize+1))
	if err != nil {
		return nil, xerrors.Errorf("read platform agent configuration: %w", err)
	}
	if len(data) > maxSize {
		return nil, xerrors.New("platform agent configuration exceeds 2 MiB")
	}
	var config Config
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&config); err != nil {
		return nil, xerrors.Errorf("decode platform agent configuration: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, xerrors.New("platform agent configuration contains trailing data")
	}
	names := make(map[string]bool)
	for _, script := range config.Scripts {
		if script == nil || script.DisplayName == "" || script.Script == "" || script.TimeoutSeconds < 0 {
			return nil, xerrors.New("platform agent script requires a name, source and nonnegative timeout")
		}
		if names[script.DisplayName] {
			return nil, xerrors.Errorf("duplicate platform agent script %q", script.DisplayName)
		}
		names[script.DisplayName] = true
	}
	keys := make(map[string]bool)
	for _, metadata := range config.Metadata {
		if metadata == nil || metadata.Key == "" || metadata.Script == "" || metadata.Interval < 0 || metadata.Timeout < 0 {
			return nil, xerrors.New("platform agent metadata requires a key, source and nonnegative timing")
		}
		if keys[metadata.Key] {
			return nil, xerrors.Errorf("duplicate platform agent metadata %q", metadata.Key)
		}
		keys[metadata.Key] = true
	}
	return &config, nil
}

// Agent returns an independent agent definition with missing platform features
// appended. Template scripts and metadata retain precedence by name and key.
func (c *Config) Agent(resourceType string, agent *sdkproto.Agent) *sdkproto.Agent {
	if c == nil || agent == nil || agent.OperatingSystem != "linux" {
		return agent
	}
	switch resourceType {
	case "kubernetes_pod", "kubernetes_pod_v1", "kubernetes_deployment", "kubernetes_deployment_v1",
		"kubernetes_stateful_set", "kubernetes_stateful_set_v1", "kubernetes_daemon_set", "kubernetes_daemon_set_v1":
	default:
		return agent
	}
	result := proto.CloneOf(agent)
	names := make(map[string]bool, len(result.Scripts))
	for _, script := range result.Scripts {
		names[script.GetDisplayName()] = true
	}
	for _, script := range c.Scripts {
		if !names[script.DisplayName] {
			result.Scripts = append(result.Scripts, proto.CloneOf(script))
		}
	}
	keys := make(map[string]bool, len(result.Metadata))
	for _, metadata := range result.Metadata {
		keys[metadata.GetKey()] = true
	}
	for _, metadata := range c.Metadata {
		if !keys[metadata.Key] {
			result.Metadata = append(result.Metadata, proto.CloneOf(metadata))
		}
	}
	return result
}
