-- Global time-window analytics; endpoint-time index already exists.
CREATE INDEX requests_received_time_idx ON webhook_requests(received_at);
CREATE INDEX replay_attempts_started_time_idx ON webhook_replay_attempts(started_at);
