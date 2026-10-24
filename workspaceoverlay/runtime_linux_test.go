//go:build linux

package workspaceoverlay_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/coder/coder/v2/workspaceoverlay"
	"github.com/stretchr/testify/require"
	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

type fakeDevice struct {
	applied []workspaceoverlay.Policy
	clears  int
	err     error
}

func (d *fakeDevice) Apply(_ context.Context, p workspaceoverlay.Policy) error {
	d.applied = append(d.applied, p)
	return d.err
}
func (d *fakeDevice) Clear() error { d.clears++; return nil }

func policy(t *testing.T) workspaceoverlay.Policy {
	t.Helper()
	key, err := wgtypes.GeneratePrivateKey()
	require.NoError(t, err)
	return workspaceoverlay.Policy{Revision: 1, Address: "10.253.0.1/32", LeaseSeconds: 15, Peers: []workspaceoverlay.Peer{{WorkspaceID: "other", PublicKey: key.PublicKey().String(), Endpoint: "10.244.0.2:51871", AllowedIP: "10.253.0.2/32"}}}
}

func TestPolicyRejectsBroaderRoutesAndDuplicatePeers(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		change func(*workspaceoverlay.Policy)
	}{
		{"subnet", func(p *workspaceoverlay.Policy) { p.Peers[0].AllowedIP = "10.253.0.0/16" }},
		{"public address", func(p *workspaceoverlay.Policy) { p.Address = "8.8.8.8/32" }},
		{"self route", func(p *workspaceoverlay.Policy) { p.Peers[0].AllowedIP = p.Address }},
		{"duplicate", func(p *workspaceoverlay.Policy) { p.Peers = append(p.Peers, p.Peers[0]) }},
		{"hostname endpoint", func(p *workspaceoverlay.Policy) { p.Peers[0].Endpoint = "example.com:51871" }},
		{"loopback endpoint", func(p *workspaceoverlay.Policy) { p.Peers[0].Endpoint = "127.0.0.1:51871" }},
		{"missing revision", func(p *workspaceoverlay.Policy) { p.Revision = -1 }},
		{"unbounded lease", func(p *workspaceoverlay.Policy) { p.LeaseSeconds = 3600 }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) { t.Parallel(); p := policy(t); tc.change(&p); require.Error(t, p.Validate()) })
	}
	require.NoError(t, policy(t).Validate())
}

func TestSyncAcknowledgesOnlyInstalledPolicyAndRevokesOnFailure(t *testing.T) {
	t.Parallel()
	desired := policy(t)
	var requests []workspaceoverlay.SyncRequest
	status := http.StatusOK
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "agent-token", r.Header.Get("Coder-Session-Token"))
		var request workspaceoverlay.SyncRequest
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		requests = append(requests, request)
		w.WriteHeader(status)
		if status == http.StatusOK {
			require.NoError(t, json.NewEncoder(w).Encode(desired))
		}
	}))
	defer server.Close()
	device := &fakeDevice{}
	runtime := workspaceoverlay.Runtime{Client: server.Client(), URL: server.URL, Token: "agent-token", Device: device}
	require.NoError(t, runtime.Sync(t.Context()))
	require.EqualValues(t, -1, requests[0].AppliedRevision)
	require.Len(t, device.applied, 1)
	require.NoError(t, runtime.Sync(t.Context()))
	require.EqualValues(t, 1, requests[1].AppliedRevision)
	require.Len(t, device.applied, 1)
	desired.Revision = 2
	desired.Address = "10.253.0.3/32"
	device.err = fmt.Errorf("engine unavailable")
	require.ErrorContains(t, runtime.Sync(t.Context()), "engine unavailable")
	require.Equal(t, 1, device.clears)
	device.err = nil
	require.NoError(t, runtime.Sync(t.Context()))
	require.EqualValues(t, -1, requests[3].AppliedRevision)
	require.Contains(t, requests[3].Error, "engine unavailable")
	status = http.StatusUnauthorized
	require.ErrorContains(t, runtime.Sync(t.Context()), "401")
	require.Equal(t, 2, device.clears)
}

func TestSyncRevokesWhenServerCannotBeReached(t *testing.T) {
	t.Parallel()
	device := &fakeDevice{}
	runtime := workspaceoverlay.Runtime{Client: &http.Client{}, URL: "https://127.0.0.1:1", Device: device}
	require.Error(t, runtime.Sync(t.Context()))
	require.Equal(t, 1, device.clears)
}

func (d *fakeDevice) EstablishedPeers() []string { return []string{"other"} }

func TestRevisionOnlyChangePreservesInstalledConnections(t *testing.T) {
	t.Parallel()
	desired := policy(t)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		require.NoError(t, json.NewEncoder(w).Encode(desired))
	}))
	defer server.Close()
	device := &fakeDevice{}
	runtime := workspaceoverlay.Runtime{Client: server.Client(), URL: server.URL, Device: device}
	require.NoError(t, runtime.Sync(t.Context()))
	desired.Revision++
	require.NoError(t, runtime.Sync(t.Context()))
	require.Len(t, device.applied, 1)
	require.Zero(t, device.clears)
}

func (d *fakeDevice) PeerStats() []workspaceoverlay.PeerStats { return nil }
