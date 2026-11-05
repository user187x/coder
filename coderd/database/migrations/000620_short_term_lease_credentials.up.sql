CREATE TABLE short_term_lease_credentials (
    user_id uuid PRIMARY KEY REFERENCES short_term_leases(user_id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    token_id text NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    value text NOT NULL,
    value_key_id text REFERENCES dbcrypt_keys(active_key_digest)
);
