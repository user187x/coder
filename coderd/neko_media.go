package coderd

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/httpmw"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/coderd/rbac/policy"
	"github.com/coder/coder/v2/coderd/workspaceapps"
	"github.com/coder/coder/v2/coderd/workspaceapps/medialease"
	"github.com/coder/coder/v2/coderd/workspacequarantine"
)

// NekoMediaConfig contains explicit operator-owned LAN relay configuration.
// It is not a public deployment response and must never be serialized or logged.
type NekoMediaConfig struct {
	Relay            medialease.Config
	Client           *workspaceapps.NekoClient
	DescriptorOrigin *url.URL
	descriptorKey    string
}

// NekoMediaConfigFromEnv is disabled unless CODER_NEKO_MEDIA_CONFIG explicitly
// enables it. Enabling never creates a public Service or exposes guest HTTP.
func NekoMediaConfigFromEnv(getenv func(string) string) (*NekoMediaConfig, error) {
	raw := getenv("CODER_NEKO_MEDIA_CONFIG")
	if raw == "" {
		return nil, nil
	}
	if len(raw) > 16384 {
		return nil, errors.New("neko media configuration exceeds its bound")
	}
	var value struct {
		Enabled              bool     `json:"enabled"`
		BindIP               string   `json:"bind_ip"`
		AdvertiseIP          string   `json:"advertise_ip"`
		ClientCIDRs          []string `json:"client_cidrs"`
		PeerCIDRs            []string `json:"peer_cidrs"`
		PortMin              uint16   `json:"port_min"`
		PortMax              uint16   `json:"port_max"`
		MaxLeases            int      `json:"max_leases"`
		PacketsPerSecond     int      `json:"packets_per_second"`
		LifetimeMS           int      `json:"lifetime_ms"`
		DescriptorOrigin     string   `json:"descriptor_origin"`
		DescriptorKeyFile    string   `json:"descriptor_key_file"`
		ClientDirectory      string   `json:"client_directory"`
		ClientManifestSHA256 string   `json:"client_manifest_sha256"`
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return nil, fmt.Errorf("decode Neko media configuration: %w", err)
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("neko media configuration has trailing content")
	}
	if !value.Enabled {
		return nil, nil
	}
	if value.BindIP == "" {
		value.BindIP = getenv("CODER_NEKO_MEDIA_BIND_IP")
	}
	bind, err := netip.ParseAddr(value.BindIP)
	if err != nil {
		return nil, errors.New("neko media bind IP is required")
	}
	advertised, err := netip.ParseAddr(value.AdvertiseIP)
	if err != nil {
		return nil, errors.New("neko media advertised LAN IP is required")
	}
	origin, err := url.Parse(value.DescriptorOrigin)
	if err != nil || origin.Host == "" || origin.User != nil || (origin.Scheme != "http" && origin.Scheme != "https") || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" {
		return nil, errors.New("neko descriptor requires a fixed internal HTTP(S) origin")
	}
	if !filepath.IsAbs(value.DescriptorKeyFile) || !filepath.IsAbs(value.ClientDirectory) {
		return nil, errors.New("neko media requires operator-mounted absolute key and client paths")
	}
	file, err := os.Open(value.DescriptorKeyFile)
	if err != nil {
		return nil, fmt.Errorf("open Neko descriptor key: %w", err)
	}
	info, statErr := file.Stat()
	if statErr != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o027 != 0 {
		_ = file.Close()
		return nil, errors.New("neko descriptor key is not a private regular file")
	}
	key, err := io.ReadAll(io.LimitReader(file, 513))
	_ = file.Close()
	if err != nil {
		return nil, err
	}
	secret := strings.TrimSpace(string(key))
	decoded, err := hex.DecodeString(secret)
	if err != nil || len(key) > 512 || len(decoded) != 32 || secret != strings.ToLower(secret) {
		return nil, errors.New("neko descriptor key must contain 256 bits of lowercase hex-encoded randomness")
	}
	client, err := workspaceapps.LoadNekoClient(os.DirFS(value.ClientDirectory), value.ClientManifestSHA256)
	if err != nil {
		return nil, err
	}
	if value.LifetimeMS == 0 {
		value.LifetimeMS = 3000
	}
	if value.PacketsPerSecond == 0 {
		value.PacketsPerSecond = 10000
	}
	relay := medialease.Config{Enabled: true, BindIP: bind, AdvertiseIP: advertised, PortMin: value.PortMin, PortMax: value.PortMax, MaxLeases: value.MaxLeases, Lifetime: time.Duration(value.LifetimeMS) * time.Millisecond, PacketsPerSecond: value.PacketsPerSecond}
	for _, pair := range []struct {
		values []string
		target *[]netip.Prefix
	}{{value.ClientCIDRs, &relay.ClientPrefixes}, {value.PeerCIDRs, &relay.PeerPrefixes}} {
		for _, text := range pair.values {
			prefix, err := netip.ParsePrefix(text)
			if err != nil {
				return nil, errors.New("neko media network is invalid")
			}
			*pair.target = append(*pair.target, prefix)
		}
	}
	return &NekoMediaConfig{Relay: relay, Client: client, DescriptorOrigin: origin, descriptorKey: secret}, nil
}

