"use strict";

const crypto = require("crypto");
const { query } = require("./pool");

async function upsertRepository({
  id = crypto.randomUUID(),
  provider = "unknown",
  owner,
  name,
  fullName,
  cloneUrl,
  defaultBranch = "main",
  config = {},
}) {
  const now = new Date().toISOString();
  const configJson = typeof config === "string" ? config : JSON.stringify(config || {});

  const res = await query(
    `INSERT INTO repositories (
      id, provider, owner, name, full_name, clone_url, default_branch, config, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
    ON CONFLICT (full_name) DO UPDATE SET
      clone_url = EXCLUDED.clone_url,
      default_branch = COALESCE(EXCLUDED.default_branch, repositories.default_branch),
      config = EXCLUDED.config,
      updated_at = EXCLUDED.updated_at
    RETURNING *`,
    [
      id,
      provider,
      owner,
      name,
      fullName,
      cloneUrl,
      defaultBranch || "main",
      configJson,
      now,
    ]
  );

  return res.rows[0];
}

async function getRepositoryByFullName(fullName) {
  const res = await query("SELECT * FROM repositories WHERE full_name = $1", [fullName]);
  return res.rows[0] || null;
}

async function listRepositories() {
  const res = await query("SELECT * FROM repositories ORDER BY full_name ASC");
  return res.rows;
}

module.exports = {
  upsertRepository,
  getRepositoryByFullName,
  listRepositories,
};
