"use strict";

const { runMigrations } = require("../server/db/migrator");
const { closePool } = require("../server/db/pool");

async function main() {
  console.log("Running Infraxis database migrations...");
  try {
    const result = await runMigrations();
    console.log("Migration summary:", result);
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await closePool().catch(() => {});
  }
}

main();
