"use strict";

const crypto = require("crypto");
const { query } = require("./pool");

function formatPullRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    repo_id: row.repo_id || null,
    repo: row.repo,
    provider: row.provider,
    pr_number: Number(row.pr_number),
    title: row.title || null,
    source_branch: row.source_branch,
    target_branch: row.target_branch,
    commit_hash: row.commit_hash,
    status: row.status,
    latest_job_id: row.latest_job_id || null,
    check_results:
      typeof row.check_results === "string"
        ? JSON.parse(row.check_results)
        : row.check_results || [],
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function upsertPullRequest(options) {
  const repo = options.repo;
  const provider = options.provider || "github";
  const pr_number = options.pr_number !== undefined ? options.pr_number : options.prNumber;
  const title = options.title || null;
  const source_branch = options.source_branch !== undefined ? options.source_branch : options.sourceBranch;
  const target_branch = options.target_branch !== undefined ? options.target_branch : options.targetBranch;
  const commit_hash = options.commit_hash !== undefined ? options.commit_hash : options.commitHash;
  const status = options.status || "pending";
  const latest_job_id = options.latest_job_id !== undefined ? options.latest_job_id : options.latestJobId || null;
  const check_results = options.check_results !== undefined ? options.check_results : options.checkResults || [];

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const cleanResults = JSON.stringify(check_results);

  const res = await query(
    `INSERT INTO pull_requests (
      id, repo, provider, pr_number, title, source_branch, target_branch, commit_hash, status, latest_job_id, check_results, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
    ON CONFLICT (repo, pr_number) DO UPDATE SET
      provider = EXCLUDED.provider,
      title = COALESCE(EXCLUDED.title, pull_requests.title),
      source_branch = EXCLUDED.source_branch,
      target_branch = EXCLUDED.target_branch,
      commit_hash = EXCLUDED.commit_hash,
      status = EXCLUDED.status,
      latest_job_id = COALESCE(EXCLUDED.latest_job_id, pull_requests.latest_job_id),
      check_results = CASE WHEN jsonb_array_length(EXCLUDED.check_results) > 0 THEN EXCLUDED.check_results ELSE pull_requests.check_results END,
      updated_at = EXCLUDED.updated_at
    RETURNING *`,
    [
      id,
      repo,
      provider,
      pr_number,
      title,
      source_branch,
      target_branch,
      commit_hash,
      status,
      latest_job_id,
      cleanResults,
      now,
    ],
  );

  return formatPullRequest(res.rows[0]);
}

async function getPullRequest(repoOrOptions, maybePrNumber) {
  let repo, pr_number;
  if (typeof repoOrOptions === "object" && repoOrOptions !== null) {
    repo = repoOrOptions.repo;
    pr_number = repoOrOptions.pr_number !== undefined ? repoOrOptions.pr_number : repoOrOptions.prNumber;
  } else {
    repo = repoOrOptions;
    pr_number = maybePrNumber;
  }

  const res = await query(
    "SELECT * FROM pull_requests WHERE repo = $1 AND pr_number = $2",
    [repo, pr_number],
  );
  return formatPullRequest(res.rows[0]);
}

async function updatePullRequestStatus({ id, status, check_results, checkResults }) {
  const cleanResults = JSON.stringify(check_results !== undefined ? check_results : checkResults || []);
  const res = await query(
    `UPDATE pull_requests
     SET status = $1, check_results = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [status, cleanResults, id],
  );
  return formatPullRequest(res.rows[0]);
}

async function getPullRequestByCommit(commitHash) {
  const res = await query(
    "SELECT * FROM pull_requests WHERE commit_hash = $1 ORDER BY updated_at DESC LIMIT 1",
    [commitHash],
  );
  return formatPullRequest(res.rows[0]);
}

async function listPullRequests(limit = 50) {
  const res = await query(
    "SELECT * FROM pull_requests ORDER BY updated_at DESC LIMIT $1",
    [limit],
  );
  return res.rows.map(formatPullRequest);
}

module.exports = {
  upsertPullRequest,
  getPullRequest,
  updatePullRequestStatus,
  getPullRequestByCommit,
  listPullRequests,
  formatPullRequest,
};
