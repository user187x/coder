ALTER TABLE users
    DROP COLUMN password_locked_until,
    DROP COLUMN failed_password_attempts;
