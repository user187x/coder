ALTER TABLE users
    ADD COLUMN failed_password_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN password_locked_until timestamptz;