type nekoRuntimeDescriptor struct {
	Version          int            `json:"version"`
	OrganizationID   uuid.UUID      `json:"organization_id"`
	WorkspaceID      uuid.UUID      `json:"workspace_id"`
	WorkspaceOwnerID uuid.UUID      `json:"workspace_owner_id"`
	BuildID          uuid.UUID      `json:"build_id"`
	AgentID          uuid.UUID      `json:"agent_id"`
	NodeUID          uuid.UUID      `json:"node_uid"`
	VMUID            uuid.UUID      `json:"vm_uid"`
	VMIUID           uuid.UUID      `json:"vmi_uid"`
	Peer             netip.AddrPort `json:"peer"`
	HTTPOrigin       string         `json:"http_origin"`
}

func (api *API) configureNekoMedia(cfg *NekoMediaConfig) (*workspaceapps.NekoMedia, error) {
	if cfg == nil {
		return nil, nil
	}
	if cfg.DescriptorOrigin == nil || cfg.Client == nil || len(cfg.descriptorKey) != 64 || !cfg.Relay.Enabled {
		return nil, errors.New("neko media configuration is incomplete")
	}
	client := &http.Client{Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }, Transport: &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: time.Second}).DialContext, ResponseHeaderTimeout: time.Second, TLSHandshakeTimeout: time.Second, MaxIdleConns: 4, MaxIdleConnsPerHost: 4, MaxConnsPerHost: 8}}
	resolve := func(ctx context.Context, requested medialease.Binding) (medialease.Binding, error) {
		return api.resolveNekoMedia(ctx, cfg, client, requested)
	}
	relayCfg := cfg.Relay
	relayCfg.Clock = api.Clock
	relayCfg.Guard = func(ctx context.Context, b medialease.Binding) (context.Context, func(), error) {
		guarded, endGlobal, err := api.guardGlobalLockdownSession(ctx, b.UserID)
		if err != nil {
			return nil, nil, err
		}
		guarded, endWorkspace, err := api.guardWorkspaceQuarantineSession(guarded, b.WorkspaceID)
		if err != nil {
			endGlobal()
			return nil, nil, err
		}
		if api.NekoMediaContext == nil {
			return guarded, func() { endWorkspace(); endGlobal() }, nil
		}
		serving := api.NekoMediaContext()
		if serving == nil || serving.Err() != nil {
			endWorkspace()
			endGlobal()
			return nil, nil, errors.New("neko relay replica is fenced")
		}
		guarded, cancel := context.WithCancel(guarded)
		stop := context.AfterFunc(serving, cancel)
		return guarded, func() { stop(); cancel(); endWorkspace(); endGlobal() }, nil
	}
	relayCfg.Check = func(ctx context.Context, b medialease.Binding) error {
		current, err := resolve(ctx, b)
		if err != nil {
			return err
		}
		if current != b {
			return errors.New("neko media runtime or authorization revision changed")
		}
		return nil
	}
	relay, err := medialease.New(relayCfg)
	if err != nil {
		return nil, err
	}
	gateway, err := workspaceapps.NewNekoMedia(workspaceapps.NekoMediaOptions{Relay: relay, Clock: api.Clock, Client: cfg.Client, Cleanup: client.CloseIdleConnections,
		Resolve: func(ctx context.Context, token workspaceapps.SignedToken, ip netip.Addr, session uuid.UUID) (medialease.Binding, error) {
			return resolve(ctx, medialease.Binding{UserID: token.UserID, WorkspaceID: token.WorkspaceID, AgentID: token.AgentID, ClientIP: ip, SessionID: session})
		},
	})
	if err != nil {
		_ = relay.Close()
		return nil, err
	}
	return gateway, nil
}

