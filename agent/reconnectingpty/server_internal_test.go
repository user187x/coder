package reconnectingpty

import (
	"io"
	"net"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/testutil"
)

func TestBlockConnections(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	server := NewServer(testutil.Logger(t), nil, nil, nil, nil, 0, func(s *Server) {
		s.BlockConnections = true
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = server.Serve(ctx, ctx, listener)
	}()
	t.Cleanup(func() { _ = listener.Close(); <-done })
	conn, err := net.Dial("tcp", listener.Addr().String())
	require.NoError(t, err)
	defer conn.Close()
	deadline, ok := ctx.Deadline()
	require.True(t, ok)
	require.NoError(t, conn.SetReadDeadline(deadline))
	_, err = conn.Read(make([]byte, 1))
	require.ErrorIs(t, err, io.EOF)
	require.Zero(t, server.ConnCount())
}
