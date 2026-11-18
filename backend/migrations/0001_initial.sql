CREATE TABLE IF NOT EXISTS webhook_endpoints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 public_token text NOT NULL UNIQUE, enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS webhook_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
 method text NOT NULL, path text NOT NULL, query jsonb NOT NULL, headers jsonb NOT NULL,
 raw_body text NOT NULL, parsed_body jsonb, parse_error text, content_type text NOT NULL,
 body_size integer NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 response_status integer NOT NULL, duration_ms integer NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_endpoint_time_idx ON webhook_requests(endpoint_id,received_at DESC);
