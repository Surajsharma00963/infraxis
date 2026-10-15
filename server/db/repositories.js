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
  description = null,
  isPrivate = false,
  htmlUrl = null,
  connectedAccountId = null,
  topics = [],
  detectedTech = {},
  config = {},
}) {
  const now = new Date().toISOString();
  const configJson = typeof config === "string" ? config : JSON.stringify(config || {});
  const topicsJson = Array.isArray(topics) ? JSON.stringify(topics) : JSON.stringify([]);
  const techJson = typeof detectedTech === "string" ? detectedTech : JSON.stringify(detectedTech || {});

  const res = await query(
    `INSERT INTO repositories (
      id, provider, owner, name, full_name, clone_url, default_branch,
      description, is_private, html_url, connected_account_id, topics,
      detected_tech, config, last_synced_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $15)
    ON CONFLICT (full_name) DO UPDATE SET
      provider = EXCLUDED.provider,
      owner = EXCLUDED.owner,
      name = EXCLUDED.name,
      clone_url = EXCLUDED.clone_url,
      default_branch = COALESCE(EXCLUDED.default_branch, repositories.default_branch),
      description = COALESCE(EXCLUDED.description, repositories.description),
      is_private = EXCLUDED.is_private,
      html_url = COALESCE(EXCLUDED.html_url, repositories.html_url),
      connected_account_id = COALESCE(EXCLUDED.connected_account_id, repositories.connected_account_id),
      topics = CASE WHEN EXCLUDED.topics = '[]'::jsonb THEN repositories.topics ELSE EXCLUDED.topics END,
      detected_tech = CASE WHEN EXCLUDED.detected_tech = '{}'::jsonb THEN repositories.detected_tech ELSE EXCLUDED.detected_tech END,
      config = EXCLUDED.config,
      last_synced_at = EXCLUDED.last_synced_at,
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
      description,
      Boolean(isPrivate),
      htmlUrl,
      connectedAccountId,
      topicsJson,
      techJson,
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

async function getRepositoryById(id) {
  const res = await query("SELECT * FROM repositories WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function listRepositories({
  provider = null,
  search = null,
  accountId = null,
  limit = 100,
  offset = 0,
} = {}) {
  let sql = "SELECT * FROM repositories WHERE 1=1";
  const params = [];

  if (provider) {
    params.push(provider);
    sql += ` AND provider = $${params.length}`;
  }
  if (accountId) {
    params.push(accountId);
    sql += ` AND connected_account_id = $${params.length}`;
  }
  if (search) {
    params.push(`%${search.trim().toLowerCase()}%`);
    sql += ` AND (LOWER(full_name) LIKE $${params.length} OR LOWER(description) LIKE $${params.length})`;
  }

  sql += ` ORDER BY updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const res = await query(sql, params);
  return res.rows;
}

async function updateRepositoryDetectedTech(fullName, detectedTech) {
  const techJson = typeof detectedTech === "string" ? detectedTech : JSON.stringify(detectedTech || {});
  const res = await query(
    `UPDATE repositories
     SET detected_tech = $2, updated_at = NOW()
     WHERE full_name = $1
     RETURNING *`,
    [fullName, techJson]
  );
  return res.rows[0] || null;
}

async function deleteRepository(id) {
  const res = await query("DELETE FROM repositories WHERE id = $1 RETURNING id, full_name", [id]);
  return res.rows[0] || null;
}

module.exports = {
  upsertRepository,
  getRepositoryByFullName,
  getRepositoryById,
  listRepositories,
  updateRepositoryDetectedTech,
  deleteRepository,
};
