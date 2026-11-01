ALTER TABLE coder_rust.workspace_agents DROP COLUMN terminal;
ALTER TABLE coder_rust.users DROP COLUMN login_type;
DROP TABLE coder_rust.oidc_identities;
DROP TABLE coder_rust.audit_events;
DROP FUNCTION coder_rust.permitted(uuid,uuid,text,uuid,boolean);
DROP TABLE coder_rust.role_bindings;
DROP TABLE coder_rust.role_permissions;
DROP TABLE coder_rust.roles;
