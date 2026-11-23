CREATE TABLE IF NOT EXISTS webhook_response_configs (
 endpoint_id uuid PRIMARY KEY REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
 mode text NOT NULL DEFAULT 'DEFAULT' CHECK (mode IN ('DEFAULT','CUSTOM')),
 status integer NOT NULL DEFAULT 200 CHECK (status BETWEEN 200 AND 599),
 content_type text NOT NULL DEFAULT 'application/json',
 body text NOT NULL DEFAULT '',
 headers jsonb NOT NULL DEFAULT '[]',
 delay_ms integer NOT NULL DEFAULT 0 CHECK (delay_ms BETWEEN 0 AND 2000),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE webhook_requests ADD COLUMN IF NOT EXISTS response_body text;
ALTER TABLE webhook_requests ADD COLUMN IF NOT EXISTS response_headers jsonb;
ALTER TABLE webhook_requests ADD COLUMN IF NOT EXISTS response_delay_ms integer NOT NULL DEFAULT 0;
ALTER TABLE webhook_requests ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'EXTERNAL' CHECK (source IN ('EXTERNAL','TEST'));
