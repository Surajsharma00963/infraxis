"use strict";

const test = require("node:test");
const assert = require("node:assert");
const db = require("../server/db");

test("PostgreSQL connection and health check", async () => {
  const health = await db.checkHealth();
  assert.strictEqual(health.healthy, true, "Database should be healthy");
  assert.ok(health.database, "Database name should be present");
});

test("Database migrations applied and schema verified", async () => {
  const migrations = await db.getAppliedMigrations();
  assert.ok(migrations.length >= 1, "At least migration 001 should be applied");
  assert.strictEqual(migrations[0].version, 1);

  // Verify all required tables exist
  const tablesRes = await db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const tableNames = new Set(tablesRes.rows.map((r) => r.table_name));

  const expectedTables = [
    "schema_migrations",
    "repositories",
    "workers",
    "jobs",
    "job_attempts",
    "logs",
    "artifacts",
    "audit_events",
    "users",
    "user_tokens",
    "otps",
    "pending_registrations",
  ];

  for (const table of expectedTables) {
    assert.ok(tableNames.has(table), `Table ${table} must exist in PostgreSQL`);
  }
});

test.after(async () => {
  await db.closePool().catch(() => {});
});
