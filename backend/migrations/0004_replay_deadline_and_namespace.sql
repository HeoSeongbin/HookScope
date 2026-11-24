ALTER TABLE webhook_replay_jobs ADD COLUMN queue_name text NOT NULL DEFAULT 'hookscope-internal-replay';
ALTER TABLE webhook_replay_jobs ADD COLUMN next_attempt_at timestamptz;
CREATE INDEX replay_jobs_queue_status_idx ON webhook_replay_jobs(queue_name,status,updated_at);
