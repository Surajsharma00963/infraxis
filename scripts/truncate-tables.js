"use strict";

const { pool } = require("../server/db/pool");
const fs = require("fs");
const path = require("path");

async function truncatePostgres() {
  console.log(
    "\n[Infraxis Core] Connecting to PostgreSQL to truncate tables...",
  );

  // 1. Get all application tables from public schema
  const res = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      AND table_name != 'schema_migrations'
    ORDER BY table_name;
  `);

  const tables = res.rows.map((r) => r.table_name);
  if (tables.length === 0) {
    console.log("No application tables found to truncate.");
    return;
  }

  // 2. Count rows before truncation
  const beforeCounts = {};
  for (const table of tables) {
    const countRes = await pool.query(
      `SELECT COUNT(*)::int as count FROM "${table}"`,
    );
    beforeCounts[table] = countRes.rows[0].count;
  }

  // 3. Truncate all tables CASCADE
  const truncateSql = `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE;`;
  await pool.query(truncateSql);

  // 4. Verify counts after truncation
  const afterCounts = {};
  for (const table of tables) {
    const countRes = await pool.query(
      `SELECT COUNT(*)::int as count FROM "${table}"`,
    );
    afterCounts[table] = countRes.rows[0].count;
  }

  console.log("\nPostgreSQL Tables Truncated:");
  console.log("------------------------------------------------------------");
  console.log(
    "Table".padEnd(28) + "Rows Before".padEnd(16) + "Rows After".padEnd(16),
  );
  console.log("------------------------------------------------------------");
  for (const table of tables) {
    console.log(
      table.padEnd(28) +
        String(beforeCounts[table]).padEnd(16) +
        String(afterCounts[table]).padEnd(16),
    );
  }
  console.log("------------------------------------------------------------");
}

function truncateSqliteIfPresent() {
  const sqlitePath = path.resolve(__dirname, "../data/ci.sqlite");
  if (!fs.existsSync(sqlitePath)) {
    return;
  }

  try {
    const Database = require("better-sqlite3");
    const db = new Database(sqlitePath);
    console.log("\n[Legacy SQLite] Truncating tables in data/ci.sqlite...");

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => r.name);

    for (const table of tables) {
      db.prepare(`DELETE FROM "${table}"`).run();
    }
    db.prepare("VACUUM").run();
    db.close();
    console.log(
      `[Legacy SQLite] Truncated ${tables.length} tables in data/ci.sqlite (${tables.join(", ")})`,
    );
  } catch (err) {
    console.warn(
      "[Legacy SQLite] Could not truncate SQLite (optional):",
      err.message,
    );
  }
}

function clearFilesystemFolders() {
  const dirs = [
    path.resolve(__dirname, "../artifacts"),
    path.resolve(__dirname, "../work"),
  ];
  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        try {
          if (fs.statSync(p).isDirectory()) {
            fs.rmSync(p, { recursive: true, force: true });
          } else {
            fs.unlinkSync(p);
          }
        } catch {}
      }
      console.log(`[Filesystem] Cleared contents of: ${path.basename(dir)}/`);
    }
  }
}

async function main() {
  try {
    await truncatePostgres();
    truncateSqliteIfPresent();
    clearFilesystemFolders();
    console.log("\nAll tables, work folders, and artifacts have been truncated successfully!\n");
  } catch (err) {
    console.error("\n[Error Truncating Tables]:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
