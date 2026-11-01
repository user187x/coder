CREATE SCHEMA IF NOT EXISTS coder_rust;

CREATE TABLE coder_rust.users (
    id uuid PRIMARY KEY,
    username text NOT NULL,
    email text NOT NULL,
    name text NOT NULL DEFAULT '',
    avatar_url text NOT NULL DEFAULT '',
    password_hash text NOT NULL,
    is_admin boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username ON coder_rust.users (lower(username));
CREATE UNIQUE INDEX users_email ON coder_rust.users (lower(email));

CREATE TABLE coder_rust.organizations (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE,
    display_name text NOT NULL
);
CREATE TABLE coder_rust.memberships (
    organization_id uuid NOT NULL REFERENCES coder_rust.organizations,
    user_id uuid NOT NULL REFERENCES coder_rust.users,
    PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE coder_rust.sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES coder_rust.users ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON coder_rust.sessions (expires_at);
CREATE TABLE coder_rust.login_limits (
    identity_hash text PRIMARY KEY,
    window_start timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL
);

CREATE TABLE coder_rust.templates (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES coder_rust.organizations,
    name text NOT NULL,
    display_name text NOT NULL DEFAULT '',
    description text NOT NULL DEFAULT '',
    active_version_id uuid NOT NULL,
    UNIQUE (organization_id, name)
);
CREATE TABLE coder_rust.template_versions (
    id uuid PRIMARY KEY,
    template_id uuid NOT NULL REFERENCES coder_rust.templates,
    parameters jsonb NOT NULL DEFAULT '[]',
    provisioner_spec jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE coder_rust.templates ADD CONSTRAINT active_version_fk FOREIGN KEY (active_version_id) REFERENCES coder_rust.template_versions DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE coder_rust.workspaces (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES coder_rust.organizations,
    owner_id uuid NOT NULL REFERENCES coder_rust.users,
    template_id uuid NOT NULL REFERENCES coder_rust.templates,
    name text NOT NULL,
    latest_build_id uuid,
    favorite boolean NOT NULL DEFAULT false,
    deleted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workspace_names ON coder_rust.workspaces (owner_id, lower(name)) WHERE NOT deleted;
CREATE TABLE coder_rust.builds (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES coder_rust.organizations,
    workspace_id uuid NOT NULL REFERENCES coder_rust.workspaces,
    build_number integer NOT NULL,
    template_version_id uuid NOT NULL REFERENCES coder_rust.template_versions,
    transition text NOT NULL CHECK (transition IN ('start', 'stop', 'delete')),
    status text NOT NULL CHECK (status IN ('pending', 'starting', 'stopping', 'deleting', 'running', 'stopped', 'deleted', 'failed', 'canceled')),
    parameters jsonb NOT NULL DEFAULT '[]',
    resources jsonb NOT NULL DEFAULT '[]',
    on_success boolean NOT NULL DEFAULT false,
    worker_id uuid,
    lease_hash text,
    lease_expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    UNIQUE (workspace_id, build_number)
);
ALTER TABLE coder_rust.workspaces ADD CONSTRAINT latest_build_fk FOREIGN KEY (latest_build_id) REFERENCES coder_rust.builds;
CREATE INDEX pending_builds ON coder_rust.builds (organization_id, created_at) WHERE status = 'pending';
CREATE TABLE coder_rust.build_logs (
    id bigserial PRIMARY KEY,
    build_id uuid NOT NULL REFERENCES coder_rust.builds,
    created_at timestamptz NOT NULL DEFAULT now(),
    log_level text NOT NULL,
    output text NOT NULL
);
CREATE INDEX build_logs_build ON coder_rust.build_logs (build_id, id);
CREATE TABLE coder_rust.provisioner_keys (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES coder_rust.organizations,
    token_hash text NOT NULL UNIQUE
);
CREATE TABLE coder_rust.secrets (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES coder_rust.users,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    env_name text NOT NULL DEFAULT '',
    file_path text NOT NULL DEFAULT '',
    enabled boolean NOT NULL DEFAULT true,
    nonce bytea NOT NULL,
    ciphertext bytea NOT NULL,
    value_bytes integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE UNIQUE INDEX secret_env_names ON coder_rust.secrets(user_id,env_name) WHERE enabled AND env_name<>'';
