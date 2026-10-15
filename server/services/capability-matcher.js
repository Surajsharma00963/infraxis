"use strict";

/**
 * Matches job capability requirements against worker capabilities.
 * Supports OS/architecture constraints (darwin/linux, arm64/x64),
 * toolchain labels (node, python, go, rust, java, docker, flutter, android, ios),
 * and legacy label arrays.
 */

function matchWorkerCapabilities({ worker, job }) {
  if (!worker || !job) return false;

  const workerLabels = new Set(
    Array.isArray(worker.labels) ? worker.labels.map((l) => String(l).toLowerCase()) : []
  );

  const workerCaps = worker.capabilities && typeof worker.capabilities === "object"
    ? worker.capabilities
    : {};

  // Extract worker capability keys (e.g. { node: true, python: true, docker: true })
  for (const [k, v] of Object.entries(workerCaps)) {
    if (v) workerLabels.add(k.toLowerCase());
  }

  // Add worker platform and architecture
  if (worker.platform) workerLabels.add(worker.platform.toLowerCase());
  if (worker.arch) workerLabels.add(worker.arch.toLowerCase());

  // Determine job required capabilities:
  // 1. From job.metadata.requiredCapabilities or job.metadata.pipeline.requiredCapabilities
  let jobReqs = [];
  if (Array.isArray(job.metadata?.requiredCapabilities)) {
    jobReqs = job.metadata.requiredCapabilities;
  } else if (Array.isArray(job.metadata?.pipeline?.requiredCapabilities)) {
    jobReqs = job.metadata.pipeline.requiredCapabilities;
  } else {
    // Legacy kind mapping
    const legacyReqs = {
      "pr-checks": [], // Universal pr-checks can run on any worker unless specific caps in metadata!
      "android-debug": ["android"],
      "android-release": ["android"],
      "ios-simulator": ["ios"],
      "ios-release": ["ios"],
      "dev-build": [],
      "release-build": [],
      "custom-pipeline": [],
    };
    jobReqs = legacyReqs[job.kind] || [];
  }

  // If iOS is required, ensure worker is on macOS (darwin) or has ios label
  if (jobReqs.some((r) => ["ios", "xcode"].includes(r.toLowerCase()))) {
    const isDarwin = worker.platform === "darwin" || workerLabels.has("darwin");
    const hasIosLabel = workerLabels.has("ios") || workerLabels.has("xcode");
    if (!isDarwin && !hasIosLabel) {
      return false;
    }
  }

  // Check every required capability
  for (const req of jobReqs) {
    const r = req.toLowerCase();
    // Allow general fallback if capability is basic (e.g. node) and worker has standard node runtime
    if (!workerLabels.has(r)) {
      return false;
    }
  }

  return true;
}

module.exports = {
  matchWorkerCapabilities,
};
