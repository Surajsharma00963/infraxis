"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { query, withTransaction, closePool } = require("../server/db/pool");
const { runMigrations } = require("../server/db/migrator");

const DATA_DIR = path.resolve(process.env.CI_DATA_DIR || "./data");
const SQLITE_PATH = path.join(DATA_DIR, "ci.sqlite");

async function migrate() {
  console.log("=== Infraxis SQLite to PostgreSQL Migration ===");
  console.log(`Checking SQLite database at: ${SQLITE_PATH}`);

  if (!fs.existsSync(SQLITE_PATH)) {
    console.log("No SQLite database found at path. Nothing to migrate.");
    return;
  }

  // Ensure PostgreSQL schema is up-to-date
  console.log("Ensuring PostgreSQL schema migrations are applied...");
  await runMigrations();

  // Open SQLite database in readonly mode to guarantee safety
  let sqliteDb;
  try {
    sqliteDb = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
    console.log("Connected to SQLite in READ-ONLY mode.");
  } catch (err) {
    console.error("Failed to open SQLite database:", err.message);
    process.exit(1);
  }

  const stats = {
    users: { copied: 0, skipped: 0, failed: 0 },
    user_tokens: { copied: 0, skipped: 0, failed: 0 },
    otps: { copied: 0, skipped: 0, failed: 0 },
    pending_registrations: { copied: 0, skipped: 0, failed: 0 },
    workers: { copied: 0, skipped: 0, failed: 0 },
    jobs: { copied: 0, skipped: 0, failed: 0 },
    job_attempts: { copied: 0, skipped: 0, failed: 0 },
    logs: { copied: 0, skipped: 0, failed: 0 },
    artifacts: { copied: 0, skipped: 0, failed: 0 },
  };

  const tableExists = (name) => {
    const row = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name);
    return !!row;
  };

  // 1. Migrate Users
  if (tableExists("users")) {
    const rows = sqliteDb.prepare("SELECT * FROM users").all();
    console.log(`Found ${rows.length} users in SQLite.`);
    for (const r of rows) {
      try {
        const res = await query(
          `INSERT INTO users (
            id, username, email, password_hash, salt, full_name, phone,
            organization, role_title, role, is_verified, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (id) DO NOTHING
          RETURNING id`,
          [
            r.id,
            r.username,
            r.email,
            r.password_hash,
            r.salt,
            r.full_name || null,
            r.phone || null,
            r.organization || null,
            r.role_title || null,
            r.role || "admin",
            r.is_verified ?? 1,
            r.created_at || new Date().toISOString(),
          ]
        );
        if (res.rows.length > 0) stats.users.copied++;
        else stats.users.skipped++;
      } catch (err) {
        console.error(`Error migrating user ${r.id}:`, err.message);
        stats.users.failed++;
      }
    }
  }

  // 2. Migrate User Tokens
  if (tableExists("user_tokens")) {
    const rows = sqliteDb.prepare("SELECT * FROM user_tokens").all();
    console.log(`Found ${rows.length} user tokens in SQLite.`);
    for (const r of rows) {
      try {
        const res = await query(
          `INSERT INTO user_tokens (token, user_id, name, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (token) DO NOTHING
           RETURNING token`,
          [r.token, r.user_id, r.name || "Token", r.created_at || new Date().toISOString()]
        );
        if (res.rows.length > 0) stats.user_tokens.copied++;
        else stats.user_tokens.skipped++;
      } catch (err) {
        console.error(`Error migrating user token:`, err.message);
        stats.user_tokens.failed++;
      }
    }
  }

  // 3. Migrate OTPs
  if (tableExists("otps")) {
    const rows = sqliteDb.prepare("SELECT * FROM otps").all();
    console.log(`Found ${rows.length} OTPs in SQLite.`);
    for (const r of rows) {
      try {
        const res = await query(
          `INSERT INTO otps (id, email, otp_code, purpose, expires_at, used, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [
            r.id,
            r.email,
            r.otp_code,
            r.purpose,
            r.expires_at,
            r.used ?? 0,
            r.created_at || new Date().toISOString(),
          ]
        );
        if (res.rows.length > 0) stats.otps.copied++;
        else stats.otps.skipped++;
      } catch (err) {
        console.error(`Error migrating OTP ${r.id}:`, err.message);
        stats.otps.failed++;
      }
    }
  }

  // 4. Migrate Pending Registrations
  if (tableExists("pending_registrations")) {
    const rows = sqliteDb.prepare("SELECT * FROM pending_registrations").all();
    console.log(`Found ${rows.length} pending registrations in SQLite.`);
    for (const r of rows) {
      try {
        const res = await query(
          `INSERT INTO pending_registrations (
            id, email, username, full_name, phone, organization, role_title,
            password_hash, salt, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (id) DO NOTHING
          RETURNING id`,
          [
            r.id,
            r.email,
            r.username,
            r.full_name || null,
            r.phone || null,
            r.organization || null,
            r.role_title || null,
            r.password_hash,
            r.salt,
            r.created_at || new Date().toISOString(),
          ]
        );
        if (res.rows.length > 0) stats.pending_registrations.copied++;
        else stats.pending_registrations.skipped++;
      } catch (err) {
        console.error(`Error migrating pending registration ${r.id}:`, err.message);
        stats.pending_registrations.failed++;
      }
    }
  }

  // 5. Migrate Workers
  if (tableExists("workers")) {
    const rows = sqliteDb.prepare("SELECT * FROM workers").all();
    console.log(`Found ${rows.length} workers in SQLite.`);
    for (const r of rows) {
      try {
        let labels = "[]";
        try {
          labels = typeof r.labels === "string" ? r.labels : JSON.stringify(r.labels || []);
        } catch {}

        const res = await query(
          `INSERT INTO workers (
            id, platform, version, labels, status, last_seen, last_heartbeat, current_job, registered_at
          ) VALUES ($1, 'unknown', '0.2.0', $2, 'idle', $3, $3, $4, $3)
          ON CONFLICT (id) DO UPDATE SET
            labels = EXCLUDED.labels,
            last_seen = EXCLUDED.last_seen
          RETURNING id`,
          [r.id, labels, r.last_seen || new Date().toISOString(), r.current_job || null]
        );
        if (res.rows.length > 0) stats.workers.copied++;
        else stats.workers.skipped++;
      } catch (err) {
        console.error(`Error migrating worker ${r.id}:`, err.message);
        stats.workers.failed++;
      }
    }
  }

  // 6. Migrate Jobs
  if (tableExists("jobs")) {
    const rows = sqliteDb.prepare("SELECT * FROM jobs").all();
    console.log(`Found ${rows.length} jobs in SQLite.`);
    for (const r of rows) {
      try {
        const res = await query(
          `INSERT INTO jobs (
            id, repo, clone_url, commit_hash, branch, kind, package_manager,
            priority, status, requested_by, worker_id, created_at, queued_at,
            started_at, finished_at, exit_code, error
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 10, $8, $9, $10, $11, $11, $12, $13, $14, $15)
          ON CONFLICT (id) DO NOTHING
          RETURNING id`,
          [
            r.id,
            r.repo,
            r.clone_url,
            r.commit_hash,
            r.branch,
            r.kind,
            r.package_manager || "auto",
            r.status,
            r.requested_by,
            r.worker_id || null,
            r.created_at,
            r.started_at || null,
            r.finished_at || null,
            r.exit_code != null ? Number(r.exit_code) : null,
            r.error || null,
          ]
        );

        if (res.rows.length > 0) {
          stats.jobs.copied++;

          // Create matching job_attempt
          await query(
            `INSERT INTO job_attempts (
              id, job_id, attempt_number, worker_id, started_at, finished_at,
              exit_code, failure_reason, status, created_at
            ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (job_id, attempt_number) DO NOTHING`,
            [
              r.id + "-attempt-1",
              r.id,
              r.worker_id || null,
              r.started_at || r.created_at,
              r.finished_at || null,
              r.exit_code != null ? Number(r.exit_code) : null,
              r.error || null,
              r.status,
              r.created_at,
            ]
          );
          stats.job_attempts.copied++;
        } else {
          stats.jobs.skipped++;
        }
      } catch (err) {
        console.error(`Error migrating job ${r.id}:`, err.message);
        stats.jobs.failed++;
      }
    }
  }

  // 7. Migrate Logs (batched for high performance)
  if (tableExists("logs")) {
    const rows = sqliteDb.prepare("SELECT * FROM logs ORDER BY id ASC").all();
    console.log(`Found ${rows.length} log lines in SQLite.`);
    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = [];
      let pIdx = 1;
      for (const r of chunk) {
        placeholders.push(`($${pIdx}, $${pIdx + 1}, 1, $${pIdx}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4})`);
        values.push(r.id, r.job_id, r.at, r.stream || "stdout", r.line);
        pIdx += 5;
      }
      try {
        await query(
          `INSERT INTO logs (id, job_id, attempt_number, seq, at, stream, line)
           VALUES ${placeholders.join(", ")}
           ON CONFLICT (id) DO NOTHING`,
          values
        );
        stats.logs.copied += chunk.length;
      } catch (err) {
        console.error(`Error migrating batch of logs at index ${i}:`, err.message);
        stats.logs.failed += chunk.length;
      }
    }
    // Update log sequence value if rows exist
    if (rows.length > 0) {
      await query("SELECT setval(pg_get_serial_sequence('logs', 'id'), COALESCE(MAX(id), 1)) FROM logs");
    }
  }

  // 8. Migrate Artifacts
  if (tableExists("artifacts")) {
    const rows = sqliteDb.prepare("SELECT * FROM artifacts").all();
    console.log(`Found ${rows.length} artifacts in SQLite.`);
    for (const r of rows) {
      try {
        const res = await query(
          `INSERT INTO artifacts (id, job_id, attempt_number, filename, content_type, path, size, created_at)
           VALUES ($1, $2, 1, $3, 'application/octet-stream', $4, $5, $6)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [r.id, r.job_id, r.filename, r.path, r.size, r.created_at]
        );
        if (res.rows.length > 0) stats.artifacts.copied++;
        else stats.artifacts.skipped++;
      } catch (err) {
        console.error(`Error migrating artifact ${r.id}:`, err.message);
        stats.artifacts.failed++;
      }
    }
  }

  sqliteDb.close();

  // Print Summary
  console.log("\n================ MIGRATION REPORT ================");
  console.table(stats);

  // Verification checks
  const verification = await query(`
    SELECT
      (SELECT COUNT(*) FROM users) as users_count,
      (SELECT COUNT(*) FROM user_tokens) as tokens_count,
      (SELECT COUNT(*) FROM otps) as otps_count,
      (SELECT COUNT(*) FROM workers) as workers_count,
      (SELECT COUNT(*) FROM jobs) as jobs_count,
      (SELECT COUNT(*) FROM logs) as logs_count,
      (SELECT COUNT(*) FROM artifacts) as artifacts_count
  `);

  console.log("\nPostgreSQL Final Record Counts:");
  console.log(verification.rows[0]);
  console.log("\nSQLite original database preserved at:", SQLITE_PATH);
  console.log("Migration completed successfully!");
}

migrate()
  .catch((err) => {
    console.error("Migration fatal error:", err);
    process.exit(1);
  })
  .finally(() => closePool());
