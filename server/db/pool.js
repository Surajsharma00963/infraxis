"use strict";

const { Pool } = require("pg");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.PGUSER || process.env.USER || "postgres"}:${process.env.PGPASSWORD || ""}@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "infraxis"}`;

const poolConfig = {
  connectionString: DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 50),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 20000),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
};

if (
  process.env.DATABASE_SSL === "true" ||
  process.env.DATABASE_SSL === "require"
) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

let isConnected = false;

pool.on("connect", () => {
  isConnected = true;
});

pool.on("error", (err) => {
  console.error("[PostgreSQL Pool Error]", err.message);
});

async function query(text, params, retries = 2) {
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (err) {
    const isTransient =
      err.message?.includes("Connection terminated") ||
      err.message?.includes("timeout") ||
      err.message?.includes("Connection closed") ||
      err.code === "ECONNRESET" ||
      err.code === "57P01";
    if (retries > 0 && isTransient) {
      console.warn(
        `[PostgreSQL Pool] Retrying query after connection drop: ${err.message}`,
      );
      await new Promise((r) => setTimeout(r, 250));
      return await query(text, params, retries - 1);
    }
    console.error(
      `[PostgreSQL Query Error] ${err.message} (Query: ${text.slice(0, 100)})`,
    );
    throw err;
  }
}

async function withTransaction(fn) {
  let client;
  try {
    client = await pool.connect();
  } catch (connectErr) {
    console.error("[PostgreSQL Pool Connect Error]", connectErr.message);
    throw connectErr;
  }

  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rbErr) {
      console.error("[PostgreSQL Rollback Error]", rbErr.message);
    }
    throw err;
  } finally {
    if (client) {
      client.release();
    }
  }
}

async function checkHealth() {
  try {
    const res = await pool.query(
      "SELECT NOW() as now, current_database() as db",
    );
    return {
      healthy: true,
      database: res.rows[0].db,
      timestamp: res.rows[0].now,
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };
  } catch (err) {
    return {
      healthy: false,
      error: err.message,
    };
  }
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  withTransaction,
  checkHealth,
  closePool,
  DATABASE_URL,
};
