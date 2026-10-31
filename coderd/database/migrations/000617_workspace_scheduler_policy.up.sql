-- Keep enforcement in the same database as workspace lifecycle operations.
DO $$ BEGIN
    IF to_regclass('coder_ui_updates.documents') IS NOT NULL THEN
        EXECUTE $query$
            INSERT INTO site_configs (key, value)
            SELECT 'workspace_scheduler', (body->'workspace_scheduler')::text
            FROM coder_ui_updates.documents
            WHERE name = 'platform-settings' AND body ? 'workspace_scheduler'
            ON CONFLICT (key) DO NOTHING
        $query$;
    END IF;
END $$;
