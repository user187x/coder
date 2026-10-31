package agent

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/xerrors"

	"github.com/coder/coder/v2/codersdk"
)

func TestClassifyCoordinatorRPCExit(t *testing.T) {
	t.Parallel()

	canceled, cancel := context.WithCancel(context.Background())
	cancel()

	cases := []struct {
		name      string
		ctx       context.Context
		retErr    error
		reason    codersdk.DisconnectReason
		initiator codersdk.DisconnectInitiator
	}{
		{
			name:      "local shutdown, no error",
			ctx:       canceled,
			retErr:    nil,
			reason:    codersdk.DisconnectReasonServerShutdown,
			initiator: codersdk.DisconnectInitiatorAgent,
		},
		{
			name:      "local shutdown, with cleanup error",
			ctx:       canceled,
			retErr:    xerrors.New("close timed out"),
			reason:    codersdk.DisconnectReasonServerShutdown,
			initiator: codersdk.DisconnectInitiatorAgent,
		},
		{
			name:      "remote graceful, no error",
			ctx:       context.Background(),
			retErr:    nil,
			reason:    codersdk.DisconnectReasonGraceful,
			initiator: codersdk.DisconnectInitiatorServer,
		},
		{
			name:      "stream broke unexpectedly",
			ctx:       context.Background(),
			retErr:    xerrors.New("read: connection reset"),
			reason:    codersdk.DisconnectReasonNetworkError,
			initiator: codersdk.DisconnectInitiatorNetwork,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			reason, initiator := classifyCoordinatorRPCExit(tc.ctx, tc.retErr)
			require.Equal(t, tc.reason, reason)
			require.Equal(t, tc.initiator, initiator)
		})
	}
}
