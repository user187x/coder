package agentapi

import (
	"context"

	"golang.org/x/xerrors"
	"storj.io/drpc/drpcerr"

	agentproto "github.com/coder/coder/v2/agent/proto"
)

// ContextAPI answers the v2.10 PushContextState RPC. The workspace context an agent pushed (instructions, skills,
// MCP tool lists) fed Coder Agents' chats, which this build leaves out: every push is answered with the Unimplemented
// code, which tells the agent to stop pushing instead of retrying with backoff.
type ContextAPI struct{}

func (*ContextAPI) PushContextState(context.Context, *agentproto.PushContextStateRequest) (*agentproto.PushContextStateResponse, error) {
	return nil, drpcerr.WithCode(
		xerrors.New("agentapi: workspace context is not part of this build"),
		drpcerr.Unimplemented,
	)
}
