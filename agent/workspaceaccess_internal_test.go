package agent

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/codersdk/agentsdk"
	"github.com/coder/coder/v2/testutil"
	"github.com/coder/quartz"
)

type policySyncClient struct {
	sync func(context.Context, agentsdk.SyncWorkspaceAccessRequest) (agentsdk.WorkspaceAccessPolicy, error)
}

func (c policySyncClient) SyncWorkspaceAccess(ctx context.Context, req agentsdk.SyncWorkspaceAccessRequest) (agentsdk.WorkspaceAccessPolicy, error) {
	return c.sync(ctx, req)
}

func TestWorkspaceAccessAcknowledgesOnlyAfterEnforcement(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(testutil.Context(t, testutil.WaitShort))
	defer cancel()
	clock := quartz.NewMock(t)
	requests := make(chan agentsdk.SyncWorkspaceAccessRequest, 8)
	applying := make(chan struct{})
	installed := make(chan struct{})
	owner := uuid.New()
	client := policySyncClient{sync: func(_ context.Context, req agentsdk.SyncWorkspaceAccessRequest) (agentsdk.WorkspaceAccessPolicy, error) {
		requests <- req
		return agentsdk.WorkspaceAccessPolicy{Enabled: true, Fingerprint: "installed-policy", AllowedPeers: []uuid.UUID{owner}}, nil
	}}
	finished := make(chan error, 1)
	go func() {
		finished <- workspaceAccessLoop(ctx, clock, client, func(ctx context.Context, enabled bool, allowed []uuid.UUID) error {
			require.True(t, enabled)
			require.Equal(t, []uuid.UUID{owner}, allowed)
			close(applying)
			select {
			case <-installed:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		}, testutil.Logger(t))
	}()
	require.Empty(t, testutil.TryReceive(ctx, t, requests).AppliedPolicy)
	_ = testutil.TryReceive(ctx, t, applying)
	select {
	case req := <-requests:
		t.Fatalf("acknowledged before enforcement completed: %v", req)
	default:
	}
	close(installed)
	require.Equal(t, "installed-policy", testutil.TryReceive(ctx, t, requests).AppliedPolicy)
	cancel()
	require.NoError(t, testutil.TryReceive(context.Background(), t, finished))
}

func TestWorkspaceAccessFailedEnforcementNeverAcknowledges(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(testutil.Context(t, testutil.WaitShort))
	defer cancel()
	clock := quartz.NewMock(t)
	requests := make(chan agentsdk.SyncWorkspaceAccessRequest, 8)
	failed := make(chan struct{}, 8)
	client := policySyncClient{sync: func(_ context.Context, req agentsdk.SyncWorkspaceAccessRequest) (agentsdk.WorkspaceAccessPolicy, error) {
		requests <- req
		return agentsdk.WorkspaceAccessPolicy{Enabled: true, Fingerprint: "not-installed"}, nil
	}}
	finished := make(chan error, 1)
	go func() {
		finished <- workspaceAccessLoop(ctx, clock, client, func(context.Context, bool, []uuid.UUID) error {
			failed <- struct{}{}
			return errors.New("device rejected reconfiguration")
		}, testutil.Logger(t))
	}()
	require.Empty(t, testutil.TryReceive(ctx, t, requests).AppliedPolicy)
	_ = testutil.TryReceive(ctx, t, failed)
	clock.Advance(time.Second).MustWait(ctx)
	require.Empty(t, testutil.TryReceive(ctx, t, requests).AppliedPolicy)
	_ = testutil.TryReceive(ctx, t, failed)
	cancel()
	require.NoError(t, testutil.TryReceive(context.Background(), t, finished))
}
