"use strict";

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const db = require("../server/db");

test("Deterministic log ordering and sensitive data redaction", async () => {
  const jobId = "logs-test-" + crypto.randomUUID();

  await db.jobs.createJob({
    id: jobId,
    repo: "org/repo",
    cloneUrl: "https://github.com/org/repo.git",
    commitHash: "1234567890abcdef",
    branch: "main",
    kind: "android-debug",
    requestedBy: "test-suite",
  });

  const lines = [
    { line: "Starting build step 1", stream: "stdout" },
    { line: "Cloning repo from https://token:secret123456@github.com/org/repo.git", stream: "system" },
    { line: "Running tests", stream: "stdout" },
  ];

  const inserted = await db.logs.insertJobLogs({
    jobId,
    lines,
    attemptNumber: 1,
  });

  assert.strictEqual(inserted.length, 3);
  // Verify monotonic sequence numbering
  assert.strictEqual(inserted[0].seq, 1);
  assert.strictEqual(inserted[1].seq, 2);
  assert.strictEqual(inserted[2].seq, 3);

  // Verify redaction of embedded credentials in clone URL
  assert.ok(
    inserted[1].line.includes("https://***:***@github.com"),
    "Credentials in URL must be redacted"
  );

  // Retrieve logs
  const fetched = await db.logs.getJobLogs({ jobId, afterId: 0, limit: 10 });
  assert.strictEqual(fetched.length, 3);
  assert.strictEqual(fetched[0].seq, 1);
  assert.strictEqual(fetched[2].seq, 3);

  // Cleanup
  await db.jobs.deleteJob(jobId, "test-suite");
});

test("Artifact metadata creation and retrieval", async () => {
  const jobId = "artifact-test-" + crypto.randomUUID();
  const artifactId = "art-" + crypto.randomUUID();

  await db.jobs.createJob({
    id: jobId,
    repo: "org/repo",
    cloneUrl: "https://github.com/org/repo.git",
    commitHash: "1234567890abcdef",
    branch: "main",
    kind: "android-release",
    requestedBy: "test-suite",
  });

  const artifact = await db.artifacts.createArtifactMetadata({
    id: artifactId,
    jobId,
    attemptNumber: 1,
    filename: "app-release.apk",
    contentType: "application/vnd.android.package-archive",
    path: "/tmp/fake-path/app-release.apk",
    size: 25000000,
    checksum: "abcdef0123456789",
  });

  assert.strictEqual(artifact.id, artifactId);
  assert.strictEqual(artifact.filename, "app-release.apk");
  assert.strictEqual(artifact.size, 25000000);

  const list = await db.artifacts.listArtifactsByJobId(jobId);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, artifactId);

  // Cleanup
  await db.jobs.deleteJob(jobId, "test-suite");
});

test.after(async () => {
  await db.closePool().catch(() => {});
});
