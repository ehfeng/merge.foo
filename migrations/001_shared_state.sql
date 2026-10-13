-- Run deliberately against the operator's external PostgreSQL database. No credentials here.
-- Generalized resources support plans, workflow configuration, generation/lease/outbox state and inbox deduplication.
CREATE TABLE IF NOT EXISTS merge_state (
  scope TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('plan','workflow','inbox','job')),
  resource_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  document JSONB NOT NULL,
  actor_id TEXT NOT NULL,
  actor_login TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (scope,kind,resource_key)
);
CREATE TABLE IF NOT EXISTS merge_state_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  document JSONB NOT NULL,
  actor_id TEXT NOT NULL,
  actor_login TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(scope,kind,resource_key,version)
);
CREATE INDEX IF NOT EXISTS merge_state_audit_scope ON merge_state_audit(scope,kind,id DESC);
