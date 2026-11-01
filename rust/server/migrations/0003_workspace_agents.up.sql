CREATE TABLE coder_rust.workspace_agents (
    workspace_id uuid PRIMARY KEY REFERENCES coder_rust.workspaces,
    organization_id uuid NOT NULL REFERENCES coder_rust.organizations,
    id uuid NOT NULL UNIQUE,
    token_hash text NOT NULL UNIQUE,
    ports jsonb NOT NULL,
    nonce bytea NOT NULL,
    ciphertext bytea NOT NULL,
    last_connected_at timestamptz
);
