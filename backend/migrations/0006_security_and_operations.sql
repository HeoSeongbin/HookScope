CREATE TABLE management_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 role text NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('ADMIN','MEMBER')),
 key_hash text UNIQUE, enabled boolean NOT NULL DEFAULT true,
 key_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO management_users(id,name,role) VALUES('00000000-0000-4000-8000-000000000001','Local administrator','ADMIN');
ALTER TABLE webhook_endpoints ADD COLUMN owner_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES management_users(id);
ALTER TABLE webhook_endpoints ADD COLUMN expires_at timestamptz;
-- Preserve legacy retention; only newly created endpoints default to seven days.
ALTER TABLE webhook_endpoints ADD COLUMN retention_days integer CHECK (retention_days BETWEEN 1 AND 365);
ALTER TABLE webhook_endpoints ALTER COLUMN retention_days SET DEFAULT 7;
ALTER TABLE webhook_endpoints ADD COLUMN rate_limit_per_minute integer NOT NULL DEFAULT 120 CHECK (rate_limit_per_minute BETWEEN 1 AND 1200);
ALTER TABLE webhook_endpoints ADD COLUMN max_requests integer NOT NULL DEFAULT 10000 CHECK (max_requests BETWEEN 1 AND 100000);
ALTER TABLE webhook_endpoints ADD COLUMN max_body_storage_bytes integer NOT NULL DEFAULT 67108864 CHECK (max_body_storage_bytes BETWEEN 1 AND 1073741824);
CREATE INDEX endpoints_owner_idx ON webhook_endpoints(owner_id);
CREATE TABLE audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES management_users(id),
 owner_id uuid NOT NULL REFERENCES management_users(id), action text NOT NULL, target_id uuid,
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_owner_time_idx ON audit_logs(owner_id,created_at);
CREATE INDEX audit_created_time_idx ON audit_logs(created_at);
