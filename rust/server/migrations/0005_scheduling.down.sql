DROP INDEX coder_rust.build_deadline_due;
DROP INDEX coder_rust.workspace_schedule_due;
ALTER TABLE coder_rust.builds DROP COLUMN deadline, DROP COLUMN max_deadline, DROP COLUMN reason;
ALTER TABLE coder_rust.workspaces DROP COLUMN autostart_schedule, DROP COLUMN ttl_ms, DROP COLUMN next_start_at;
DROP TABLE coder_rust.deployment_settings;
