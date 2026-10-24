//go:build linux

// Package workspaceoverlay installs leased, authenticated workspace overlay links.
package workspaceoverlay

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"reflect"
	"time"

	"golang.zx2c4.com/wireguard/wgctrl/wgtypes"
)

// Peer is a single authorized workspace endpoint. AllowedIP must be a host route.
type Peer struct {
	WorkspaceID string `json:"workspace_id"`
	PublicKey   string `json:"public_key"`
	Endpoint    string `json:"endpoint"`
	AllowedIP   string `json:"allowed_ip"`
}

// Policy is the server's leased desired configuration.
type Policy struct {
	Revision     int64  `json:"revision"`
	Address      string `json:"address"`
	Peers        []Peer `json:"peers"`
	LeaseSeconds int    `json:"lease_seconds"`
}

// SyncRequest registers the ephemeral public key and acknowledges installed policy.
type SyncRequest struct {
	PublicKey        string      `json:"public_key"`
	Endpoint         string      `json:"endpoint"`
	AppliedRevision  int64       `json:"applied_revision"`
	Error            string      `json:"error,omitempty"`
	EstablishedPeers []string    `json:"established_peers"`
	PeerStats        []PeerStats `json:"peer_stats,omitempty"`
}

// Device applies a complete policy or removes all overlay connectivity.
type Device interface {
	Apply(context.Context, Policy) error
	Clear() error
	EstablishedPeers() []string
	PeerStats() []PeerStats
}

// Runtime reconciles server policy with the local network device.
type Runtime struct {
	Client    *http.Client
	URL       string
	Token     string
	PublicKey string
	Endpoint  string
	Device    Device
	applied   int64
	lastError string
	installed *Policy
}

// Validate rejects prefixes, duplicate identities and unsafe endpoints.
func (p Policy) Validate() error {
	if p.Revision < 0 || p.LeaseSeconds < 5 || p.LeaseSeconds > 60 {
		return fmt.Errorf("invalid policy revision or lease")
	}
	own, err := hostPrefix(p.Address)
	if err != nil {
		return err
	}
	seenIPs := map[netip.Addr]bool{own.Addr(): true}
	seenKeys := map[wgtypes.Key]bool{}
	for _, peer := range p.Peers {
		ip, err := hostPrefix(peer.AllowedIP)
		if err != nil {
			return err
		}
		key, err := wgtypes.ParseKey(peer.PublicKey)
		if err != nil || key == (wgtypes.Key{}) {
			return fmt.Errorf("invalid peer public key")
		}
		endpoint, err := netip.ParseAddrPort(peer.Endpoint)
		if err != nil || !endpoint.Addr().Is4() || !endpoint.Addr().IsGlobalUnicast() || endpoint.Port() == 0 {
			return fmt.Errorf("invalid peer endpoint")
		}
		if peer.WorkspaceID == "" || seenIPs[ip.Addr()] || seenKeys[key] {
			return fmt.Errorf("duplicate or incomplete peer")
		}
		seenIPs[ip.Addr()] = true
		seenKeys[key] = true
	}
	return nil
}

func hostPrefix(value string) (netip.Prefix, error) {
	p, err := netip.ParsePrefix(value)
	if err != nil || !p.Addr().Is4() || p.Bits() != 32 || !p.Addr().IsPrivate() {
		return netip.Prefix{}, fmt.Errorf("overlay address must be a private IPv4 host route")
	}
	return p, nil
}

// Sync performs one bounded reconciliation. Failed policy reads revoke peers.
func (r *Runtime) Sync(ctx context.Context) error {
	if r.installed == nil {
		r.applied = -1
	}
	request := SyncRequest{PublicKey: r.PublicKey, Endpoint: r.Endpoint, AppliedRevision: r.applied, Error: r.lastError, EstablishedPeers: r.Device.EstablishedPeers(), PeerStats: r.Device.PeerStats()}
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Coder-Session-Token", r.Token)
	req.Header.Set("Content-Type", "application/json")
	response, err := r.Client.Do(req)
	if err != nil {
		return r.revoke(fmt.Errorf("sync policy: %w", err))
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return r.revoke(fmt.Errorf("sync policy returned HTTP %d", response.StatusCode))
	}
	var policy Policy
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&policy); err != nil {
		return r.revoke(fmt.Errorf("decode policy: %w", err))
	}
	if err = policy.Validate(); err != nil {
		return r.revoke(err)
	}
	if r.installed != nil && policy.Address == r.installed.Address && reflect.DeepEqual(policy.Peers, r.installed.Peers) {
		r.applied = policy.Revision
		return nil
	}
	if err = r.Device.Apply(ctx, policy); err != nil {
		return r.revoke(fmt.Errorf("apply policy: %w", err))
	}
	r.installed = &policy
	r.applied = policy.Revision
	r.lastError = ""
	return nil
}

func (r *Runtime) revoke(cause error) error {
	r.applied = -1
	r.installed = nil
	r.lastError = cause.Error()
	if err := r.Device.Clear(); err != nil {
		return fmt.Errorf("%w; revoke overlay: %w", cause, err)
	}
	return cause
}

// Run keeps policy fresh and clears connectivity when canceled. Every exchange is
// bounded below the minimum lease, and any failed exchange revokes immediately.
func (r *Runtime) Run(ctx context.Context, report func(error)) error {
	defer r.Device.Clear()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	lastReported := ""
	for {
		syncCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
		err := r.Sync(syncCtx)
		cancel()
		if err != nil {
			if err.Error() != lastReported {
				report(err)
				lastReported = err.Error()
			}
		} else {
			lastReported = ""
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

func ipNet(prefix netip.Prefix) net.IPNet {
	return net.IPNet{IP: net.IP(prefix.Addr().AsSlice()), Mask: net.CIDRMask(prefix.Bits(), 32)}
}
