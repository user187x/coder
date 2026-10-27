package platformha_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/database/dbtestutil"
	"github.com/coder/coder/v2/coderd/platformha"
	"github.com/coder/coder/v2/testutil"
)

func TestPoolIndependentOfApplicationConnections(t *testing.T) {
	t.Parallel()
	ctx := testutil.Context(t, testutil.WaitLong)
	dsn, err := dbtestutil.Open(t)
	require.NoError(t, err)
	app, err := sql.Open("postgres", dsn)
	require.NoError(t, err)
	defer app.Close()
	app.SetMaxOpenConns(1)
	occupied, err := app.Conn(ctx)
	require.NoError(t, err)
	defer occupied.Close()
	require.Equal(t, 1, app.Stats().InUse)

	ha, err := platformha.OpenPool(app, dsn)
	require.NoError(t, err)
	defer ha.Close()
	require.Equal(t, 2, ha.Stats().MaxOpenConnections)
	// The application's only connection remains occupied throughout HA startup.
	registry := platformha.NewRegistry(ha, testConfig("dedicated"), testutil.Logger(t), nil)
	require.NoError(t, registry.Start(ctx))
	require.NoError(t, registry.Close(ctx))
	require.Equal(t, 1, app.Stats().InUse)
}

// cancelConnector verifies that custom authentication connectors receive the
// operation context, rather than an unbounded background context.
type cancelConnector struct{ started chan struct{} }

func (c *cancelConnector) Connect(ctx context.Context) (driver.Conn, error) {
	close(c.started)
	<-ctx.Done()
	return nil, ctx.Err()
}
func (c *cancelConnector) Driver() driver.Driver { return &cancelDriver{connector: c} }

type cancelDriver struct{ connector *cancelConnector }

func (d *cancelDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("connector required")
}
func (d *cancelDriver) Connector(string) (driver.Connector, error) { return d.connector, nil }

func TestPoolConnectionCancellation(t *testing.T) {
	t.Parallel()
	testCtx := testutil.Context(t, testutil.WaitShort)
	connector := &cancelConnector{started: make(chan struct{})}
	application := sql.OpenDB(connector)
	defer application.Close()
	pool, err := platformha.OpenPool(application, "")
	require.NoError(t, err)
	defer pool.Close()
	ctx, cancel := context.WithCancel(testCtx)
	defer cancel()
	result := make(chan error, 1)
	go func() { _, err := pool.Conn(ctx); result <- err }()
	select {
	case <-connector.started:
	case <-testCtx.Done():
		t.Fatal("connection did not start")
	}
	cancel()
	select {
	case err := <-result:
		require.ErrorIs(t, err, context.Canceled)
	case <-testCtx.Done():
		t.Fatal("connection ignored cancellation")
	}
}
