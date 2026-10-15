-- Migration 003: Universal CI/CD Platform Schema
-- Extends Infraxis with worker capabilities, pull request tracking, pipeline stages, and project configs

-- 1. Extend workers table with hardware architecture, toolchain capabilities, and system info
ALTER TABLE workers ADD COLUMN IF NOT EXISTS arch TEXT DEFAULT 'unknown';
ALTER TABLE workers ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '{}'::jsonb;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS system_info JSONB DEFAULT '{}'::jsonb;

-- 2. Pull Requests table for automatic PR checks (GitHub & Bitbucket)
CREATE TABLE IF NOT EXISTS pull_requests (
  id TEXT PRIMARY KEY,
  repo_id TEXT REFERENCES repositories(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'github',
  pr_number INTEGER NOT NULL,
  title TEXT,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failure', 'cancelled', 'skipped')),
  latest_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  check_results JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_repo_pr UNIQUE (repo, pr_number)
);

-- 3. Pipeline Stages table for tracking individual stages (lint, typecheck, test, build, etc.)
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'custom',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'passed', 'failed', 'skipped')),
  duration_ms INTEGER DEFAULT 0,
  output TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Project Configurations and detection metadata cache
CREATE TABLE IF NOT EXISTS project_configs (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL UNIQUE,
  project_types JSONB DEFAULT '[]'::jsonb,
  custom_config JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_pull_requests_repo ON pull_requests(repo, pr_number);
CREATE INDEX IF NOT EXISTS idx_pull_requests_status ON pull_requests(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pull_requests_commit ON pull_requests(commit_hash);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_job ON pipeline_stages(job_id);
