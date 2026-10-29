CREATE TABLE short_term_leases (
    user_id uuid PRIMARY KEY REFERENCES users(id),
    organization_id uuid NOT NULL REFERENCES organizations(id),
    workspace_id uuid REFERENCES workspaces(id),
    issued_by uuid NOT NULL REFERENCES users(id),
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    extension_requested_at timestamptz,
    token_id text NOT NULL DEFAULT '',
    CHECK (expires_at > issued_at)
);
CREATE INDEX short_term_leases_organization_idx ON short_term_leases(organization_id);
CREATE UNIQUE INDEX short_term_leases_workspace_idx ON short_term_leases(workspace_id);
COMMENT ON TABLE short_term_leases IS 'Isolated temporary browser accounts. Expiration restricts the account independently of its API keys.';
