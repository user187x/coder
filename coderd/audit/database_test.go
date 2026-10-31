package audit_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/audit"
	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbtestutil"
	"github.com/coder/coder/v2/coderd/database/dbtime"
)

func TestDatabaseAuditor(t *testing.T) {
	t.Parallel()
	db, _ := dbtestutil.NewDB(t)
	event := database.AuditLog{ID: uuid.New(), Time: dbtime.Now(), ResourceType: database.ResourceTypeApiKey, Action: database.AuditActionLogin, StatusCode: http.StatusUnauthorized, Diff: json.RawMessage(`{}`), AdditionalFields: json.RawMessage(`{"submitted_identifier":"unknown"}`)}
	require.NoError(t, audit.NewDatabase(db).Export(context.Background(), event))
	logs, err := db.GetAuditLogsOffset(context.Background(), database.GetAuditLogsOffsetParams{LimitOpt: 10})
	require.NoError(t, err)
	require.Len(t, logs, 1)
	require.Equal(t, event.ID, logs[0].AuditLog.ID)
	require.JSONEq(t, string(event.AdditionalFields), string(logs[0].AuditLog.AdditionalFields))
}
