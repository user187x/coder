package database_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbgen"
	"github.com/coder/coder/v2/coderd/database/dbtestutil"
	"github.com/coder/coder/v2/coderd/database/dbtime"
	"github.com/stretchr/testify/require"
)

func TestRecordUserPasswordAttemptConcurrent(t *testing.T) {
	t.Parallel()
	db, _ := dbtestutil.NewDB(t)
	u := dbgen.User(t, db, database.User{})
	now := dbtime.Now()
	ctx := context.Background()
	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() {
			_, err := db.RecordUserPasswordAttempt(ctx, database.RecordUserPasswordAttemptParams{ID: u.ID, Now: now})
			require.NoError(t, err)
		})
	}
	wg.Wait()
	user, err := db.GetUserByID(ctx, u.ID)
	require.NoError(t, err)
	require.EqualValues(t, 5, user.FailedPasswordAttempts)
	require.True(t, user.PasswordLockedUntil.Valid)
	require.WithinDuration(t, now.Add(10*time.Minute), user.PasswordLockedUntil.Time, 0)
	// A wrong password at expiry starts a fresh failure count.
	locked, err := db.RecordUserPasswordAttempt(ctx, database.RecordUserPasswordAttemptParams{ID: u.ID, Now: now.Add(10 * time.Minute)})
	require.NoError(t, err)
	require.False(t, locked.Valid)
	user, err = db.GetUserByID(ctx, u.ID)
	require.NoError(t, err)
	require.EqualValues(t, 1, user.FailedPasswordAttempts)
}
