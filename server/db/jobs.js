"use strict";

const crypto = require("crypto");
const { query, withTransaction } = require("./pool");
const { recordAuditEvent } = require("./audit");

const SUPPORTED_KINDS = [
  "pr-checks",
  "android-debug",
  "android-release",
  "ios-simulator",
  "ios-release",
];

const REQUIRED_LABELS = {
  "pr-checks": ["android"],
  "android-debug": ["android"],
  "android-release": ["android"],
  "ios-simulator": ["ios"],
  "ios-release": ["ios"],
};

function formatJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    repo_id: row.repo_id || null,
    ownerRepo: row.repo,
    repo: row.repo,
    cloneUrl: row.clone_url,
    clone_url: row.clone_url,
    commitHash: row.commit_hash,
    commit_hash: row.commit_hash,
    branch: row.branch,
    kind: row.kind,
    package_manager: row.package_manager || "auto",
    priority: Number(row.priority ?? 10),
    status: row.status,
    requested_by: row.requested_by,
    worker_id: row.worker_id || null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    queued_at: row.queued_at ? new Date(row.queued_at).toISOString() : null,
    started_at: row.started_at ? new Date(row.started_at).toISOString() : null,
    finished_at: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    exit_code: row.exit_code != null ? Number(row.exit_code) : null,
    error: row.error || null,
    retry_count: Number(row.retry_count ?? 0),
    max_retries: Number(row.max_retries ?? 2),
    timeout_seconds: Number(row.timeout_seconds ?? 3600),
    idempotency_key: row.idempotency_key || null,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : (row.metadata || {}),
  };
}

async function getJobById(id) {
  const res = await query("SELECT * FROM jobs WHERE id = $1", [id]);
  return formatJob(res.rows[0]);
}

async function listJobs(limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const res = await query(
    "SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1",
    [safeLimit]
  );
  return res.rows.map(formatJob);
}

async function createJob({
  id = crypto.randomUUID(),
  repo,
  cloneUrl,
  commitHash,
  branch,
  kind,
  packageManager = "auto",
  requestedBy = "dashboard",
  priority = 10,
  maxRetries = 2,
  timeoutSeconds = 3600,
  idempotencyKey = null,
  repoId = null,
  metadata = {},
}) {
  return await withTransaction(async (client) => {
    // 1. Check idempotency
    if (idempotencyKey) {
      const existing = await client.query(
        "SELECT * FROM jobs WHERE idempotency_key = $1",
        [idempotencyKey]
      );
      if (existing.rows.length > 0) {
        return {
          job: formatJob(existing.rows[0]),
          isDuplicate: true,
        };
      }
    }

    const now = new Date().toISOString();
    const cleanCommit = (commitHash || "").toLowerCase();

    const insertRes = await client.query(
      `INSERT INTO jobs (
        id, repo_id, repo, clone_url, commit_hash, branch, kind, package_manager,
        priority, status, requested_by, created_at, queued_at,
        retry_count, max_retries, timeout_seconds, idempotency_key, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, 'queued', $10, $11, $11,
        0, $12, $13, $14, $15
      ) RETURNING *`,
      [
        id,
        repoId,
        repo,
        cloneUrl,
        cleanCommit,
        branch,
        kind,
        packageManager || "auto",
        priority,
        requestedBy,
        now,
        maxRetries,
        timeoutSeconds,
        idempotencyKey,
        JSON.stringify(metadata || {}),
      ]
    );

    const job = formatJob(insertRes.rows[0]);

    // Record audit event
    await client.query(
      `INSERT INTO audit_events (id, action, actor, entity_type, entity_id, metadata, created_at)
       VALUES ($1, 'job:created', $2, 'job', $3, $4, NOW())`,
      [
        crypto.randomUUID(),
        requestedBy,
        id,
        JSON.stringify({ kind, repo, branch, commitHash: cleanCommit }),
      ]
    );

    return { job, isDuplicate: false };
  });
}

