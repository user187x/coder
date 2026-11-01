ALTER TABLE coder_rust.templates
    ADD COLUMN deleted boolean NOT NULL DEFAULT false,
    ADD COLUMN icon text NOT NULL DEFAULT '',
    ADD COLUMN deprecation_message text NOT NULL DEFAULT '',
    ADD COLUMN default_ttl_ms bigint NOT NULL DEFAULT 0 CHECK (default_ttl_ms=0 OR default_ttl_ms BETWEEN 60000 AND 2592000000),
    ADD COLUMN require_active_version boolean NOT NULL DEFAULT false;
ALTER TABLE coder_rust.templates DROP CONSTRAINT templates_organization_id_name_key;
CREATE UNIQUE INDEX template_names ON coder_rust.templates(organization_id,lower(name)) WHERE NOT deleted;
ALTER TABLE coder_rust.template_versions
    ADD COLUMN name text,
    ADD COLUMN message text NOT NULL DEFAULT '',
    ADD COLUMN archived boolean NOT NULL DEFAULT false,
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
UPDATE coder_rust.template_versions SET name='v-' || id::text;
ALTER TABLE coder_rust.template_versions ALTER COLUMN name SET NOT NULL;
CREATE UNIQUE INDEX template_version_names ON coder_rust.template_versions(template_id,lower(name));
ALTER TABLE coder_rust.workspaces ADD COLUMN automatic_updates text NOT NULL DEFAULT 'never' CHECK (automatic_updates IN ('always','never'));
