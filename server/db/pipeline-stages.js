"use strict";

const crypto = require("crypto");
const { query } = require("./pool");

function formatStage(row) {
  if (!row) return null;
  return {
    id: row.id,
    job_id: row.job_id,
    name: row.name,
    stage_name: row.name,
    category: row.category,
    status: row.status,
    duration_ms: Number(row.duration_ms || 0),
    output: row.output || null,
    error_message: row.output || null,
    started_at: row.started_at ? new Date(row.started_at).toISOString() : null,
    finished_at: row.finished_at
      ? new Date(row.finished_at).toISOString()
      : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

async function recordPipelineStage(options) {
  const job_id = options.job_id !== undefined ? options.job_id : options.jobId;
  const name = options.name !== undefined ? options.name : options.stageName;
  const category = options.category || "custom";
  const status = options.status || "pending";
  const duration_ms =
    options.duration_ms !== undefined
      ? options.duration_ms
      : options.durationMs || 0;
  const output =
    options.output !== undefined
      ? options.output
      : options.errorMessage || null;
  const started_at = options.started_at || null;
  const finished_at = options.finished_at || null;

  // Check if stage already exists for this job_id and stage name
  const existing = await query(
    "SELECT id, started_at, duration_ms FROM pipeline_stages WHERE job_id = $1 AND name = $2 ORDER BY created_at DESC LIMIT 1",
    [job_id, name],
  );

  if (existing.rows.length > 0) {
    const stageId = existing.rows[0].id;
    const finalStartedAt = started_at || existing.rows[0].started_at;
    const res = await query(
      `UPDATE pipeline_stages SET
        status = $1,
        category = $2,
        duration_ms = CASE WHEN $3::integer > 0 THEN $3::integer ELSE duration_ms END,
        output = COALESCE($4, output),
        started_at = COALESCE($5, started_at),
        finished_at = COALESCE($6, finished_at)
      WHERE id = $7
      RETURNING *`,
      [
        status,
        category,
        duration_ms,
        output,
        finalStartedAt,
        finished_at,
        stageId,
      ],
    );
    return formatStage(res.rows[0]);
  }

  const id = crypto.randomUUID();
  const res = await query(
    `INSERT INTO pipeline_stages (
      id, job_id, name, category, status, duration_ms, output, started_at, finished_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    RETURNING *`,
    [
      id,
      job_id,
      name,
      category,
      status,
      duration_ms,
      output,
      started_at,
      finished_at,
    ],
  );
  return formatStage(res.rows[0]);
}

async function getJobPipelineStages(jobId) {
  const res = await query(
    `SELECT DISTINCT ON (name) *
     FROM pipeline_stages
     WHERE job_id = $1
     ORDER BY name, (status != 'running') DESC, created_at DESC`,
    [jobId],
  );
  const stages = res.rows.map(formatStage);
  stages.sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  return stages;
}

module.exports = {
  recordPipelineStage,
  saveStageResult: recordPipelineStage,
  getJobPipelineStages,
  getJobStages: getJobPipelineStages,
  formatStage,
};
