ALTER TABLE users
	ADD COLUMN hashed_email_login_token bytea,
	ADD COLUMN email_login_expires_at timestamptz,
	ADD CONSTRAINT email_login_token_set CHECK (
		(hashed_email_login_token IS NULL) = (email_login_expires_at IS NULL)
	);
