"use strict";

const crypto = require("crypto");
const { query } = require("./pool");

async function createArtifactMetadata({
  id = crypto.randomUUID(),
  jobId,
  attemptNumber = 1,
  filename,
  contentType = "application/octet-stream",
  path,
  size = 0,
  checksum = null,
}) {
  const now = new Date().toISOString();
  const res = await query(
    `INSERT INTO artifacts (id, job_id, attempt_number, filename, content_type, path, size, checksum, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      id,
      jobId,
      attemptNumber,
      filename,
      contentType,
      path,
      size,
      checksum,
      now,
    ]
  );
  const row = res.rows[0];
  return {
    id: row.id,
    job_id: row.job_id,
    filename: row.filename,
    contentType: row.content_type,
    path: row.path,
    size: Number(row.size),
    checksum: row.checksum,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

async function listArtifactsByJobId(jobId) {
  const res = await query(
    `SELECT id, job_id, filename, content_type, path, size, checksum, created_at
     FROM artifacts
     WHERE job_id = $1
     ORDER BY created_at DESC`,
    [jobId]
  );

  return res.rows.map((row) => ({
    id: row.id,
    job_id: row.job_id,
    filename: row.filename,
    contentType: row.content_type,
    path: row.path,
    size: Number(row.size),
    checksum: row.checksum,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}

async function getArtifactById(id) {
  const res = await query("SELECT * FROM artifacts WHERE id = $1", [id]);
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    id: row.id,
    job_id: row.job_id,
    filename: row.filename,
    contentType: row.content_type,
    path: row.path,
    size: Number(row.size),
    checksum: row.checksum,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

async function listAllArtifacts(limit = 100) {
  const res = await query(
    `SELECT a.id, a.job_id, a.filename, a.content_type, a.path, a.size, a.checksum, a.created_at,
            j.repo, j.kind, j.branch, j.commit_hash
     FROM artifacts a
     LEFT JOIN jobs j ON a.job_id = j.id
     ORDER BY a.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return res.rows.map((row) => ({
    id: row.id,
    job_id: row.job_id,
    filename: row.filename,
    contentType: row.content_type,
    path: row.path,
    size: Number(row.size),
    checksum: row.checksum,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    repo: row.repo,
    kind: row.kind,
    branch: row.branch,
    commit_hash: row.commit_hash,
  }));
}

module.exports = {
  createArtifactMetadata,
  listArtifactsByJobId,
  listAllArtifacts,
  getArtifactById,
};

