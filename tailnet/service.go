package tailnet

import (
	"context"
	"io"
	"net"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/hashicorp/yamux"
	"golang.org/x/xerrors"
	"storj.io/drpc/drpcerr"
	"storj.io/drpc/drpcmux"
	"storj.io/drpc/drpcserver"
	"tailscale.com/tailcfg"

	"cdr.dev/slog/v3"
	"github.com/coder/coder/v2/apiversion"
	"github.com/coder/coder/v2/codersdk/drpcsdk"
	"github.com/coder/coder/v2/tailnet/proto"
)

var ErrUnsupportedVersion = xerrors.New("unsupported version")

type streamIDContextKey struct{}

// StreamID identifies the caller of the CoordinateTailnet RPC.  We store this
// on the context, since the information is extracted at the HTTP layer for
// remote clients of the API, or set outside tailnet for local clients (e.g.
// Coderd's single_tailnet)
type StreamID struct {
	Name string
	ID   uuid.UUID
	Auth CoordinateeAuth
}

func WithStreamID(ctx context.Context, streamID StreamID) context.Context {
	return context.WithValue(ctx, streamIDContextKey{}, streamID)
}

type WorkspaceUpdatesProvider interface {
	io.Closer
	Subscribe(ctx context.Context, userID uuid.UUID) (Subscription, error)
}

type Subscription interface {
	io.Closer
	Updates() <-chan *proto.WorkspaceUpdate
}

type TunnelAuthorizer interface {
	AuthorizeTunnel(ctx context.Context, agentID uuid.UUID) error
}

type ClientServiceOptions struct {
	Logger                   slog.Logger
	CoordPtr                 *atomic.Pointer[Coordinator]
	DERPMapUpdateFrequency   time.Duration
	DERPMapFn                func() *tailcfg.DERPMap
	ResumeTokenProvider      ResumeTokenProvider
	WorkspaceUpdatesProvider WorkspaceUpdatesProvider
}

// ClientService is a tailnet coordination service that accepts a connection and version from a
// tailnet client, and support versions 2.x of the Tailnet API protocol.
type ClientService struct {
	Logger   slog.Logger
	CoordPtr *atomic.Pointer[Coordinator]
	drpc     *drpcserver.Server
}

// NewClientService returns a ClientService based on the given Coordinator pointer.  The pointer is
// loaded on each processed connection.
func NewClientService(options ClientServiceOptions) (
	*ClientService, error,
) {
	s := &ClientService{Logger: options.Logger, CoordPtr: options.CoordPtr}
	mux := drpcmux.New()
	drpcService := &DRPCService{
		CoordPtr:                 options.CoordPtr,
		Logger:                   options.Logger,
		DerpMapUpdateFrequency:   options.DERPMapUpdateFrequency,
		DerpMapFn:                options.DERPMapFn,
		ResumeTokenProvider:      options.ResumeTokenProvider,
		WorkspaceUpdatesProvider: options.WorkspaceUpdatesProvider,
	}
	err := proto.DRPCRegisterTailnet(mux, drpcService)
	if err != nil {
		return nil, xerrors.Errorf("register DRPC service: %w", err)
	}
	server := drpcsdk.NewServer(options.Logger, mux, drpcserver.Options{
		Manager: drpcsdk.DefaultDRPCOptions(nil),
		Log: func(err error) {
			if xerrors.Is(err, io.EOF) ||
				xerrors.Is(err, context.Canceled) ||
				xerrors.Is(err, context.DeadlineExceeded) {
				return
			}
			options.Logger.Debug(context.Background(), "drpc server error", slog.Error(err))
		},
	})
	s.drpc = server
	return s, nil
}

func (s *ClientService) ServeClient(ctx context.Context, version string, conn net.Conn, streamID StreamID) error {
	major, _, err := apiversion.Parse(version)
	if err != nil {
		s.Logger.Warn(ctx, "serve client called with unparsable version", slog.Error(err))
		return err
	}
	switch major {
	case 2:
		return s.ServeConnV2(ctx, conn, streamID)
	default:
		s.Logger.Warn(ctx, "serve client called with unsupported version", slog.F("version", version))
		return ErrUnsupportedVersion
	}
}

func (s ClientService) ServeConnV2(ctx context.Context, conn net.Conn, streamID StreamID) error {
	config := yamux.DefaultConfig()
	config.LogOutput = io.Discard
	session, err := yamux.Server(conn, config)
	if err != nil {
		return xerrors.Errorf("yamux init failed: %w", err)
	}
	ctx = WithStreamID(ctx, streamID)
	s.Logger.Debug(ctx, "serving dRPC tailnet v2 API session",
		slog.F("peer_id", streamID.ID.String()))
	return s.drpc.Serve(ctx, session)
}

// DRPCService is the dRPC-based, version 2.x of the tailnet API and implements proto.DRPCClientServer
type DRPCService struct {
	CoordPtr                 *atomic.Pointer[Coordinator]
	Logger                   slog.Logger
	DerpMapUpdateFrequency   time.Duration
	DerpMapFn                func() *tailcfg.DERPMap
	ResumeTokenProvider      ResumeTokenProvider
	WorkspaceUpdatesProvider WorkspaceUpdatesProvider
}

