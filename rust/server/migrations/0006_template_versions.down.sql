ALTER TABLE coder_rust.workspaces DROP COLUMN automatic_updates;
DROP INDEX coder_rust.template_version_names;
ALTER TABLE coder_rust.template_versions DROP COLUMN name, DROP COLUMN message, DROP COLUMN archived, DROP COLUMN created_at;
DROP INDEX coder_rust.template_names;
ALTER TABLE coder_rust.templates ADD CONSTRAINT templates_organization_id_name_key UNIQUE (organization_id,name);
ALTER TABLE coder_rust.templates DROP COLUMN deleted, DROP COLUMN icon, DROP COLUMN deprecation_message, DROP COLUMN default_ttl_ms, DROP COLUMN require_active_version;
