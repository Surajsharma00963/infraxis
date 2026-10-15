-- Migration 004: GitHub and Bitbucket Repository Integrations
-- Supports connected git accounts, encrypted credentials, OAuth state verification, and repository metadata

-- 1. Connected Git Accounts (GitHub, Bitbucket)
CREATE TABLE IF NOT EXISTS git_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'bitbucket')),
  account_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  avatar_url TEXT,
  auth_type TEXT NOT NULL DEFAULT 'oauth' CHECK (auth_type IN ('oauth', 'pat', 'token')),
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'error')),
  error_message TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_git_account_provider UNIQUE (provider, account_id)
);

-- 2. OAuth States for CSRF protection and callback security
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'bitbucket')),
  user_id TEXT,
  redirect_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- 3. Extend repositories table with richer metadata and account linkage
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS html_url TEXT;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS connected_account_id TEXT REFERENCES git_accounts(id) ON DELETE SET NULL;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS topics JSONB DEFAULT '[]'::jsonb;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS detected_tech JSONB DEFAULT '{}'::jsonb;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_git_accounts_user ON git_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_git_accounts_provider ON git_accounts(provider, status);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_repositories_account ON repositories(connected_account_id);
CREATE INDEX IF NOT EXISTS idx_repositories_provider ON repositories(provider);
