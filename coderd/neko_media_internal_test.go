package coderd

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/coder/quartz"
	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
	"github.com/coder/coder/v2/coderd/database/dbfake"
	"github.com/coder/coder/v2/coderd/database/dbgen"
	"github.com/coder/coder/v2/coderd/database/dbtestutil"
	"github.com/coder/coder/v2/coderd/platformlockdown"
	"github.com/coder/coder/v2/coderd/rbac"
	"github.com/coder/coder/v2/coderd/workspaceapps/medialease"
	"github.com/coder/coder/v2/testutil"
)

func TestNekoTrustedDescriptorAndFreshWorkspaceIdentity(t *testing.T) {
	t.Parallel()
	db, _ := dbtestutil.NewDB(t)
	org := dbgen.Organization(t, db, database.Organization{})
	owner := dbgen.User(t, db, database.User{})
	dbgen.OrganizationMember(t, db, database.OrganizationMember{OrganizationID: org.ID, UserID: owner.ID})
	fixture := dbfake.WorkspaceBuild(t, db, database.WorkspaceTable{OrganizationID: org.ID, OwnerID: owner.ID}).WithAgent().Succeeded().Do()
	require.Len(t, fixture.Agents, 1)
	agent := fixture.Agents[0]
	dbgen.WorkspaceApp(t, db, database.WorkspaceApp{AgentID: agent.ID, Slug: "neko", Url: sql.NullString{Valid: true, String: "http://127.0.0.1:9080"}, Subdomain: true, SharingLevel: database.AppSharingLevelOwner})
	descriptor := nekoRuntimeDescriptor{Version: 1, OrganizationID: org.ID, WorkspaceID: fixture.Workspace.ID, WorkspaceOwnerID: owner.ID, BuildID: fixture.Build.ID, AgentID: agent.ID, NodeUID: uuid.New(), VMUID: uuid.New(), VMIUID: uuid.New(), Peer: netip.MustParseAddrPort("10.244.1.5:59000"), HTTPOrigin: "http://127.0.0.1:9080"}
	var current atomic.Value
	current.Store(descriptor)
	var unavailable atomic.Bool
	key := strings.Repeat("ab", 32)
	root := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/__coder-ui/internal/organizations/"+org.ID.String()+"/workspaces/"+fixture.Workspace.ID.String()+"/neko-media", r.URL.Path)
		require.Equal(t, fixture.Build.ID.String(), r.URL.Query().Get("build_id"))
		require.Equal(t, agent.ID.String(), r.URL.Query().Get("agent_id"))
		require.Equal(t, key, r.Header.Get("X-Coder-Media-Descriptor-Key"))
		require.Empty(t, r.Header.Get("Coder-Session-Token"))
		require.Empty(t, r.Header.Get("Cookie"))
		if unavailable.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		require.NoError(t, json.NewEncoder(w).Encode(current.Load().(nekoRuntimeDescriptor)))
	}))
	defer root.Close()
	origin, err := url.Parse(root.URL)
	require.NoError(t, err)
	api := &API{Options: &Options{Database: db, Authorizer: rbac.NewAuthorizer(prometheus.NewRegistry()), Clock: quartz.NewReal()}}
	api.globalLockdown = platformlockdown.New(db, uuid.New(), api.Clock)
	cfg := &NekoMediaConfig{DescriptorOrigin: origin, descriptorKey: key}
	requested := medialease.Binding{UserID: owner.ID, WorkspaceID: fixture.Workspace.ID, AgentID: agent.ID, SessionID: uuid.New(), ClientIP: netip.MustParseAddr("192.168.1.20")}
	ctx := testutil.Context(t, testutil.WaitLong)
	result, err := api.resolveNekoMedia(ctx, cfg, root.Client(), requested)
	require.NoError(t, err)
	require.Equal(t, descriptor.NodeUID, result.NodeUID)
	require.Equal(t, descriptor.VMIUID, result.VMIUID)
	require.Equal(t, org.ID, result.OrganizationID)
	require.NotEmpty(t, result.AccessRevision)
	for _, mutate := range []func(*nekoRuntimeDescriptor){
		func(d *nekoRuntimeDescriptor) { d.OrganizationID = uuid.New() }, func(d *nekoRuntimeDescriptor) { d.WorkspaceID = uuid.New() }, func(d *nekoRuntimeDescriptor) { d.WorkspaceOwnerID = uuid.New() }, func(d *nekoRuntimeDescriptor) { d.BuildID = uuid.New() }, func(d *nekoRuntimeDescriptor) { d.AgentID = uuid.New() }, func(d *nekoRuntimeDescriptor) { d.NodeUID = uuid.Nil }, func(d *nekoRuntimeDescriptor) { d.VMUID = uuid.Nil }, func(d *nekoRuntimeDescriptor) { d.VMIUID = uuid.Nil }, func(d *nekoRuntimeDescriptor) { d.Peer = netip.MustParseAddrPort("10.244.1.5:22") }, func(d *nekoRuntimeDescriptor) { d.HTTPOrigin = "http://169.254.169.254" },
	} {
		bad := descriptor
		mutate(&bad)
		current.Store(bad)
		_, err := api.resolveNekoMedia(ctx, cfg, root.Client(), requested)
		require.Error(t, err)
	}
	current.Store(descriptor)
	unavailable.Store(true)
	_, err = api.resolveNekoMedia(ctx, cfg, root.Client(), requested)
	require.Error(t, err)
	unavailable.Store(false)
	stale := requested
	stale.AgentID = uuid.New()
	_, err = api.resolveNekoMedia(ctx, cfg, root.Client(), stale)
	require.Error(t, err)
	_, err = api.globalLockdown.Set(dbauthz.AsSystemRestricted(ctx), true, "test")
	require.NoError(t, err)
	_, err = api.resolveNekoMedia(ctx, cfg, root.Client(), requested)
	require.ErrorContains(t, err, "locked")
	_, err = api.globalLockdown.Set(dbauthz.AsSystemRestricted(ctx), false, "test")
	require.NoError(t, err)
	released, err := api.resolveNekoMedia(ctx, cfg, root.Client(), requested)
	require.NoError(t, err)
	require.NotEqual(t, result.AccessRevision, released.AccessRevision)
	_, err = db.UpsertWorkspaceQuarantine(dbauthz.AsSystemRestricted(ctx), database.UpsertWorkspaceQuarantineParams{WorkspaceID: fixture.Workspace.ID, OrganizationID: org.ID, Enabled: true, Revision: uuid.New(), Reason: "contain media", UpdatedBy: owner.ID, UpdatedAt: api.Clock.Now()})
	require.NoError(t, err)
	_, err = api.resolveNekoMedia(ctx, cfg, root.Client(), requested)
	require.ErrorContains(t, err, "quarantined")
}

