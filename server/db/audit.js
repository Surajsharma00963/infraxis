"use strict";

const crypto = require("crypto");
const { query } = require("./pool");

async function recordAuditEvent({
  id = crypto.randomUUID(),
  action,
  actor,
  entityType = null,
  entityId = null,
  metadata = {},
}) {
  try {
    await query(
      `INSERT INTO audit_events (id, action, actor, entity_type, entity_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        id,
        action,
        actor || "system",
        entityType,
        entityId,
        typeof metadata === "string" ? metadata : JSON.stringify(metadata || {}),
      ]
    );
  } catch (err) {
    console.error("[Audit Event Error]", err.message);
  }
}

async function listAuditEvents(limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const res = await query(
    "SELECT * FROM audit_events ORDER BY created_at DESC LIMIT $1",
    [safeLimit]
  );
  return res.rows.map((row) => ({
    id: row.id,
    action: row.action,
    actor: row.actor,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: row.metadata,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}

module.exports = {
  recordAuditEvent,
  listAuditEvents,
};
