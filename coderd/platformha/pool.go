package platformha

import (
	"database/sql"
	"database/sql/driver"

	"github.com/lib/pq"
	"golang.org/x/xerrors"

	"github.com/coder/coder/v2/coderd/database"
)

// OpenPool reserves database connections for lease maintenance so application
// queries cannot exhaust the connections needed to retain leadership. The caller
// must close the pool after the registry stops.
func OpenPool(application *sql.DB, dataSource string) (*sql.DB, error) {
	var connector driver.Connector
	var err error
	if creator, ok := application.Driver().(database.ConnectorCreator); ok {
		connector, err = creator.Connector(dataSource)
	} else {
		connector, err = pq.NewConnector(dataSource)
	}
	if err != nil {
		return nil, xerrors.Errorf("create HA database connector: %w", err)
	}
	// OpenDB passes each lease operation's context to connection establishment.
	db := sql.OpenDB(connector)
	// Handover updates must not occupy the renewal loop's connection.
	db.SetMaxOpenConns(2)
	db.SetMaxIdleConns(2)
	return db, nil
}