func TestNekoOperatorConfigurationIsDisabledOrPinned(t *testing.T) {
	t.Parallel()
	disabled, err := NekoMediaConfigFromEnv(func(string) string { return "" })
	require.NoError(t, err)
	require.Nil(t, disabled)
	disabled, err = NekoMediaConfigFromEnv(func(string) string { return `{"enabled":false}` })
	require.NoError(t, err)
	require.Nil(t, disabled)
	_, err = NekoMediaConfigFromEnv(func(string) string { return `{"enabled":true,"unexpected":true}` })
	require.Error(t, err)
	dir := t.TempDir()
	index := []byte("<html>trusted</html>")
	sum := sha256.Sum256(index)
	manifest, err := json.Marshal(map[string]any{"version": 1, "protocol": "neko-v3.1.6-legacy", "relay_only": true, "files": map[string]string{"index.html": hex.EncodeToString(sum[:])}})
	require.NoError(t, err)
	manifestSum := sha256.Sum256(manifest)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "index.html"), index, 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "coder-neko-client.json"), manifest, 0o600))
	keyPath := filepath.Join(dir, "descriptor-key")
	require.NoError(t, os.WriteFile(keyPath, bytes.Repeat([]byte("ab"), 32), 0o600))
	raw, err := json.Marshal(map[string]any{"enabled": true, "advertise_ip": "192.168.1.5", "client_cidrs": []string{"192.168.0.0/16"}, "peer_cidrs": []string{"10.244.0.0/16"}, "port_min": 30000, "port_max": 30007, "max_leases": 4, "descriptor_origin": "http://coder-ui.coder.svc:80", "descriptor_key_file": keyPath, "client_directory": dir, "client_manifest_sha256": hex.EncodeToString(manifestSum[:])})
	require.NoError(t, err)
	config, err := NekoMediaConfigFromEnv(func(name string) string {
		if name == "CODER_NEKO_MEDIA_BIND_IP" {
			return "10.244.0.5"
		}
		return string(raw)
	})
	require.NoError(t, err)
	require.Equal(t, netip.MustParseAddr("10.244.0.5"), config.Relay.BindIP)
	require.Equal(t, netip.MustParseAddr("192.168.1.5"), config.Relay.AdvertiseIP)
	require.NotNil(t, config.Client)
}
