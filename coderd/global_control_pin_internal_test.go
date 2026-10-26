package coderd

import (
	"context"
	"database/sql"
	"sync"
	"testing"
	"time"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbmock"
	"github.com/coder/coder/v2/coderd/userpassword"
	"github.com/coder/quartz"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"
)

func TestGlobalControlGrantBoundToSessionAndExpiry(t *testing.T) {
	t.Parallel()
	now := time.Now()
	key := database.APIKey{ID: "session", UserID: uuid.New()}
	state := globalControlConfig{Grants: make(map[string]controlGrant)}
	grant, err := issueControlGrant(&state, key, now)
	require.NoError(t, err)
	require.NotContains(t, state.Grants[key.ID].Hash, grant.Token)
	require.True(t, controlUnlocked(&state, key, grant.Token, now))
	require.False(t, controlUnlocked(&state, database.APIKey{ID: "other", UserID: key.UserID}, grant.Token, now))
	require.False(t, controlUnlocked(&state, database.APIKey{ID: key.ID, UserID: uuid.New()}, grant.Token, now))
	require.False(t, controlUnlocked(&state, key, grant.Token, now.Add(globalControlLifetime)))
	require.False(t, controlUnlocked(&state, key, "wrong", now))
	delete(state.Grants, key.ID)
	require.False(t, controlUnlocked(&state, key, grant.Token, now))
}

func TestGlobalControlPINRateLimitPersistsAcrossReplicas(t *testing.T) {
	t.Parallel()
	db := dbmock.NewMockStore(gomock.NewController(t))
	var raw string
	var mu sync.Mutex
	db.EXPECT().InTx(gomock.Any(), gomock.Any()).DoAndReturn(func(fn func(database.Store) error, _ *database.TxOptions) error {
		mu.Lock()
		defer mu.Unlock()
		return fn(db)
	}).AnyTimes()
	db.EXPECT().AcquireLock(gomock.Any(), database.GenLockID(globalControlConfigKey)).Return(nil).AnyTimes()
	db.EXPECT().GetRuntimeConfig(gomock.Any(), globalControlConfigKey).DoAndReturn(func(context.Context, string) (string, error) {
		if raw == "" {
			return "", sql.ErrNoRows
		}
		return raw, nil
	}).AnyTimes()
	db.EXPECT().UpsertRuntimeConfig(gomock.Any(), gomock.Any()).DoAndReturn(func(_ context.Context, p database.UpsertRuntimeConfigParams) error { raw = p.Value; return nil }).AnyTimes()
	clock := quartz.NewMock(t)
	a := &API{Options: &Options{Database: db, Clock: clock}}
	b := &API{Options: &Options{Database: db, Clock: clock}}
	hash, err := userpassword.Hash("938271")
	require.NoError(t, err)
	require.NoError(t, a.changeGlobalControls(context.Background(), func(s *globalControlConfig) error { s.Hash = hash; return nil }))
	for i := 0; i < 5; i++ {
		require.Error(t, a.changeGlobalControls(context.Background(), func(s *globalControlConfig) error { return verifyControlPIN(s, "owner", "wrong", clock.Now()) }))
	}
	err = b.changeGlobalControls(context.Background(), func(s *globalControlConfig) error { return verifyControlPIN(s, "owner", "938271", clock.Now()) })
	var failure controlFailure
	require.ErrorAs(t, err, &failure)
	require.Equal(t, 429, failure.status)
	clock.Advance(5 * time.Minute).MustWait(context.Background())
	require.NoError(t, b.changeGlobalControls(context.Background(), func(s *globalControlConfig) error { return verifyControlPIN(s, "owner", "938271", clock.Now()) }))
	require.NotContains(t, raw, "938271")
}

func TestGlobalControlPINFormat(t *testing.T) {
	t.Parallel()
	for _, pin := range []string{"", "0000", "12345a", "1234567", "１２３４５６"} {
		require.False(t, validControlPIN(pin))
	}
	require.True(t, validControlPIN("938271"))
}
