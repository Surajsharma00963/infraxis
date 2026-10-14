-- Infraxis Core Database Schema
-- Migration 001: Initial Core Schema

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Repositories (GitHub, Bitbucket, local)
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'unknown',
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL UNIQUE,
  clone_url TEXT NOT NULL,
  default_branch TEXT DEFAULT 'main',
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workers (Infraxis Agents)
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  platform TEXT DEFAULT 'unknown',
  version TEXT DEFAULT '0.2.0',
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'idle',
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_job TEXT,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Jobs
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  repo_id TEXT REFERENCES repositories(id) ON DELETE SET NULL,
  repo TEXT NOT NULL,
  clone_url TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  branch TEXT NOT NULL,
  kind TEXT NOT NULL,
  package_manager TEXT DEFAULT 'auto',
  priority INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'claimed', 'succeeded', 'failed', 'cancelled', 'retrying')),
  requested_by TEXT NOT NULL,
  worker_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  exit_code INTEGER,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  timeout_seconds INTEGER NOT NULL DEFAULT 3600,
  idempotency_key TEXT UNIQUE
);

-- Job attempts & history
CREATE TABLE IF NOT EXISTS job_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  worker_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  exit_code INTEGER,
  failure_reason TEXT,
  retry_decision TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_job_attempt UNIQUE (job_id, attempt_number)
);

-- Monotonically ordered build logs
CREATE TABLE IF NOT EXISTS logs (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  seq BIGINT NOT NULL DEFAULT 0,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stream TEXT NOT NULL DEFAULT 'stdout',
  line TEXT NOT NULL
);

-- Artifact metadata (large files kept on filesystem or object store)
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  filename TEXT NOT NULL,
  content_type TEXT,
  path TEXT NOT NULL,
  size BIGINT NOT NULL DEFAULT 0,
  checksum TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit events for administrative, worker, and release operations
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User management and authentication
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  organization TEXT,
  role_title TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  is_verified INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otps (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pending_registrations (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT,
  phone TEXT,
  organization TEXT,
  role_title TEXT,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance and atomic queue scheduling
CREATE INDEX IF NOT EXISTS idx_jobs_queue_scheduling ON jobs(status, priority DESC, created_at ASC) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_worker ON jobs(worker_id) WHERE worker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_idempotency_key ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_attempts_job ON job_attempts(job_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_workers_last_seen ON workers(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_logs_job_id_id ON logs(job_id, id);
CREATE INDEX IF NOT EXISTS idx_logs_job_id_seq ON logs(job_id, seq);
CREATE INDEX IF NOT EXISTS idx_artifacts_job_id ON artifacts(job_id);
CREATE INDEX IF NOT EXISTS idx_otps_lookup ON otps(email, purpose, used);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC);
