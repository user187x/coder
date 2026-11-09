DELETE FROM audit_collectors WHERE kind <> 'audit';

ALTER TABLE audit_collectors
    DROP CONSTRAINT audit_collectors_organization_id_kind_issuer_subject_client_id_key;

ALTER TABLE audit_collectors
    ADD CONSTRAINT audit_collectors_organization_id_issuer_subject_client_id_key
    UNIQUE (organization_id, issuer, subject, client_id);

ALTER TABLE audit_collectors DROP COLUMN kind;
