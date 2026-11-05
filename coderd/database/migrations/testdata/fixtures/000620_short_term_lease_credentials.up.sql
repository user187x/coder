INSERT INTO api_keys (
    id, hashed_secret, user_id, last_used, expires_at, created_at, updated_at,
    login_type, lifetime_seconds, ip_address, token_name, scopes, allow_list
)
VALUES (
    'lease-credential-fixture',
    '\xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '0ed9befc-4911-4ccf-a8e2-559bf72daa94',
    NOW(), NOW() + INTERVAL '30 days', NOW(), NOW(),
    'password', 86400, '0.0.0.0', 'lease-credential-fixture',
    ARRAY['workspace:read']::api_key_scope[], ARRAY['*:*']
);

UPDATE short_term_leases
SET token_id = 'lease-credential-fixture'
WHERE user_id = '0ed9befc-4911-4ccf-a8e2-559bf72daa94';

INSERT INTO short_term_lease_credentials (user_id, organization_id, token_id, value)
SELECT user_id, organization_id, token_id, 'fixture-token'
FROM short_term_leases
WHERE user_id = '0ed9befc-4911-4ccf-a8e2-559bf72daa94';
