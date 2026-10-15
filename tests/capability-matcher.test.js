"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { matchWorkerCapabilities } = require("../server/services/capability-matcher");

test("Capability Matcher: iOS jobs require macOS (darwin) and xcode / ios capability", () => {
  const linuxWorker = {
    id: "worker-linux",
    platform: "linux",
    arch: "x64",
    labels: ["node", "docker"],
    capabilities: { node: true, docker: true },
  };

  const macWorker = {
    id: "worker-mac",
    platform: "darwin",
    arch: "arm64",
    labels: ["ios", "xcode", "node"],
    capabilities: { ios: true, xcode: true, node: true },
  };

  const iosJob = {
    id: "job-ios-1",
    kind: "ios-release",
    metadata: {
      requiredCapabilities: ["ios", "xcode", "darwin"],
    },
  };

  // Linux worker should be rejected
  assert.strictEqual(
    matchWorkerCapabilities({ worker: linuxWorker, job: iosJob }),
    false,
    "Linux worker must NOT be matched to iOS job"
  );

  // Mac worker should be accepted
  assert.strictEqual(
    matchWorkerCapabilities({ worker: macWorker, job: iosJob }),
    true,
    "macOS worker with Xcode must be matched to iOS job"
  );
});

test("Capability Matcher: Docker container jobs require Docker runtime", () => {
  const workerWithoutDocker = {
    id: "worker-no-docker",
    platform: "linux",
    labels: ["node", "python"],
    capabilities: { node: true, python: true, docker: false },
  };

  const workerWithDocker = {
    id: "worker-with-docker",
    platform: "linux",
    labels: ["docker", "node"],
    capabilities: { docker: true, node: true },
  };

  const dockerJob = {
    id: "job-docker-1",
    kind: "release-build",
    metadata: {
      requiredCapabilities: ["docker"],
    },
  };

  assert.strictEqual(
    matchWorkerCapabilities({ worker: workerWithoutDocker, job: dockerJob }),
    false,
    "Worker without Docker must not claim Docker build"
  );

  assert.strictEqual(
    matchWorkerCapabilities({ worker: workerWithDocker, job: dockerJob }),
    true,
    "Worker with Docker should claim Docker build"
  );
});

test("Capability Matcher: Universal PR checks with basic requirements match any capable worker", () => {
  const worker = {
    id: "worker-general",
    platform: "linux",
    arch: "x64",
    labels: ["node", "git"],
    capabilities: { node: true, git: true },
  };

  const prJob = {
    id: "job-pr-1",
    kind: "pr-checks",
    metadata: {
      requiredCapabilities: ["node"],
    },
  };

  assert.strictEqual(
    matchWorkerCapabilities({ worker, job: prJob }),
    true,
    "General worker should match universal PR checks requiring node"
  );
});

test("Capability Matcher: Architecture matching (arm64 vs x64)", () => {
  const armWorker = {
    id: "worker-arm",
    platform: "darwin",
    arch: "arm64",
    labels: ["darwin", "arm64"],
  };

  const x64Job = {
    id: "job-x64",
    kind: "dev-build",
    metadata: {
      requiredCapabilities: ["x64"],
    },
  };

  assert.strictEqual(
    matchWorkerCapabilities({ worker: armWorker, job: x64Job }),
    false,
    "ARM worker must not claim x64-only job"
  );
});
