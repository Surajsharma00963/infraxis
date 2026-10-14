"use strict";

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const db = require("../server/db");

async function cleanTestJobs() {
  await db.query(
    "DELETE FROM jobs WHERE id LIKE 'test-%' OR id LIKE 'concurrent-%' OR id LIKE 'stale-%' OR id LIKE 'cancel-%'"
  );
  await db.query(
    "DELETE FROM workers WHERE id LIKE 'test-%' OR id LIKE 'worker-conc-%' OR id LIKE 'worker-cancel-%' OR id LIKE 'crashed-worker-%'"
  );
}

test.before(async () => {
  await cleanTestJobs();
});

test("Job lifecycle: create, claim, finish", async () => {
  await cleanTestJobs();
  const jobId = "test-job-" + crypto.randomUUID();
  const workerId = "test-worker-" + crypto.randomUUID();

  // 1. Create job
  const { job, isDuplicate } = await db.jobs.createJob({
    id: jobId,
    repo: "test/app",
    cloneUrl: "https://github.com/test/app.git",
    commitHash: "1234567890abcdef",
    branch: "main",
    kind: "android-debug",
    priority: 999,
    requestedBy: "test-suite",
  });

  assert.strictEqual(isDuplicate, false);
  assert.strictEqual(job.id, jobId);
  assert.strictEqual(job.status, "queued");

  // Register worker
  await db.workers.upsertWorkerHeartbeat({
    id: workerId,
    labels: ["android"],
    platform: "darwin",
    version: "0.2.0",
  });

  // 2. Claim job atomically
  const claimed = await db.jobs.claimNextJob({
    workerId,
    labels: ["android"],
  });

  assert.ok(claimed, "Worker should claim a job");
  assert.strictEqual(claimed.id, jobId);
  assert.strictEqual(claimed.status, "running");
  assert.strictEqual(claimed.worker_id, workerId);

  // 3. Finish job successfully
  const finishRes = await db.jobs.finishJob({
    jobId,
    workerId,
    exitCode: 0,
  });

  assert.strictEqual(finishRes.ok, true);
  assert.strictEqual(finishRes.status, "succeeded");

  const finalJob = await db.jobs.getJobById(jobId);
  assert.strictEqual(finalJob.status, "succeeded");
  assert.strictEqual(finalJob.exit_code, 0);

  // Cleanup
  await db.jobs.deleteJob(jobId, "test-suite");
});

test("Atomic concurrent job claiming with SELECT FOR UPDATE SKIP LOCKED", async () => {
  const jobIds = [
    "concurrent-job-1-" + crypto.randomUUID(),
    "concurrent-job-2-" + crypto.randomUUID(),
    "concurrent-job-3-" + crypto.randomUUID(),
  ];

  for (const id of jobIds) {
    await db.jobs.createJob({
      id,
      repo: "org/repo",
      cloneUrl: "https://github.com/org/repo.git",
      commitHash: "abcdef1234567890",
      branch: "release/dev",
      kind: "android-release",
      requestedBy: "test-suite",
    });
  }

  const worker1 = "worker-conc-1-" + crypto.randomUUID();
  const worker2 = "worker-conc-2-" + crypto.randomUUID();
  const worker3 = "worker-conc-3-" + crypto.randomUUID();

  // Register workers
  for (const w of [worker1, worker2, worker3]) {
    await db.workers.upsertWorkerHeartbeat({
      id: w,
      labels: ["android"],
      platform: "linux",
      version: "0.2.0",
    });
  }

  // Claim concurrently
  const [claim1, claim2, claim3] = await Promise.all([
    db.jobs.claimNextJob({ workerId: worker1, labels: ["android"] }),
    db.jobs.claimNextJob({ workerId: worker2, labels: ["android"] }),
    db.jobs.claimNextJob({ workerId: worker3, labels: ["android"] }),
  ]);

  const claimedIds = [claim1?.id, claim2?.id, claim3?.id].filter(Boolean);
  assert.strictEqual(claimedIds.length, 3, "All three jobs should be claimed");

  // Every claimed job MUST be unique
  const uniqueClaimed = new Set(claimedIds);
  assert.strictEqual(uniqueClaimed.size, 3, "No two workers should ever claim the same job");

  // Cleanup
  for (const id of jobIds) {
    await db.jobs.deleteJob(id, "test-suite");
  }
});

test("Job cancellation and status transition validation", async () => {
  const jobId = "cancel-job-" + crypto.randomUUID();
  const workerId = "worker-cancel-" + crypto.randomUUID();

  await db.jobs.createJob({
    id: jobId,
    repo: "org/repo",
    cloneUrl: "https://github.com/org/repo.git",
    commitHash: "abcdef1234567890",
    branch: "main",
    kind: "android-debug",
    requestedBy: "test-suite",
  });

  // Cancel while queued
  const cancelRes = await db.jobs.cancelJob(jobId, "test-admin");
  assert.strictEqual(cancelRes.ok, true);
  assert.strictEqual(cancelRes.job.status, "cancelled");

  // Attempting to claim cancelled job should fail
  const claimRes = await db.jobs.claimNextJob({
    workerId,
    labels: ["android"],
  });
  if (claimRes) {
    assert.notStrictEqual(claimRes.id, jobId, "Cancelled job cannot be claimed");
  }

  // Attempting to finish a cancelled job must fail (status transition validation)
  const finishRes = await db.jobs.finishJob({
    jobId,
    workerId,
    exitCode: 0,
  });
  assert.strictEqual(finishRes.ok, false);
  assert.match(finishRes.error, /Cannot finish job/);

  // Cleanup
  await db.jobs.deleteJob(jobId, "test-suite");
});

test("Stale job recovery when worker crashes", async () => {
  const jobId = "stale-job-" + crypto.randomUUID();
  const workerId = "crashed-worker-" + crypto.randomUUID();

  // Create and claim job
  await db.jobs.createJob({
    id: jobId,
    repo: "org/repo",
    cloneUrl: "https://github.com/org/repo.git",
    commitHash: "abcdef1234567890",
    branch: "main",
    kind: "android-debug",
    requestedBy: "test-suite",
    maxRetries: 2,
  });

  await db.workers.upsertWorkerHeartbeat({
    id: workerId,
    labels: ["android"],
    platform: "darwin",
    version: "0.2.0",
  });

  await db.jobs.claimNextJob({ workerId, labels: ["android"] });

  // Manually age the worker heartbeat to simulate worker crash (> 90s ago)
  const past = new Date(Date.now() - 120000).toISOString();
  await db.query("UPDATE workers SET last_seen = $1 WHERE id = $2", [past, workerId]);

  // Run stale recovery
  const recovered = await db.jobs.recoverStaleJobs(90);
  const found = recovered.find((r) => r.id === jobId);
  assert.ok(found, "Stale job should be detected");
  assert.strictEqual(found.action, "requeued");
  assert.strictEqual(found.retryCount, 1);

  // Job should now be queued again with retry_count = 1
  const requeuedJob = await db.jobs.getJobById(jobId);
  assert.strictEqual(requeuedJob.status, "queued");
  assert.strictEqual(requeuedJob.worker_id, null);
  assert.strictEqual(requeuedJob.retry_count, 1);

  // Cleanup
  await db.jobs.deleteJob(jobId, "test-suite");
});

test.after(async () => {
  await db.closePool().catch(() => {});
});
