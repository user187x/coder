CREATE TABLE coder_rust.provisioner_states (
    workspace_id uuid PRIMARY KEY REFERENCES coder_rust.workspaces,
    organization_id uuid NOT NULL REFERENCES coder_rust.organizations,
    revision bigint NOT NULL CHECK (revision > 0),
    dirty boolean NOT NULL DEFAULT false,
    nonce bytea NOT NULL,
    ciphertext bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
