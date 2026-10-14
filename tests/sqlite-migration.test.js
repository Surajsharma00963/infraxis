"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const db = require("../server/db");
const { execFileSync } = require("child_process");

test("SQLite data migration utility execution and safety", async () => {
  const sqlitePath = path.resolve(__dirname, "../data/ci.sqlite");
  assert.ok(fs.existsSync(sqlitePath), "SQLite database should exist in data/ci.sqlite");

  // Verify SQLite database has data, seed if empty
  let sqlite = new Database(sqlitePath);
  let userCount = sqlite.prepare("SELECT count(*) as c FROM users").get().c;
  let workerCount = sqlite.prepare("SELECT count(*) as c FROM workers").get().c;

  if (userCount === 0) {
    sqlite
      .prepare(
        "INSERT INTO users (id, username, email, password_hash, salt, full_name, role) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        "test-migrated-user",
        "migrated_admin",
        "migrated@infraxis.local",
        "hash",
        "salt",
        "Migrated Admin",
        "admin"
      );
    userCount = 1;
  }

  if (workerCount === 0) {
    sqlite
      .prepare(
        "INSERT INTO workers (id, labels, status, last_seen, last_heartbeat) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        "test-worker-1",
        JSON.stringify(["mac", "xcode"]),
        "idle",
        new Date().toISOString(),
        new Date().toISOString()
      );
    workerCount = 1;
  }
  sqlite.close();

  assert.ok(userCount > 0, "SQLite should have users");
  assert.ok(workerCount > 0, "SQLite should have workers");

  // Run the migration script
  const scriptPath = path.resolve(__dirname, "../scripts/migrate-sqlite-to-pg.js");
  const output = execFileSync("node", [scriptPath], {
    encoding: "utf8",
    timeout: 30000,
  });

  assert.ok(output.includes("Migration completed successfully!"));
  assert.ok(output.includes("SQLite original database preserved at"));

  // Verify PostgreSQL has the migrated users
  const pgUsersRes = await db.query("SELECT count(*) as c FROM users");
  assert.ok(Number(pgUsersRes.rows[0].c) >= userCount);

  // Verify PostgreSQL has the migrated workers
  const pgWorkersRes = await db.query("SELECT count(*) as c FROM workers");
  assert.ok(Number(pgWorkersRes.rows[0].c) >= workerCount);
});

test.after(async () => {
  await db.closePool().catch(() => {});
});
