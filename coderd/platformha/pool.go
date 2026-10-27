package platformha

import (
	"database/sql"

	"golang.org/x/xerrors"
)

// OpenPool reserves database connections for lease maintenance so application
// queries cannot exhaust the connections needed to retain leadership. The caller
// must close the pool after the registry stops.
func OpenPool(driver, dataSource string) (*sql.DB, error) {
	db, err := sql.Open(driver, dataSource)
	if err != nil {
		return nil, xerrors.Errorf("open HA database pool: %w", err)
	}
	// Handover updates must not occupy the renewal loop's connection.
	db.SetMaxOpenConns(2)
	db.SetMaxIdleConns(2)
	return db, nil
}
