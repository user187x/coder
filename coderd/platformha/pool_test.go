package platformha_test

import (
	"database/sql"
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

	ha, err := platformha.OpenPool("postgres", dsn)
	require.NoError(t, err)
	defer ha.Close()
	require.Equal(t, 2, ha.Stats().MaxOpenConnections)
	// The application's only connection remains occupied throughout HA startup.
	registry := platformha.NewRegistry(ha, testConfig("dedicated"), testutil.Logger(t), nil)
	require.NoError(t, registry.Start(ctx))
	require.NoError(t, registry.Close(ctx))
	require.Equal(t, 1, app.Stats().InUse)
}
