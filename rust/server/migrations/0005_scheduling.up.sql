CREATE TABLE coder_rust.deployment_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE coder_rust.workspaces
    ADD COLUMN autostart_schedule text,
    ADD COLUMN ttl_ms bigint CHECK (ttl_ms BETWEEN 60000 AND 2592000000),
    ADD COLUMN next_start_at timestamptz;

ALTER TABLE coder_rust.builds
    ADD COLUMN deadline timestamptz,
    ADD COLUMN max_deadline timestamptz,
    ADD COLUMN reason text NOT NULL DEFAULT 'initiator';

CREATE INDEX workspace_schedule_due ON coder_rust.workspaces(next_start_at)
    WHERE NOT deleted AND next_start_at IS NOT NULL;
CREATE INDEX build_deadline_due ON coder_rust.builds(deadline)
    WHERE status='running' AND deadline IS NOT NULL;
