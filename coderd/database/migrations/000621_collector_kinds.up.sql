-- A collector grant reads an organization's audit logs ("audit") or its metrics ("metrics"); each kind has its own
-- grants, so one identity may hold both.
ALTER TABLE audit_collectors
    ADD COLUMN kind text NOT NULL DEFAULT 'audit' CONSTRAINT audit_collectors_kind_check CHECK (kind IN ('audit', 'metrics'));

ALTER TABLE audit_collectors
    DROP CONSTRAINT audit_collectors_organization_id_issuer_subject_client_id_key;

ALTER TABLE audit_collectors
    ADD CONSTRAINT audit_collectors_organization_id_kind_issuer_subject_client_id_key
    UNIQUE (organization_id, kind, issuer, subject, client_id);
