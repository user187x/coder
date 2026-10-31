package audit

import (
	"context"

	"golang.org/x/xerrors"

	"github.com/coder/coder/v2/coderd/database"
	"github.com/coder/coder/v2/coderd/database/dbauthz"
)

// NewDatabase records event metadata in Coder's existing audit log. It does
// not compute field diffs, which may contain credentials or other secrets.
func NewDatabase(db database.Store) Auditor {
	return &databaseAuditor{db: db}
}

type databaseAuditor struct {
	nop
	db database.Store
}

func (a *databaseAuditor) Export(ctx context.Context, event database.AuditLog) error {
	// Authentication events are written before an authenticated actor exists.
	_, err := a.db.InsertAuditLog(dbauthz.AsSystemRestricted(ctx), database.InsertAuditLogParams(event)) //nolint:gocritic // See above.
	if err != nil {
		return xerrors.Errorf("record security event: %w", err)
	}
	return nil
}
