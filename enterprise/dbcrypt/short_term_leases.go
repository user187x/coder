package dbcrypt

import (
	"context"
	"database/sql"

	"github.com/coder/coder/v2/coderd/database"
)

func (db *dbCrypt) GetShortTermLeaseCredential(ctx context.Context, arg database.GetShortTermLeaseCredentialParams) (database.ShortTermLeaseCredential, error) {
	credential, err := db.Store.GetShortTermLeaseCredential(ctx, arg)
	if err != nil {
		return database.ShortTermLeaseCredential{}, err
	}
	if err := db.decryptField(&credential.Value, credential.ValueKeyID); err != nil {
		return database.ShortTermLeaseCredential{}, err
	}
	return credential, nil
}

func (db *dbCrypt) ListShortTermLeaseCredentials(ctx context.Context) ([]database.ShortTermLeaseCredential, error) {
	credentials, err := db.Store.ListShortTermLeaseCredentials(ctx)
	if err != nil {
		return nil, err
	}
	for i := range credentials {
		if err := db.decryptField(&credentials[i].Value, credentials[i].ValueKeyID); err != nil {
			return nil, err
		}
	}
	return credentials, nil
}

func (db *dbCrypt) UpsertShortTermLeaseCredential(ctx context.Context, arg database.UpsertShortTermLeaseCredentialParams) error {
	if err := db.encryptField(&arg.Value, &arg.ValueKeyID); err != nil {
		return err
	}
	return db.Store.UpsertShortTermLeaseCredential(ctx, arg)
}

// reencryptLeaseCredentials keeps lease tokens usable through database key rotation.
func reencryptLeaseCredentials(ctx context.Context, db database.Store) error {
	return db.InTx(func(tx database.Store) error {
		credentials, err := tx.ListShortTermLeaseCredentials(ctx)
		if err != nil {
			return err
		}
		for _, credential := range credentials {
			if err := tx.UpsertShortTermLeaseCredential(ctx, database.UpsertShortTermLeaseCredentialParams{
				UserID: credential.UserID, OrganizationID: credential.OrganizationID,
				TokenID: credential.TokenID, Value: credential.Value, ValueKeyID: sql.NullString{},
			}); err != nil {
				return err
			}
		}
		return nil
	}, nil)
}
