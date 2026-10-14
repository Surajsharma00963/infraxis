"use strict";

process.env.CI_AUTO_START_WORKER = "false";

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const http = require("http");
const { app, stopManagedWorker, redis, redisSub } = require("../server/index");
const db = require("../server/db");

let serverInstance;
let serverPort;

function startTestServer() {
  return new Promise((resolve) => {
    serverInstance = app.listen(0, "127.0.0.1", () => {
      serverPort = serverInstance.address().port;
      resolve();
    });
  });
}

function stopTestServer() {
  stopManagedWorker();
  if (redis) {
    try { redis.disconnect(); } catch {}
  }
  if (redisSub) {
    try { redisSub.disconnect(); } catch {}
  }
  return new Promise((resolve) => {
    if (serverInstance) serverInstance.close(resolve);
    else resolve();
  });
}

async function request(path, options = {}) {
  const url = `http://127.0.0.1:${serverPort}${path}`;
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: response.status, body: json || text };
}

test("Webhooks Suite Setup", async () => {
  await startTestServer();
});

test("GitHub Webhook: Signature verification and push event", async () => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET || "testsecret12345678901234567890";
  process.env.GITHUB_WEBHOOK_SECRET = secret;

  const payload = JSON.stringify({
    ref: "refs/heads/main",
    after: "0123456789abcdef0123456789abcdef01234567",
    repository: {
      full_name: "infraxis/demo-app",
      clone_url: "https://github.com/infraxis/demo-app.git",
    },
  });

  const validSignature =
    "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");

  // 1. Invalid signature should be rejected with 401
  const invalidRes = await request("/webhooks/github", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "push",
      "X-Hub-Signature-256": "sha256=badsignature",
    },
    body: payload,
  });
  assert.strictEqual(invalidRes.status, 401);

  // 2. Valid signature should be accepted with 202
  const deliveryId = crypto.randomUUID();
  const validRes = await request("/webhooks/github", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "push",
      "X-Hub-Signature-256": validSignature,
      "X-GitHub-Delivery": deliveryId,
    },
    body: payload,
  });

  assert.strictEqual(validRes.status, 202);
  assert.strictEqual(validRes.body.queued, true);
  const createdJobId = validRes.body.id;

  // 3. Duplicate delivery with same X-GitHub-Delivery should NOT enqueue a duplicate job
  const dupRes = await request("/webhooks/github", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "push",
      "X-Hub-Signature-256": validSignature,
      "X-GitHub-Delivery": deliveryId,
    },
    body: payload,
  });

  assert.strictEqual(dupRes.status, 200);
  assert.strictEqual(dupRes.body.duplicate, true);
  assert.strictEqual(dupRes.body.id, createdJobId);

  // Cleanup
  await db.jobs.deleteJob(createdJobId, "test-suite");
});

test("Bitbucket Webhook: Token verification and duplicate prevention", async () => {
  const token = process.env.BITBUCKET_WEBHOOK_TOKEN;
  const payload = JSON.stringify({
    eventKey: "repo:push",
    repository: {
      full_name: "infraxis/mobile-app",
      links: {
        clone: [{ name: "https", href: "https://bitbucket.org/infraxis/mobile-app.git" }],
      },
    },
    push: {
      changes: [
        {
          new: {
            name: "release/dev",
            target: { hash: "9876543210fedcba9876543210fedcba98765432" },
          },
        },
      ],
    },
  });

  // 1. Invalid token should be rejected with 401
  const invalidRes = await request("/webhooks/bitbucket", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Event-Key": "repo:push",
      "X-CI-Webhook-Token": "invalid-token",
    },
    body: payload,
  });
  assert.strictEqual(invalidRes.status, 401);

  // 2. Valid token should be accepted with 202
  const hookUuid = crypto.randomUUID();
  const validRes = await request("/webhooks/bitbucket", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Event-Key": "repo:push",
      "X-CI-Webhook-Token": token,
      "X-Hook-UUID": hookUuid,
    },
    body: payload,
  });

  assert.strictEqual(validRes.status, 202);
  assert.strictEqual(validRes.body.queued, true);
  const createdJobId = validRes.body.id;

  // 3. Duplicate delivery with same X-Hook-UUID should be ignored
  const dupRes = await request("/webhooks/bitbucket", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Event-Key": "repo:push",
      "X-CI-Webhook-Token": token,
      "X-Hook-UUID": hookUuid,
    },
    body: payload,
  });

  assert.strictEqual(dupRes.status, 200);
  assert.strictEqual(dupRes.body.duplicate, true);
  assert.strictEqual(dupRes.body.id, createdJobId);

  // Cleanup
  await db.jobs.deleteJob(createdJobId, "test-suite");
});

test("Webhooks Suite Teardown", async () => {
  await stopTestServer();
  await db.closePool().catch(() => {});
});
