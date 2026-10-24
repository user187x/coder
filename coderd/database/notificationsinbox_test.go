package database_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbgen"
	"github.com/coder/coder/v2/coderd/database/dbtestutil"
	"github.com/coder/coder/v2/coderd/database/dbtime"
	"github.com/coder/coder/v2/coderd/notifications"
	"github.com/coder/coder/v2/testutil"
)

func TestInsertInboxNotificationAndNotify(t *testing.T) {
	t.Parallel()
	db, ps := dbtestutil.NewDB(t)
	ctx := testutil.Context(t, testutil.WaitLong)
	user := dbgen.User(t, db, database.User{Status: database.UserStatusActive})
	channel := "drive-audit-test:" + uuid.NewString()
	received := make(chan []byte, 1)
	stop, err := ps.Subscribe(channel, func(_ context.Context, message []byte) {
		select {
		case received <- message:
		case <-ctx.Done():
		}
	})
	require.NoError(t, err)
	t.Cleanup(stop)
	arg := database.InsertInboxNotificationAndNotifyParams{
		ID: uuid.New(), UserID: user.ID, TemplateID: notifications.TemplateCustomNotification,
		Title: "Cloud Drive file added", Content: "Mount account alice added file example.txt (12 bytes).",
		Actions: []byte("[]"), CreatedAt: dbtime.Now(), Channel: channel, Event: "drive-event",
	}
	require.NoError(t, db.InsertInboxNotificationAndNotify(ctx, arg))
	select {
	case message := <-received:
		require.Equal(t, arg.Event, string(message))
	case <-ctx.Done():
		t.Fatal("notification was not published")
	}
	require.NoError(t, db.InsertInboxNotificationAndNotify(ctx, arg))
	count, err := db.CountUnreadInboxNotificationsByUserID(ctx, user.ID)
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
	arg.ID = uuid.New()
	arg.TemplateID = notifications.TemplateWorkspaceCreated
	require.NoError(t, db.InsertInboxNotificationAndNotify(ctx, arg))
	count, err = db.CountUnreadInboxNotificationsByUserID(ctx, user.ID)
	require.NoError(t, err)
	require.EqualValues(t, 1, count)
	_, err = db.UpdateUserNotificationPreferences(ctx, database.UpdateUserNotificationPreferencesParams{
		UserID: user.ID, NotificationTemplateIds: []uuid.UUID{arg.TemplateID}, Disableds: []bool{false},
	})
	require.NoError(t, err)
	require.NoError(t, db.InsertInboxNotificationAndNotify(ctx, arg))
	count, err = db.CountUnreadInboxNotificationsByUserID(ctx, user.ID)
	require.NoError(t, err)
	require.EqualValues(t, 2, count)
	_, err = db.UpdateUserNotificationPreferences(ctx, database.UpdateUserNotificationPreferencesParams{
		UserID: user.ID, NotificationTemplateIds: []uuid.UUID{notifications.TemplateCustomNotification}, Disableds: []bool{true},
	})
	require.NoError(t, err)
	arg.ID = uuid.New()
	arg.TemplateID = notifications.TemplateCustomNotification
	require.NoError(t, db.InsertInboxNotificationAndNotify(ctx, arg))
	count, err = db.CountUnreadInboxNotificationsByUserID(ctx, user.ID)
	require.NoError(t, err)
	require.EqualValues(t, 2, count)
}
