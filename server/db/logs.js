"use strict";

const { query, withTransaction } = require("./pool");

// Sensitive patterns to redact from logs
const SENSITIVE_PATTERNS = [
  /Bearer\s+([A-Fa-f0-9]{32,})/gi,
  /([A-Fa-f0-9]{64})/g,
  /token=([A-Fa-f0-9]{32,})/gi,
  /password=([^&\s]+)/gi,
  /secret=([^&\s]+)/gi,
];

function sanitizeLogLine(line) {
  if (typeof line !== "string") return "";
  let clean = line.slice(0, 4000).replace(/\u0000/g, "");
  // Remove embedded passwords in URLs if any
  clean = clean.replace(/https:\/\/[^:]+:[^@]+@/gi, "https://***:***@");
  return clean;
}

async function insertJobLogs({ jobId, lines = [], attemptNumber = 1 }) {
  if (!lines.length) return [];

  const validStreams = ["stdout", "stderr", "system"];
  const validItems = [];

  for (const item of lines) {
    if (!item || typeof item.line !== "string") continue;
    validItems.push({
      stream: validStreams.includes(item.stream) ? item.stream : "stdout",
      line: sanitizeLogLine(item.line),
    });
  }

  if (!validItems.length) return [];

  return await withTransaction(async (client) => {
    // 1. Get current maximum sequence number for this job
    const seqRes = await client.query(
      "SELECT COALESCE(MAX(seq), 0) as max_seq FROM logs WHERE job_id = $1",
      [jobId],
    );
    let currentSeq = Number(seqRes.rows[0]?.max_seq || 0);

    // 2. Perform high-performance batch insert in a single query
    const valueClauses = [];
    const params = [];
    const now = new Date().toISOString();

    for (let i = 0; i < validItems.length; i++) {
      currentSeq += 1;
      const offset = i * 6;
      valueClauses.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`,
      );
      params.push(
        jobId,
        attemptNumber,
        currentSeq,
        now,
        validItems[i].stream,
        validItems[i].line,
      );
    }

    const ins = await client.query(
      `INSERT INTO logs (job_id, attempt_number, seq, at, stream, line)
       VALUES ${valueClauses.join(", ")}
       RETURNING id, at, stream, line, seq`,
      params,
    );

    return ins.rows.map((r) => ({
      id: Number(r.id),
      seq: Number(r.seq),
      at: new Date(r.at).toISOString(),
      stream: r.stream,
      line: r.line,
    }));
  });
}

async function getJobLogs({ jobId, afterId = 0, limit = 1000 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 1000, 1), 5000);
  const safeAfter = Math.max(Number(afterId) || 0, 0);

  const res = await query(
    `SELECT id, at, stream, line, seq, attempt_number
     FROM logs
     WHERE job_id = $1 AND id > $2
     ORDER BY id ASC
     LIMIT $3`,
    [jobId, safeAfter, safeLimit],
  );

  return res.rows.map((r) => ({
    id: Number(r.id),
    at: r.at ? new Date(r.at).toISOString() : null,
    stream: r.stream,
    line: r.line,
    seq: Number(r.seq || 0),
    attemptNumber: Number(r.attempt_number || 1),
  }));
}

module.exports = {
  sanitizeLogLine,
  insertJobLogs,
  getJobLogs,
};
