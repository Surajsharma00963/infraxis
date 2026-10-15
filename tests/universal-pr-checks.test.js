"use strict";

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const db = require("../server/db");
const { reportPRStatus } = require("../server/services/status-reporter");

async function cleanPRTestData() {
  await db.query("DELETE FROM pull_requests WHERE repo LIKE 'test-org/%'");
  await db.query("DELETE FROM jobs WHERE id LIKE 'upr-job-%'");
}

test.before(async () => {
  await cleanPRTestData();
});

test.after(async () => {
  await cleanPRTestData();
  await db.closePool().catch(() => {});
});

test("Universal PR Checks: Create and update pull request record in PostgreSQL", async () => {
  const repo = "test-org/infraxis-sample-app";
  const prNumber = 101;
  const commitHash = "abcdef0123456789abcdef0123456789abcdef01";
  const jobId = "upr-job-" + crypto.randomUUID();

  // 1. Create job
  const { job } = await db.jobs.createJob({
    id: jobId,
    repo,
    cloneUrl: "https://github.com/test-org/infraxis-sample-app.git",
    commitHash,
    branch: "feature/universal-cicd",
    kind: "pr-checks",
    requestedBy: "github-webhook",
    metadata: {
      prNumber,
      isPrCheck: true,
      sourceBranch: "feature/universal-cicd",
      targetBranch: "main",
    },
  });
  assert.strictEqual(job.id, jobId);

  // 2. Upsert PR as pending
  const pr = await db.pullRequests.upsertPullRequest({
    repo,
    provider: "github",
    prNumber,
    title: "Feature: Add Universal CI/CD support",
    sourceBranch: "feature/universal-cicd",
    targetBranch: "main",
    commitHash,
    status: "pending",
    latestJobId: jobId,
    checkResults: [
      { name: "lint", status: "pending" },
      { name: "unit-tests", status: "pending" },
      { name: "build", status: "pending" },
    ],
  });

  assert.ok(pr.id);
  assert.strictEqual(pr.repo, repo);
  assert.strictEqual(pr.pr_number, prNumber);
  assert.strictEqual(pr.status, "pending");
  assert.strictEqual(pr.latest_job_id, jobId);

  // 3. Retrieve PR
  const fetched = await db.pullRequests.getPullRequest({ repo, prNumber });
  assert.ok(fetched);
  assert.strictEqual(fetched.pr_number, prNumber);
  assert.strictEqual(fetched.commit_hash, commitHash);

  // 4. Update PR check results to success
  const updated = await db.pullRequests.updatePullRequestStatus({
    id: pr.id,
    status: "success",
    checkResults: [
      { name: "lint", status: "passed", duration_ms: 1200 },
      { name: "unit-tests", status: "passed", duration_ms: 3400 },
      { name: "build", status: "passed", duration_ms: 5600 },
    ],
  });

  assert.strictEqual(updated.status, "success");
  assert.strictEqual(updated.check_results.length, 3);
  assert.strictEqual(updated.check_results[0].status, "passed");
});

test("Universal PR Checks: Idempotent updates on new commit push (PR synchronization)", async () => {
  const repo = "test-org/sync-pr-repo";
  const prNumber = 102;
  const initialCommit = "1111111111111111111111111111111111111111";
  const newCommit = "2222222222222222222222222222222222222222";
  const job1Id = "upr-job-" + crypto.randomUUID();
  const job2Id = "upr-job-" + crypto.randomUUID();

  // Create jobs for foreign key integrity
  await db.jobs.createJob({
    id: job1Id,
    repo,
    cloneUrl: "https://github.com/test-org/sync-pr-repo.git",
    commitHash: initialCommit,
    branch: "fix/auth-bug",
    kind: "pr-checks",
    requestedBy: "test-suite",
  });
  await db.jobs.createJob({
    id: job2Id,
    repo,
    cloneUrl: "https://github.com/test-org/sync-pr-repo.git",
    commitHash: newCommit,
    branch: "fix/auth-bug",
    kind: "pr-checks",
    requestedBy: "test-suite",
  });

  // Initial PR open
  const pr1 = await db.pullRequests.upsertPullRequest({
    repo,
    provider: "github",
    prNumber,
    title: "PR Title",
    sourceBranch: "fix/auth-bug",
    targetBranch: "main",
    commitHash: initialCommit,
    status: "running",
    latestJobId: job1Id,
  });
  assert.strictEqual(pr1.commit_hash, initialCommit);

  // Synchronize new commit pushed to the PR
  const pr2 = await db.pullRequests.upsertPullRequest({
    repo,
    provider: "github",
    prNumber,
    title: "PR Title Updated",
    sourceBranch: "fix/auth-bug",
    targetBranch: "main",
    commitHash: newCommit,
    status: "pending",
    latestJobId: job2Id,
  });

  assert.strictEqual(pr2.id, pr1.id, "PR record ID should remain consistent across commit updates");
  assert.strictEqual(pr2.commit_hash, newCommit);
  assert.strictEqual(pr2.latest_job_id, job2Id);
  assert.strictEqual(pr2.status, "pending");
});

test("Universal PR Checks: Pipeline stage persistence and retrieval", async () => {
  const jobId = "upr-job-" + crypto.randomUUID();

  await db.jobs.createJob({
    id: jobId,
    repo: "test-org/stages-repo",
    cloneUrl: "https://github.com/test-org/stages-repo.git",
    commitHash: "9999999999999999999999999999999999999999",
    branch: "main",
    kind: "pr-checks",
    requestedBy: "test-suite",
  });

  // Save 3 stages
  await db.pipelineStages.saveStageResult({
    jobId,
    stageName: "checkout",
    category: "checkout",
    status: "passed",
    durationMs: 450,
  });

  await db.pipelineStages.saveStageResult({
    jobId,
    stageName: "lint-and-validate",
    category: "lint",
    status: "passed",
    durationMs: 1200,
  });

  await db.pipelineStages.saveStageResult({
    jobId,
    stageName: "run-tests",
    category: "test",
    status: "failed",
    durationMs: 3100,
    errorMessage: "Test suite failed: 2 assertion errors",
  });

  const stages = await db.pipelineStages.getJobStages(jobId);
  assert.strictEqual(stages.length, 3);
  assert.strictEqual(stages[0].stage_name, "checkout");
  assert.strictEqual(stages[0].status, "passed");
  assert.strictEqual(stages[2].stage_name, "run-tests");
  assert.strictEqual(stages[2].status, "failed");
  assert.ok(stages[2].error_message.includes("assertion errors"));
});

test("Universal PR Checks: Status Reporter for external git providers", async () => {
  // Test reporting when no token is configured (graceful fallback/dry-run)
  const result = await reportPRStatus({
    provider: "github",
    repo: "test-org/infraxis",
    commitHash: "1234567890abcdef1234567890abcdef12345678",
    state: "success",
    description: "Infraxis CI: All checks passed (3/3)",
    targetUrl: "https://ci.infraxis.internal/jobs/job-123",
  });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.localOnly, true);
});
