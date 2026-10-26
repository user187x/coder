CREATE TABLE workspace_quarantines (
    workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),
    organization_id uuid NOT NULL REFERENCES organizations(id),
    enabled boolean NOT NULL,
    revision uuid NOT NULL,
    reason text NOT NULL,
    updated_by uuid NOT NULL REFERENCES users(id),
    updated_at timestamptz NOT NULL,
    manual_start_required boolean NOT NULL DEFAULT true,
    release_prepared boolean NOT NULL DEFAULT false
);
CREATE INDEX workspace_quarantines_organization_id_idx ON workspace_quarantines (organization_id);
COMMENT ON TABLE workspace_quarantines IS 'Persistent workspace containment intent. Enabled does not establish physical enforcement.';
COMMENT ON COLUMN workspace_quarantines.manual_start_required IS 'A released workspace requires a new explicit user Start before automatic starts are permitted.';
COMMENT ON COLUMN workspace_quarantines.release_prepared IS 'Internal acknowledgement that durable connection withdrawal completed for this released policy revision.';
