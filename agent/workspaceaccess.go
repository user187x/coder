package agent

import (
	"context"
	"time"

	"github.com/google/uuid"
	"golang.org/x/xerrors"

	"cdr.dev/slog/v3"
	"github.com/coder/coder/v2/codersdk/agentsdk"
	"github.com/coder/quartz"
)

type workspaceAccessClient interface {
	SyncWorkspaceAccess(context.Context, agentsdk.SyncWorkspaceAccessRequest) (agentsdk.WorkspaceAccessPolicy, error)
}

func workspaceAccessLoop(ctx context.Context, clock quartz.Clock, client workspaceAccessClient, apply func(context.Context, bool, []uuid.UUID) error, logger slog.Logger) error {
	applied := ""
	lastError := ""
	syncPolicy := func() error {
		requestCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		policy, err := client.SyncWorkspaceAccess(requestCtx, agentsdk.SyncWorkspaceAccessRequest{AppliedPolicy: applied})
		if err != nil {
			return xerrors.Errorf("read workspace access policy: %w", err)
		}
		if policy.Fingerprint == "" {
			return xerrors.New("workspace access policy has no fingerprint")
		}
		if policy.Fingerprint == applied {
			return nil
		}
		if err := apply(requestCtx, policy.Enabled, policy.AllowedPeers); err != nil {
			return xerrors.Errorf("apply workspace access policy: %w", err)
		}
		applied = policy.Fingerprint
		_, err = client.SyncWorkspaceAccess(requestCtx, agentsdk.SyncWorkspaceAccessRequest{AppliedPolicy: applied})
		return err
	}
	ticker := clock.NewTicker(time.Second, "workspace-access-policy")
	defer ticker.Stop()
	for {
		if err := syncPolicy(); err != nil {
			if ctx.Err() != nil {
				return nil
			}
			if lastError != err.Error() {
				logger.Warn(ctx, "workspace access policy synchronization", slog.Error(err))
			}
			lastError = err.Error()
		} else {
			lastError = ""
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}
