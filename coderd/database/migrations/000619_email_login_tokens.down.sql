ALTER TABLE users
	DROP COLUMN hashed_email_login_token,
	DROP COLUMN email_login_expires_at;
