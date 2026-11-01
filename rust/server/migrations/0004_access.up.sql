CREATE TABLE coder_rust.roles (
    organization_id uuid NOT NULL REFERENCES coder_rust.organizations,
    id uuid NOT NULL,
    name text NOT NULL,
    PRIMARY KEY (organization_id,id),
    UNIQUE (organization_id,name)
);
CREATE TABLE coder_rust.role_permissions (
    organization_id uuid NOT NULL,
    role_id uuid NOT NULL,
    action text NOT NULL,
    resource_id uuid,
    allow boolean NOT NULL,
    FOREIGN KEY (organization_id,role_id) REFERENCES coder_rust.roles ON DELETE CASCADE
);
CREATE TABLE coder_rust.role_bindings (
    organization_id uuid NOT NULL,
    role_id uuid NOT NULL,
    user_id uuid NOT NULL,
    PRIMARY KEY (organization_id,role_id,user_id),
    FOREIGN KEY (organization_id,role_id) REFERENCES coder_rust.roles ON DELETE CASCADE,
    FOREIGN KEY (organization_id,user_id) REFERENCES coder_rust.memberships ON DELETE CASCADE
);
CREATE INDEX role_bindings_user ON coder_rust.role_bindings (user_id,organization_id);

-- One policy evaluator serves both individual objects and filtered list queries.
-- Deployment owners remain break-glass administrators, but must belong to the org.
CREATE FUNCTION coder_rust.permitted(actor uuid, org uuid, operation text, resource uuid, baseline boolean)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM coder_rust.users u
        JOIN coder_rust.memberships m ON m.user_id=u.id AND m.organization_id=org
        WHERE u.id=actor AND u.status='active' AND (
            u.is_admin OR (
                NOT EXISTS (
                    SELECT 1 FROM coder_rust.role_bindings b
                    JOIN coder_rust.role_permissions p USING (organization_id,role_id)
                    WHERE b.user_id=actor AND b.organization_id=org AND p.action=operation
                    AND (p.resource_id IS NULL OR p.resource_id=resource) AND NOT p.allow
                ) AND (baseline OR EXISTS (
                    SELECT 1 FROM coder_rust.role_bindings b
                    JOIN coder_rust.role_permissions p USING (organization_id,role_id)
                    WHERE b.user_id=actor AND b.organization_id=org AND p.action=operation
                    AND (p.resource_id IS NULL OR p.resource_id=resource) AND p.allow
                ))
            )
        )
    )
$$;

CREATE TABLE coder_rust.audit_events (
    id bigserial PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES coder_rust.organizations,
    actor_id uuid NOT NULL REFERENCES coder_rust.users,
    action text NOT NULL,
    resource_id uuid,
    details jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org ON coder_rust.audit_events (organization_id,id);

CREATE TABLE coder_rust.oidc_identities (
    issuer text NOT NULL,
    subject text NOT NULL,
    user_id uuid NOT NULL REFERENCES coder_rust.users ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES coder_rust.organizations,
    PRIMARY KEY (issuer,subject),
    UNIQUE (issuer,user_id)
);
ALTER TABLE coder_rust.users ADD COLUMN login_type text NOT NULL DEFAULT 'password'
    CHECK (login_type IN ('password','oidc'));
ALTER TABLE coder_rust.workspace_agents ADD COLUMN terminal boolean NOT NULL DEFAULT false;
