CREATE TABLE workspace_sandbox_members (
    workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),
    organization_id uuid NOT NULL REFERENCES organizations(id),
    group_id uuid NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspace_sandbox_members_group_idx ON workspace_sandbox_members(organization_id, group_id);
COMMENT ON TABLE workspace_sandbox_members IS 'Organization-scoped network isolation groups projected into workspace startup policy.';