func (api *API) resolveNekoMedia(ctx context.Context, cfg *NekoMediaConfig, client *http.Client, requested medialease.Binding) (medialease.Binding, error) {
	if api.NekoMediaContext != nil {
		serving := api.NekoMediaContext()
		if serving == nil || serving.Err() != nil {
			return requested, errors.New("neko relay replica is fenced")
		}
	}
	// The signed app request authenticates the user. These reads independently
	// verify the exact current target before handing out infrastructure media.
	system := dbauthz.AsSystemRestricted(ctx) //nolint:gocritic // Fixed authenticated app target, never arbitrary user metadata.
	workspace, err := api.Database.GetWorkspaceByID(system, requested.WorkspaceID)
	if err != nil || workspace.Deleted {
		return requested, errors.New("neko workspace is unavailable")
	}
	subject, status, err := httpmw.UserRBACSubject(ctx, api.Database, requested.UserID, rbac.ScopeAll)
	if err != nil || status != database.UserStatusActive {
		return requested, errors.New("neko account authorization is unavailable")
	}
	if err := api.Authorizer.Authorize(ctx, subject, policy.ActionApplicationConnect, workspace.RBACObject()); err != nil {
		return requested, err
	}
	lockdown, err := api.globalLockdown.Load(ctx)
	if err != nil || lockdown.Enabled && !api.globalLockdown.Admin(ctx, requested.UserID) {
		return requested, errors.New("neko workspace access is locked")
	}
	quarantine, err := workspacequarantine.Load(ctx, api.Database, workspace.ID)
	if err != nil || workspacequarantine.Blocked(quarantine) {
		return requested, errors.New("neko workspace is quarantined")
	}
	build, err := api.Database.GetLatestWorkspaceBuildByWorkspaceID(system, workspace.ID)
	if err != nil || build.Transition != database.WorkspaceTransitionStart {
		return requested, errors.New("neko workspace build is not running")
	}
	job, err := api.Database.GetProvisionerJobByID(system, build.JobID)
	if err != nil || job.JobStatus != database.ProvisionerJobStatusSucceeded {
		return requested, errors.New("neko workspace build is not ready")
	}
	agent, err := api.Database.GetWorkspaceAgentByID(system, requested.AgentID)
	if err != nil {
		return requested, err
	}
	resource, err := api.Database.GetWorkspaceResourceByID(system, agent.ResourceID)
	if err != nil || resource.JobID != build.JobID {
		return requested, errors.New("neko agent does not belong to the current build")
	}
	app, err := api.Database.GetWorkspaceAppByAgentIDAndSlug(system, database.GetWorkspaceAppByAgentIDAndSlugParams{AgentID: requested.AgentID, Slug: "neko"})
	if err != nil || !app.Subdomain || app.SharingLevel != database.AppSharingLevelOwner || app.External || !app.Url.Valid || app.Url.String != "http://127.0.0.1:9080" {
		return requested, errors.New("neko is not the reviewed owner-only app")
	}
	origin := *cfg.DescriptorOrigin
	origin.Path = "/__coder-ui/internal/organizations/" + workspace.OrganizationID.String() + "/workspaces/" + workspace.ID.String() + "/neko-media"
	query := url.Values{"build_id": {build.ID.String()}, "agent_id": {agent.ID.String()}}
	origin.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, origin.String(), nil)
	if err != nil {
		return requested, err
	}
	request.Header.Set("X-Coder-Media-Descriptor-Key", cfg.descriptorKey)
	response, err := client.Do(request)
	if err != nil {
		return requested, errors.New("neko infrastructure descriptor is unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return requested, errors.New("neko infrastructure descriptor is not ready")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 16385))
	if err != nil || len(raw) > 16384 {
		return requested, errors.New("neko infrastructure descriptor exceeds its bound")
	}
	var descriptor nekoRuntimeDescriptor
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&descriptor); err != nil {
		return requested, errors.New("neko infrastructure descriptor is invalid")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return requested, errors.New("neko infrastructure descriptor has trailing content")
	}
	if descriptor.Version != 1 || descriptor.OrganizationID != workspace.OrganizationID || descriptor.WorkspaceID != workspace.ID || descriptor.WorkspaceOwnerID != workspace.OwnerID || descriptor.BuildID != build.ID || descriptor.AgentID != agent.ID || descriptor.NodeUID == uuid.Nil || descriptor.VMUID == uuid.Nil || descriptor.VMIUID == uuid.Nil || !descriptor.Peer.Addr().Is4() || descriptor.Peer.Port() != 59000 || descriptor.HTTPOrigin != "http://127.0.0.1:9080" {
		return requested, errors.New("neko infrastructure identity differs from the current workspace")
	}
	revision := sha256.Sum256([]byte(lockdown.Revision + "\n" + quarantine.Revision.String()))
	requested.OrganizationID = workspace.OrganizationID
	requested.BuildID = build.ID
	requested.NodeUID = descriptor.NodeUID
	requested.VMUID = descriptor.VMUID
	requested.VMIUID = descriptor.VMIUID
	requested.Peer = descriptor.Peer
	requested.AccessRevision = hex.EncodeToString(revision[:])
	return requested, nil
}