/**
 * Atomic concurrent job claiming using SELECT ... FOR UPDATE SKIP LOCKED
 * Guarantees that multiple Infraxis Agents never claim the same job simultaneously.
 */
async function claimNextJob({ workerId, labels = [] }) {
  const workerLabelsSet = new Set(labels);
  const canHandleKinds = [];
  for (const [kind, req] of Object.entries(REQUIRED_LABELS)) {
    if (req.every((l) => workerLabelsSet.has(l))) {
      canHandleKinds.push(kind);
    }
  }

  if (canHandleKinds.length === 0) {
    return null;
  }

  return await withTransaction(async (client) => {
    // 1. Fetch exactly 1 compatible queued job with row lock, skipping locked rows
    const candidateRes = await client.query(
      `SELECT * FROM jobs
       WHERE status = 'queued' AND kind = ANY($1::text[])
       ORDER BY priority DESC, created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [canHandleKinds]
    );

    if (candidateRes.rows.length === 0) {
      return null;
    }

    const matchedRow = candidateRes.rows[0];
    const now = new Date().toISOString();
    const nextAttempt = (matchedRow.retry_count || 0) + 1;

    // 3. Atomically transition job to 'running'
    const updateRes = await client.query(
      `UPDATE jobs
       SET status = 'running', worker_id = $1, started_at = $2
       WHERE id = $3 AND status = 'queued'
       RETURNING *`,
      [workerId, now, matchedRow.id]
    );

    if (updateRes.rows.length === 0) {
      return null;
    }

    // 4. Record new attempt in job_attempts
    const attemptId = crypto.randomUUID();
    await client.query(
      `INSERT INTO job_attempts (
        id, job_id, attempt_number, worker_id, started_at, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, 'running', $5)
      ON CONFLICT (job_id, attempt_number) DO UPDATE
      SET worker_id = EXCLUDED.worker_id, started_at = EXCLUDED.started_at, status = 'running'`,
      [attemptId, matchedRow.id, nextAttempt, workerId, now]
    );

    // 5. Update worker status
    await client.query(
      `UPDATE workers
       SET current_job = $1, status = 'busy', last_seen = $2, last_heartbeat = $2
       WHERE id = $3`,
      [matchedRow.id, now, workerId]
    );

    // 6. Record audit log for claim
    await client.query(
      `INSERT INTO audit_events (id, action, actor, entity_type, entity_id, metadata, created_at)
       VALUES ($1, 'job:claimed', $2, 'job', $3, $4, NOW())`,
      [
        crypto.randomUUID(),
        workerId,
        matchedRow.id,
        JSON.stringify({ attempt: nextAttempt }),
      ]
    );

    const claimedJob = formatJob(updateRes.rows[0]);
    return {
      ...claimedJob,
      attemptNumber: nextAttempt,
    };
  });
}

/**
 * Finish a running job.
 * Validates status to ensure stale workers cannot overwrite newer attempts or cancelled jobs.
 */
async function finishJob({ jobId, workerId, exitCode, error = null }) {
  return await withTransaction(async (client) => {
    // 1. Fetch current job state with lock
    const currentRes = await client.query(
      "SELECT * FROM jobs WHERE id = $1 FOR UPDATE",
      [jobId]
    );

    if (currentRes.rows.length === 0) {
      return { ok: false, error: "Job not found" };
    }

    const job = currentRes.rows[0];

    // Status transition validation: only running jobs can be finished
    if (job.status !== "running") {
      return {
        ok: false,
        error: `Cannot finish job: current status is '${job.status}' (expected 'running')`,
      };
    }

    // Worker validation: stale worker cannot finish a job reassigned to another worker
    if (workerId && job.worker_id && job.worker_id !== workerId) {
      return {
        ok: false,
        error: `Worker '${workerId}' is not the assigned worker for job '${jobId}' (assigned to '${job.worker_id}')`,
      };
    }

    const now = new Date().toISOString();
    const finalExitCode = Number.isInteger(exitCode) ? Number(exitCode) : (error ? 1 : 0);
    const isSuccess = finalExitCode === 0;
    const finalStatus = isSuccess ? "succeeded" : "failed";
    const cleanError = typeof error === "string" ? error.slice(0, 2000) : null;

    // 2. Update job
    const updatedRes = await client.query(
      `UPDATE jobs
       SET status = $1, finished_at = $2, exit_code = $3, error = $4
       WHERE id = $5
       RETURNING *`,
      [finalStatus, now, finalExitCode, cleanError, jobId]
    );

    // 3. Update current attempt
    const attemptNum = (job.retry_count || 0) + 1;
    await client.query(
      `UPDATE job_attempts
       SET finished_at = $1, exit_code = $2, failure_reason = $3, status = $4
       WHERE job_id = $5 AND attempt_number = $6`,
      [now, finalExitCode, cleanError, finalStatus, jobId, attemptNum]
    );

    // 4. Free worker
    if (job.worker_id) {
      await client.query(
        `UPDATE workers
         SET current_job = NULL, status = 'idle', last_seen = $1
         WHERE id = $2 AND current_job = $3`,
        [now, job.worker_id, jobId]
      );
    }

    // 5. Audit event
    await client.query(
      `INSERT INTO audit_events (id, action, actor, entity_type, entity_id, metadata, created_at)
       VALUES ($1, 'job:finished', $2, 'job', $3, $4, NOW())`,
      [
        crypto.randomUUID(),
        job.worker_id || "worker",
        jobId,
        JSON.stringify({ status: finalStatus, exitCode: finalExitCode }),
      ]
    );

    return {
      ok: true,
      job: formatJob(updatedRes.rows[0]),
      status: finalStatus,
    };
  });
}

/**
 * Safely cancel a job with transition validation
 */
async function cancelJob(jobId, actor = "administrator") {
  return await withTransaction(async (client) => {
    const currentRes = await client.query(
      "SELECT * FROM jobs WHERE id = $1 FOR UPDATE",
      [jobId]
    );

    if (currentRes.rows.length === 0) {
      return { ok: false, error: "Job not found" };
    }

    const job = currentRes.rows[0];
    if (["succeeded", "failed", "cancelled"].includes(job.status)) {
      return {
        ok: false,
        error: `Cannot cancel job with status: ${job.status}`,
      };
    }

    const now = new Date().toISOString();

    const updateRes = await client.query(
      `UPDATE jobs
       SET status = 'cancelled', finished_at = $1, error = 'Cancelled by administrator'
       WHERE id = $2
       RETURNING *`,
      [now, jobId]
    );

    // Insert log line
    await client.query(
      `INSERT INTO logs (job_id, attempt_number, seq, at, stream, line)
       VALUES ($1, $2, 999999, $3, 'stderr', 'Job was cancelled by administrator.')`,
      [jobId, (job.retry_count || 0) + 1, now]
    );

    // Free worker if running
    if (job.worker_id) {
      await client.query(
        "UPDATE workers SET current_job = NULL, status = 'idle', last_seen = $1 WHERE id = $2",
        [now, job.worker_id]
      );
    }

    // Audit event
    await client.query(
      `INSERT INTO audit_events (id, action, actor, entity_type, entity_id, metadata, created_at)
       VALUES ($1, 'job:cancelled', $2, 'job', $3, '{}'::jsonb, NOW())`,
      [crypto.randomUUID(), actor, jobId]
    );

    return {
      ok: true,
      job: formatJob(updateRes.rows[0]),
    };
  });
}

/**
 * Cancel all active jobs (queued, running, claimed)
 */
async function cancelAllJobs(actor = "administrator") {
  return await withTransaction(async (client) => {
    const activeRes = await client.query(
      "SELECT id, worker_id, retry_count FROM jobs WHERE status IN ('queued', 'running', 'claimed') FOR UPDATE"
    );

    const now = new Date().toISOString();
    const cancelledIds = [];

    for (const j of activeRes.rows) {
      await client.query(
        `UPDATE jobs
         SET status = 'cancelled', finished_at = $1, error = 'Cancelled by administrator'
         WHERE id = $2`,
        [now, j.id]
      );

      await client.query(
        `INSERT INTO logs (job_id, attempt_number, seq, at, stream, line)
         VALUES ($1, $2, 999999, $3, 'stderr', 'Job was cancelled by administrator.')`,
        [j.id, (j.retry_count || 0) + 1, now]
      );

      cancelledIds.push(j.id);
    }

    await client.query("UPDATE workers SET current_job = NULL, status = 'idle'");

    await client.query(
      `INSERT INTO audit_events (id, action, actor, entity_type, entity_id, metadata, created_at)
       VALUES ($1, 'job:cancel_all', $2, 'system', NULL, $3, NOW())`,
      [
        crypto.randomUUID(),
        actor,
        JSON.stringify({ cancelledCount: cancelledIds.length }),
      ]
    );

    return { ok: true, cancelledCount: cancelledIds.length, cancelledIds };
  });
}

/**
 * Delete a job and all its related records (attempts, logs, artifacts)
 */
async function deleteJob(jobId, actor = "administrator") {
  return await withTransaction(async (client) => {
    const checkRes = await client.query("SELECT * FROM jobs WHERE id = $1 FOR UPDATE", [jobId]);
    if (checkRes.rows.length === 0) {
      return { ok: false, error: "Job not found" };
    }

    const job = checkRes.rows[0];

    // Free worker if this worker was assigned
    if (job.worker_id) {
      await client.query(
        "UPDATE workers SET current_job = NULL, status = 'idle' WHERE id = $1 AND current_job = $2",
        [job.worker_id, jobId]
      );
    }

    // ON DELETE CASCADE takes care of logs, artifacts, job_attempts
    await client.query("DELETE FROM jobs WHERE id = $1", [jobId]);

    await client.query(
      `INSERT INTO audit_events (id, action, actor, entity_type, entity_id, metadata, created_at)
       VALUES ($1, 'job:deleted', $2, 'job', $3, '{}'::jsonb, NOW())`,
      [crypto.randomUUID(), actor, jobId]
    );

    return { ok: true, id: jobId };
  });
}

/**
 * Clear all jobs, logs, and artifacts from database
 */
async function clearAllJobs(actor = "administrator") {
  return await withTransaction(async (client) => {
    await client.query("DELETE FROM logs");
    await client.query("DELETE FROM artifacts");
    await client.query("DELETE FROM job_attempts");
    await client.query("DELETE FROM jobs");
    await client.query("UPDATE workers SET current_job = NULL, status = 'idle'");

    await client.query(
      `INSERT INTO audit_events (id, action, actor, entity_type, entity_id, metadata, created_at)
       VALUES ($1, 'system:clear_all', $2, 'system', NULL, '{}'::jsonb, NOW())`,
      [crypto.randomUUID(), actor]
    );

    return { ok: true };
  });
}

/**
 * Detect and recover stale jobs where the assigned worker crashed or disconnected
 */
async function recoverStaleJobs(staleSeconds = 90) {
  const cutoff = new Date(Date.now() - staleSeconds * 1000).toISOString();

  return await withTransaction(async (client) => {
    // Find running jobs whose assigned worker hasn't been seen since cutoff
    const staleRes = await client.query(
      `SELECT j.*, w.last_seen as worker_last_seen
       FROM jobs j
       JOIN workers w ON j.worker_id = w.id
       WHERE j.status = 'running' AND w.last_seen < $1
       FOR UPDATE OF j`,
      [cutoff]
    );

    const recovered = [];

    for (const job of staleRes.rows) {
      const now = new Date().toISOString();
      const retryCount = (job.retry_count || 0) + 1;
      const maxRetries = job.max_retries || 2;

      if (retryCount <= maxRetries) {
        // Re-queue job for bounded retry
        await client.query(
          `UPDATE jobs
           SET status = 'queued', worker_id = NULL, retry_count = $1, queued_at = $2
           WHERE id = $3`,
          [retryCount, now, job.id]
        );

        await client.query(
          `INSERT INTO logs (job_id, attempt_number, seq, at, stream, line)
           VALUES ($1, $2, 0, $3, 'system', $4)`,
          [
            job.id,
            retryCount,
            now,
            `[Infraxis Core] Worker heartbeat timeout (> ${staleSeconds}s). Re-queueing job (retry ${retryCount}/${maxRetries}).`,
          ]
        );

        recovered.push({ id: job.id, action: "requeued", retryCount });
      } else {
        // Exceeded max retries: mark as failed
        await client.query(
          `UPDATE jobs
           SET status = 'failed', finished_at = $1, exit_code = 1,
               error = 'Worker heartbeat timed out and retry limit exceeded'
           WHERE id = $2`,
          [now, job.id]
        );

        await client.query(
          `INSERT INTO logs (job_id, attempt_number, seq, at, stream, line)
           VALUES ($1, $2, 999999, $3, 'stderr', '[Infraxis Core] Build failed: Worker heartbeat timed out and retry limit exceeded.')`,
          [job.id, retryCount, now]
        );

        recovered.push({ id: job.id, action: "failed", retryCount });
      }

      // Mark stale worker offline
      await client.query(
        "UPDATE workers SET current_job = NULL, status = 'offline' WHERE id = $1",
        [job.worker_id]
      );
    }

    return recovered;
  });
}

/**
 * Reset and re-queue an existing failed job in-place without generating a new row.
 */
async function resetJobForRebuild(jobId) {
  return await withTransaction(async (client) => {
    const res = await client.query(
      "SELECT * FROM jobs WHERE id = $1 FOR UPDATE",
      [jobId]
    );
    if (res.rows.length === 0) return null;
    const job = res.rows[0];
    if (job.status === "cancelled") {
      throw new Error("Cancelled builds cannot be rebuilt");
    }

    const now = new Date().toISOString();
    const nextRetry = (Number(job.retry_count) || 0) + 1;

    // Reset job state in place to 'queued'
    const updateRes = await client.query(
      `UPDATE jobs
       SET status = 'queued',
           worker_id = NULL,
           started_at = NULL,
           finished_at = NULL,
           exit_code = NULL,
           error = NULL,
           queued_at = $1,
           retry_count = $2
       WHERE id = $3
       RETURNING *`,
      [now, nextRetry, jobId]
    );

    // Clean up previous failed logs and artifacts so the rebuilt run is clean
    await client.query("DELETE FROM logs WHERE job_id = $1", [jobId]);
    await client.query("DELETE FROM artifacts WHERE job_id = $1", [jobId]);

    // Record audit event
    await client.query(
      `INSERT INTO audit_events (id, action, actor, entity_type, entity_id, metadata, created_at)
       VALUES ($1, 'job:rebuilt', 'dashboard', 'job', $2, $3, NOW())`,
      [
        crypto.randomUUID(),
        jobId,
        JSON.stringify({ attempt: nextRetry, previous_status: job.status }),
      ]
    );

    return formatJob(updateRes.rows[0]);
  });
}

module.exports = {
  SUPPORTED_KINDS,
  REQUIRED_LABELS,
  formatJob,
  getJobById,
  listJobs,
  createJob,
  claimNextJob,
  finishJob,
  cancelJob,
  cancelAllJobs,
  deleteJob,
  clearAllJobs,
  recoverStaleJobs,
  resetJobForRebuild,
};
