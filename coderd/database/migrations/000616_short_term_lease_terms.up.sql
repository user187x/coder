ALTER TABLE short_term_leases ADD COLUMN hidden_at timestamptz;
ALTER TABLE short_term_leases ADD COLUMN auto_remove_history boolean NOT NULL DEFAULT false;
ALTER TABLE short_term_leases ADD COLUMN terms jsonb NOT NULL DEFAULT '{}';
