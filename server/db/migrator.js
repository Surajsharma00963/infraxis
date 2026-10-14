"use strict";

const fs = require("fs");
const path = require("path");
const { query, withTransaction } = require("./pool");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function initMigrationTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations() {
  await initMigrationTable();
  const res = await query("SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC");
  return res.rows;
}

async function runMigrations() {
  await initMigrationTable();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const appliedRows = await getAppliedMigrations();
  const appliedVersions = new Set(appliedRows.map((r) => r.version));
  const appliedNow = [];

  for (const file of files) {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) continue;

    const version = parseInt(match[1], 10);
    const name = match[2];

    if (!appliedVersions.has(version)) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, "utf8");

      console.log(`[Database Migration] Applying migration ${file}...`);
      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, NOW()) ON CONFLICT (version) DO NOTHING",
          [version, name]
        );
      });
      appliedNow.push({ version, name, file });
      console.log(`[Database Migration] Migration ${file} applied successfully.`);
    }
  }

  return {
    totalMigrations: files.length,
    appliedNow,
    previouslyApplied: appliedRows.length,
  };
}

module.exports = {
  runMigrations,
  getAppliedMigrations,
};
