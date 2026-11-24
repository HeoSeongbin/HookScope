CREATE TABLE webhook_replay_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
 original_request_id uuid NOT NULL REFERENCES webhook_requests(id) ON DELETE CASCADE,
 idempotency_key uuid NOT NULL UNIQUE,
 max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 3),
 status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','QUEUED','RUNNING','RETRYING','SUCCEEDED','FAILED','CANCELLED','UNKNOWN')),
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX replay_jobs_endpoint_time_idx ON webhook_replay_jobs(endpoint_id,created_at DESC);
CREATE INDEX replay_jobs_status_idx ON webhook_replay_jobs(status);
CREATE TABLE webhook_replay_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL REFERENCES webhook_replay_jobs(id) ON DELETE CASCADE,
 number integer NOT NULL CHECK (number BETWEEN 1 AND 3),
 request_id uuid NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','SUCCEEDED','FAILED','UNKNOWN')),
 error_code text, response_status integer, response_body text, response_headers jsonb, duration_ms integer,
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(job_id,number)
);
ALTER TABLE webhook_requests DROP CONSTRAINT IF EXISTS webhook_requests_source_check;
ALTER TABLE webhook_requests ADD CONSTRAINT webhook_requests_source_check CHECK (source IN ('EXTERNAL','TEST','REPLAY'));
ALTER TABLE webhook_requests ADD COLUMN replay_attempt_id uuid UNIQUE REFERENCES webhook_replay_attempts(id) ON DELETE SET NULL;
