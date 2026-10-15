"use strict";

const { query } = require("./pool");

async function upsertWorkerHeartbeat({
  id,
  labels = [],
  current_job = null,
  platform = "unknown",
  arch = "unknown",
  capabilities = {},
  system_info = {},
  version = "0.2.0",
}) {
  const now = new Date().toISOString();
  const cleanLabels = JSON.stringify([...new Set(labels)]);
  const cleanCaps = JSON.stringify(capabilities || {});
  const cleanSysInfo = JSON.stringify(system_info || {});

  await query(
    `INSERT INTO workers (
      id, platform, arch, capabilities, system_info, version, labels, status, last_seen, last_heartbeat, current_job, registered_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $9)
    ON CONFLICT (id) DO UPDATE SET
      labels = EXCLUDED.labels,
      capabilities = EXCLUDED.capabilities,
      system_info = EXCLUDED.system_info,
      last_seen = EXCLUDED.last_seen,
      last_heartbeat = EXCLUDED.last_heartbeat,
      current_job = EXCLUDED.current_job,
      status = CASE WHEN EXCLUDED.current_job IS NOT NULL THEN 'busy' ELSE 'idle' END,
      platform = COALESCE(EXCLUDED.platform, workers.platform),
      arch = COALESCE(EXCLUDED.arch, workers.arch),
      version = COALESCE(EXCLUDED.version, workers.version)`,
    [
      id,
      platform,
      arch,
      cleanCaps,
      cleanSysInfo,
      version,
      cleanLabels,
      current_job ? "busy" : "idle",
      now,
      current_job || null,
    ],
  );
}

async function listWorkers(cutoffMs = 30000) {
  const res = await query(
    "SELECT * FROM workers ORDER BY last_seen DESC LIMIT 50",
  );
  const cutoffTime = Date.now() - cutoffMs;

  return res.rows.map((w) => {
    let parsedLabels = [];
    try {
      parsedLabels =
        typeof w.labels === "string"
          ? JSON.parse(w.labels)
          : Array.isArray(w.labels)
            ? w.labels
            : [];
    } catch {}

    let parsedCaps = {};
    try {
      parsedCaps =
        typeof w.capabilities === "string"
          ? JSON.parse(w.capabilities)
          : w.capabilities || {};
    } catch {}

    let parsedSysInfo = {};
    try {
      parsedSysInfo =
        typeof w.system_info === "string"
          ? JSON.parse(w.system_info)
          : w.system_info || {};
    } catch {}

    const lastSeenTime = w.last_seen ? new Date(w.last_seen).getTime() : 0;
    const isOnline = lastSeenTime >= cutoffTime;

    return {
      id: w.id,
      platform: w.platform || "unknown",
      arch: w.arch || "unknown",
      capabilities: parsedCaps,
      system_info: parsedSysInfo,
      version: w.version || "0.2.0",
      labels: parsedLabels,
      last_seen: w.last_seen ? new Date(w.last_seen).toISOString() : null,
      current_job: w.current_job || null,
      status: isOnline ? (w.current_job ? "busy" : "idle") : "offline",
      online: isOnline,
    };
  });
}

async function getWorker(id) {
  const res = await query("SELECT * FROM workers WHERE id = $1", [id]);
  if (res.rows.length === 0) return null;
  const w = res.rows[0];
  let parsedLabels = [];
  try {
    parsedLabels =
      typeof w.labels === "string"
        ? JSON.parse(w.labels)
        : Array.isArray(w.labels)
          ? w.labels
          : [];
  } catch {}
  return {
    id: w.id,
    platform: w.platform || "unknown",
    version: w.version || "0.2.0",
    labels: parsedLabels,
    last_seen: w.last_seen ? new Date(w.last_seen).toISOString() : null,
    current_job: w.current_job || null,
    status: w.status,
  };
}

module.exports = {
  upsertWorkerHeartbeat,
  listWorkers,
  getWorker,
};
