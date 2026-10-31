package reconnectingpty

import (
	"encoding/json"
	"io"
	"net"
	"runtime"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/agent/agentexec"
	"github.com/coder/coder/v2/codersdk/workspacesdk"
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

func TestTerminateRequest(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()
	stopped := make(chan struct{})
	go readConnLoop(ctx, server, nil, nil, testutil.Logger(t), func(error) { close(stopped) })
	require.NoError(t, json.NewEncoder(client).Encode(workspacesdk.ReconnectingPTYRequest{Terminate: true}))
	select {
	case <-stopped:
	case <-ctx.Done():
		t.Fatal("terminal was not terminated")
	}
}

func TestTerminateClosesBufferedProcess(t *testing.T) {
	t.Parallel()
	if runtime.GOOS == "windows" {
		t.Skip("POSIX shell fixture")
	}
	ctx := testutil.Context(t, testutil.WaitLong)
	execer, err := agentexec.NewExecer()
	require.NoError(t, err)
	logger := testutil.Logger(t)
	command := execer.PTYCommandContext(ctx, "sh", "-c", "printf ready; read line")
	terminal := newBuffered(ctx, logger, execer, command, &Options{Timeout: time.Minute, Metrics: prometheus.NewCounterVec(prometheus.CounterOpts{Name: "terminate_test"}, []string{"error"})})
	t.Cleanup(func() { terminal.Close(nil) })
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()
	done := make(chan error, 1)
	go func() { done <- terminal.Attach(ctx, "test", server, 24, 80, logger) }()
	deadline, ok := ctx.Deadline()
	require.True(t, ok)
	require.NoError(t, client.SetDeadline(deadline))
	ready := make([]byte, 5)
	_, err = io.ReadFull(client, ready)
	require.NoError(t, err)
	require.Equal(t, "ready", string(ready))
	require.NoError(t, json.NewEncoder(client).Encode(workspacesdk.ReconnectingPTYRequest{Terminate: true}))
	state, err := terminal.state.waitForStateOrContext(ctx, StateDone)
	require.EqualValues(t, StateDone, state)
	require.NoError(t, err)
	require.NoError(t, <-done)
}