// PostTelemetry accepts network telemetry from clients that still send it and
// discards it. Nothing is collected or forwarded.
func (*DRPCService) PostTelemetry(context.Context, *proto.TelemetryRequest) (*proto.TelemetryResponse, error) {
	return &proto.TelemetryResponse{}, nil
}

func (s *DRPCService) StreamDERPMaps(_ *proto.StreamDERPMapsRequest, stream proto.DRPCTailnet_StreamDERPMapsStream) error {
	defer stream.Close()

	ticker := time.NewTicker(s.DerpMapUpdateFrequency)
	defer ticker.Stop()

	var lastDERPMap *tailcfg.DERPMap
	for {
		derpMap := s.DerpMapFn()
		if derpMap == nil {
			// in testing, we send nil to close the stream.
			return io.EOF
		}
		if lastDERPMap == nil || !CompareDERPMaps(lastDERPMap, derpMap) {
			protoDERPMap := DERPMapToProto(derpMap)
			err := stream.Send(protoDERPMap)
			if err != nil {
				return xerrors.Errorf("send derp map: %w", err)
			}
			lastDERPMap = derpMap
		}

		ticker.Reset(s.DerpMapUpdateFrequency)
		select {
		case <-stream.Context().Done():
			return nil
		case <-ticker.C:
		}
	}
}

func (s *DRPCService) RefreshResumeToken(ctx context.Context, _ *proto.RefreshResumeTokenRequest) (*proto.RefreshResumeTokenResponse, error) {
	if s.ResumeTokenProvider == nil {
		return nil, drpcerr.WithCode(
			xerrors.New("resume tokens not supported on this connection"),
			drpcerr.Unimplemented,
		)
	}

	streamID, ok := ctx.Value(streamIDContextKey{}).(StreamID)
	if !ok {
		return nil, xerrors.New("no Stream ID")
	}

	res, err := s.ResumeTokenProvider.GenerateResumeToken(ctx, streamID.ID)
	if err != nil {
		return nil, xerrors.Errorf("generate resume token: %w", err)
	}
	return res, nil
}

func (s *DRPCService) Coordinate(stream proto.DRPCTailnet_CoordinateStream) error {
	ctx := stream.Context()
	streamID, ok := ctx.Value(streamIDContextKey{}).(StreamID)
	if !ok {
		_ = stream.Close()
		return xerrors.New("no Stream ID")
	}
	logger := s.Logger.With(slog.F("peer_id", streamID.ID.String()), slog.F("name", streamID.Name))
	logger.Debug(ctx, "starting tailnet Coordinate")
	coord := *(s.CoordPtr.Load())
	reqs, resps := coord.Coordinate(ctx, streamID.ID, streamID.Name, streamID.Auth)
	c := communicator{
		logger: logger,
		stream: stream,
		reqs:   reqs,
		resps:  resps,
	}
	c.communicate()
	return nil
}

func (s *DRPCService) WorkspaceUpdates(req *proto.WorkspaceUpdatesRequest, stream proto.DRPCTailnet_WorkspaceUpdatesStream) error {
	if s.WorkspaceUpdatesProvider == nil {
		return drpcerr.WithCode(
			xerrors.New("workspace updates not supported on this connection"),
			drpcerr.Unimplemented,
		)
	}

	defer stream.Close()

	ctx := stream.Context()

	ownerID, err := uuid.FromBytes(req.WorkspaceOwnerId)
	if err != nil {
		return xerrors.Errorf("parse workspace owner ID: %w", err)
	}

	sub, err := s.WorkspaceUpdatesProvider.Subscribe(ctx, ownerID)
	if err != nil {
		return xerrors.Errorf("subscribe to workspace updates: %w", err)
	}
	defer sub.Close()

	for {
		select {
		case updates, ok := <-sub.Updates():
			if !ok {
				return nil
			}
			err := stream.Send(updates)
			if err != nil {
				return xerrors.Errorf("send workspace update: %w", err)
			}
		case <-stream.Context().Done():
			return nil
		}
	}
}

type communicator struct {
	logger slog.Logger
	stream proto.DRPCTailnet_CoordinateStream
	reqs   chan<- *proto.CoordinateRequest
	resps  <-chan *proto.CoordinateResponse
}

func (c communicator) communicate() {
	go c.loopReq()
	c.loopResp()
}

func (c communicator) loopReq() {
	ctx := c.stream.Context()
	defer close(c.reqs)
	for {
		req, err := c.stream.Recv()
		if err != nil {
			c.logger.Debug(ctx, "error receiving requests from DRPC stream", slog.Error(err))
			return
		}
		err = SendCtx(ctx, c.reqs, req)
		if err != nil {
			c.logger.Debug(ctx, "context done while sending coordinate request", slog.Error(ctx.Err()))
			return
		}
	}
}

func (c communicator) loopResp() {
	ctx := c.stream.Context()
	defer func() {
		err := c.stream.Close()
		if err != nil {
			c.logger.Debug(ctx, "loopResp hit error closing stream", slog.Error(err))
		}
	}()
	for {
		resp, err := RecvCtx(ctx, c.resps)
		if err != nil {
			c.logger.Debug(ctx, "loopResp failed to get response", slog.Error(err))
			return
		}
		err = c.stream.Send(resp)
		if err != nil {
			c.logger.Debug(ctx, "loopResp failed to send response to DRPC stream", slog.Error(err))
			return
		}
	}
}
