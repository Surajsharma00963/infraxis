"use strict";

const express = require("express");
const http = require("http");
const helmet = require("helmet");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const child_process = require("child_process");
const { WebSocketServer } = require("ws");
const Redis = require("ioredis");

// Infraxis Core PostgreSQL Database Layer
const db = require("./db");

// Universal CI/CD Services
const { detectRepository } = require("./services/detector");
const {
  planPipeline,
  getRecommendedProfileAndTarget,
  detectBuildKind,
} = require("./services/pipeline");
const { loadRepoConfig } = require("./services/config-parser");
const { reportCommitStatus } = require("./services/status-reporter");
const integrationsRouter = require("./routes/integrations");

const app = express();
const server = http.createServer(app);
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
// Global unhandled error resilience
process.on("unhandledRejection", (reason) => {
  console.error("[Infraxis Server] Unhandled Promise Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Infraxis Server] Uncaught Exception:", err);
});

// Automatically catch unhandled rejections from all Express route handlers
const methodsToWrap = ["get", "post", "put", "delete", "patch"];
for (const method of methodsToWrap) {
  const originalMethod = app[method].bind(app);
  app[method] = function (routePath, ...handlers) {
    const wrappedHandlers = handlers.map((fn) => {
      if (typeof fn !== "function") return fn;
      return (req, res, next) => {
        try {
          const result = fn(req, res, next);
          if (result && typeof result.catch === "function") {
            result.catch((err) => {
              console.error(
                `[API Error] ${req.method} ${req.originalUrl || routePath}:`,
                err.message,
              );
              if (!res.headersSent) {
                res.status(500).json({
                  error: "Internal server error",
                  message: err.message,
                });
              }
            });
          }
        } catch (syncErr) {
          console.error(
            `[API Sync Error] ${req.method} ${req.originalUrl || routePath}:`,
            syncErr.message,
          );
          if (!res.headersSent) {
            res.status(500).json({
              error: "Internal server error",
              message: syncErr.message,
            });
          }
        }
      };
    });
    return originalMethod(routePath, ...wrappedHandlers);
  };
}

app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  }),
);

// Automatically load .env if environment variables are not already set
if (!process.env.CI_ADMIN_TOKEN || !process.env.CI_WORKER_TOKEN) {
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    try {
      if (typeof process.loadEnvFile === "function") {
        process.loadEnvFile(envPath);
      } else {
        const lines = fs.readFileSync(envPath, "utf8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const idx = trimmed.indexOf("=");
          if (idx !== -1) {
            const k = trimmed.slice(0, idx).trim();
            const v = trimmed
              .slice(idx + 1)
              .trim()
              .replace(/^['"]|['"]$/g, "");
            if (!process.env[k]) process.env[k] = v;
          }
        }
      }
    } catch {}
  }
}

const PORT = Number(process.env.CI_PORT || process.env.PORT || 8787);
const BIND_HOST = process.env.CI_BIND_HOST || "0.0.0.0";
const ADMIN_TOKEN =
  process.env.CI_ADMIN_TOKEN || process.env.INFRAXIS_ADMIN_TOKEN;
const WORKER_TOKEN =
  process.env.CI_WORKER_TOKEN || process.env.INFRAXIS_WORKER_TOKEN;
const WEBHOOK_TOKEN = process.env.BITBUCKET_WEBHOOK_TOKEN;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const DATA_DIR = path.resolve(process.env.CI_DATA_DIR || "./data");
const ARTIFACT_DIR = path.resolve(process.env.CI_ARTIFACT_DIR || "./artifacts");
const WORK_DIR = path.resolve(
  process.env.INFRAXIS_WORK_DIR || process.env.CI_WORK_DIR || "./work",
);
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(ARTIFACT_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(WORK_DIR, { recursive: true, mode: 0o700 });

if (
  !ADMIN_TOKEN ||
  ADMIN_TOKEN.length < 32 ||
  !WORKER_TOKEN ||
  WORKER_TOKEN.length < 32 ||
  !WEBHOOK_TOKEN ||
  WEBHOOK_TOKEN.length < 32
) {
  console.error(
    "Set CI_ADMIN_TOKEN, CI_WORKER_TOKEN, and BITBUCKET_WEBHOOK_TOKEN to distinct random values (32+ characters).",
  );
  process.exit(1);
}

// --- Redis Client & Pub/Sub Setup (Optional) ---
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
let redis = null;
let redisSub = null;
let redisConnected = false;

try {
  redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 8) return null;
      return Math.min(times * 200, 2000);
    },
  });

  redisSub = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 8) return null;
      return Math.min(times * 200, 2000);
    },
  });

  redis.on("connect", () => {
    redisConnected = true;
    console.log(`[Redis] Connected to ${REDIS_URL}`);
  });

  redis.on("error", (err) => {
    redisConnected = false;
    if (redis && redis.status !== "reconnecting") {
      // Redis is optional
    }
  });

  const SERVER_INSTANCE_ID = crypto.randomUUID();
  global.__SERVER_INSTANCE_ID = SERVER_INSTANCE_ID;

  redisSub.on("error", () => {});

  redis.connect().catch(() => {});
  redisSub
    .connect()
    .then(() => {
      redisSub.subscribe("ci:events:broadcast", () => {});
      redisSub.on("message", (channel, message) => {
        if (
          channel === "ci:events:broadcast" &&
          typeof wsClients !== "undefined"
        ) {
          try {
            const envelope = JSON.parse(message);
            // Deduplicate: ignore messages published by this same node instance
            if (envelope && envelope.origin === SERVER_INSTANCE_ID) return;
            const content =
              envelope && envelope.payload ? envelope.payload : message;
            for (const client of wsClients) {
              if (client.readyState === 1) {
                try {
                  client.send(content);
                } catch {}
              }
            }
          } catch {
            for (const client of wsClients) {
              if (client.readyState === 1) {
                try {
                  client.send(message);
                } catch {}
              }
            }
          }
        }
      });
    })
    .catch(() => {});
} catch (err) {
  // Redis optional
}

const SUPPORTED_KINDS = db.jobs.SUPPORTED_KINDS;
const now = () => new Date().toISOString();
const safeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};

function bearer(req) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  if (req.query && typeof req.query.token === "string") return req.query.token;
  return "";
}

function hashPassword(password, salt) {
  return crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");
}

function verifyPassword(password, salt, hash) {
  try {
    const check = hashPassword(password, salt);
    return crypto.timingSafeEqual(
      Buffer.from(check, "hex"),
      Buffer.from(hash, "hex"),
    );
  } catch {
    return false;
  }
}

const tokenCache = new Set();

async function isValidAdminToken(token) {
  if (!token || typeof token !== "string") return false;
  if (safeEqual(token, ADMIN_TOKEN)) return true;
  if (tokenCache.has(token)) return true;
  try {
    const user = await db.auth.findUserByToken(token);
    if (user) {
      tokenCache.add(token);
      if (redis && redisConnected) {
        redis.set(`ci:token:${token}`, user.id, "EX", 86400).catch(() => {});
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function requireAdmin(req, res, next) {
  const token = bearer(req);
  if (!(await isValidAdminToken(token))) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const user = await db.auth.findUserByToken(token);
    if (user) req.user = user;
  } catch {}
  next();
}

function requireWorker(req, res, next) {
  if (!safeEqual(bearer(req), WORKER_TOKEN)) {
    return res.status(401).json({ error: "Unauthorized worker" });
  }
  next();
}

async function requireAdminOrWorker(req, res, next) {
  const token = bearer(req);
  if (safeEqual(token, WORKER_TOKEN) || (await isValidAdminToken(token))) {
    return next();
  }
  return res.status(401).json({ error: "Unauthorized" });
}

function isLocalCloneUrl(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  return (
    t.startsWith("/") ||
    t.startsWith("file://") ||
    t.startsWith("./") ||
    t.startsWith("../") ||
    t.startsWith("~")
  );
}

function parseGitUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const clean = rawUrl.trim().replace(/\.git$/, "");
  if (isLocalCloneUrl(clean)) return null;

  let provider = null;
  if (clean.includes("github.com")) {
    provider = "github";
  } else if (clean.includes("bitbucket.org")) {
    provider = "bitbucket";
  }

  const match = clean.match(/(?:[:/]|^)([^/:]+)\/([^/:]+)$/);
  if (match) {
    const owner = match[1];
    const repo = match[2];
    return {
      provider: provider || "github",
      owner,
      repo,
      fullName: `${owner}/${repo}`,
    };
  }
  return null;
}

function validCommit(s, isLocal = false) {
  if (typeof s !== "string") return false;
  const trimmed = s.trim();
  if (isLocal) {
    return /^[a-f0-9]{7,64}$/i.test(trimmed) || /^HEAD$/i.test(trimmed);
  }
  return /^[a-f0-9]{7,64}$/i.test(trimmed);
}

function validRepo(s, isLocal = false) {
  if (typeof s !== "string") return false;
  const trimmed = s.trim();
  if (isLocal) {
    return /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/.test(trimmed);
  }
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed);
}

function validCloneUrl(s) {
  if (typeof s !== "string" || s.length > 1000) return false;
  const trimmed = s.trim();
  if (trimmed.includes("@")) return false;
  return (
    /^https:\/\/(?:github\.com|bitbucket\.org)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/i.test(
      trimmed,
    ) ||
    (isLocalCloneUrl(trimmed) && /^[^<>:"|?*]+$/.test(trimmed))
  );
}

function validBranch(s) {
  if (typeof s !== "string") return false;
  const b = s.trim().replace(/^refs\/heads\//, "");
  if (b.length === 0 || b.length > 300) return false;
  if (
    b.includes("..") ||
    b.includes("~") ||
    b.includes("^") ||
    b.includes(":") ||
    b.includes("?") ||
    b.includes("*") ||
    b.includes("[") ||
    b.includes("\\") ||
    /\s/.test(b) ||
    b.startsWith("/") ||
    b.endsWith("/")
  ) {
    return false;
  }
  return true;
}

function validKind(s) {
  return typeof s === "string" && SUPPORTED_KINDS.includes(s.trim());
}

function requiredString(s, max = 300) {
  return typeof s === "string" && s.length > 0 && s.length <= max;
}

function newId() {
  return crypto.randomUUID();
}

function extractJobFields(body = {}) {
  const rawClone = (body.cloneUrl ?? body.clone_url ?? "").trim();
  const cloneUrl = rawClone.replace(/^https:\/\/[^@/]+@/i, "https://");
  const isLocal = isLocalCloneUrl(cloneUrl);

  let ownerRepo = (body.ownerRepo ?? body.repo ?? "").trim();
  if (!ownerRepo && isLocal && cloneUrl) {
    const base = path.basename(
      cloneUrl.replace(/^file:\/\//, "").replace(/\/+$/, ""),
    );
    if (base) ownerRepo = `local/${base}`;
  }

  let commitHash = (body.commitHash ?? body.commit_hash ?? "").trim();
  if (!commitHash && isLocal) {
    commitHash = "HEAD";
  }

  let branch = (body.branch ?? "").trim().replace(/^refs\/heads\//, "");
  if (!branch && isLocal) {
    branch = "main";
  }

  const kind = (body.kind ?? "").trim();
  const packageManager =
    (body.packageManager ?? body.package_manager ?? "auto")
      .trim()
      .toLowerCase() || "auto";
  const metadata =
    typeof body.metadata === "object" && body.metadata !== null
      ? body.metadata
      : {};
  return {
    ownerRepo,
    cloneUrl,
    commitHash,
    branch,
    kind,
    packageManager,
    isLocal,
    metadata,
  };
}

function validateJobFields(fields, { requireKind = true } = {}) {
  const { ownerRepo, cloneUrl, commitHash, branch, kind, isLocal } = fields;

  if (!cloneUrl) {
    return 'Missing clone URL. "cloneUrl" (or "clone_url") is required.';
  }
  if (cloneUrl.includes("@")) {
    return "Invalid cloneUrl. Embedded credentials (@) are not permitted; use worker-side Git authentication.";
  }
  if (!validCloneUrl(cloneUrl)) {
    return "Invalid cloneUrl. Must be a valid HTTPS GitHub or Bitbucket URL, or an absolute local directory path.";
  }

  if (!ownerRepo) {
    return 'Missing repository. "ownerRepo" (or "repo") is required.';
  }
  if (!validRepo(ownerRepo, isLocal)) {
    return isLocal
      ? 'Invalid repository format. Expected a repository name or "owner/repository" format.'
      : 'Invalid ownerRepo. Expected "owner/repository" format (e.g. "owner/repo").';
  }

  if (!commitHash) {
    return 'Missing commit hash. "commitHash" (or "commit_hash") is required.';
  }
  if (!validCommit(commitHash, isLocal)) {
    return isLocal
      ? 'Invalid commitHash. Expected a valid Git commit SHA or "HEAD" for local repositories.'
      : "Invalid commitHash. Expected a valid Git commit SHA.";
  }

  if (!branch) {
    return 'Missing branch. "branch" is required.';
  }
  if (!validBranch(branch)) {
    return "Invalid branch. Expected a valid Git branch name (up to 300 characters).";
  }

  if (requireKind) {
    if (!kind) {
      return 'Missing build kind. "kind" is required.';
    }
    if (!validKind(kind)) {
      return `Invalid build kind "${kind}". Supported kinds are: ${SUPPORTED_KINDS.join(", ")}.`;
    }
  }

  return null;
}

// WebSocket Control Plane for Real-time Dashboard (Jobs, Workers & Logs)
const wss = new WebSocketServer({ server, path: "/ws" });
const wsClients = new Set();

function wsBroadcast(payload) {
  const str = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const client of wsClients) {
    if (client.readyState === 1) {
      try {
        client.send(str);
      } catch {}
    }
  }
  if (redis && redisConnected) {
    const envelope = JSON.stringify({
      origin: global.__SERVER_INSTANCE_ID,
      payload: str,
    });
    redis.publish("ci:events:broadcast", envelope).catch(() => {});
  }
}

async function broadcastJobs() {
  try {
    const jobsList = await db.jobs.listJobs(100);
    wsBroadcast({ type: "jobs", jobs: jobsList });
  } catch {}
}

async function broadcastWorkers() {
  try {
    const workersList = await db.workers.listWorkers(30000);
    wsBroadcast({ type: "workers", workers: workersList });
  } catch {}
}

async function broadcastPullRequests() {
  try {
    const prsList = await db.pullRequests.listPullRequests(50);
    wsBroadcast({ type: "pull_requests", pullRequests: prsList });
  } catch {}
}

function broadcastJobLogs(jobId, logs) {
  const str = JSON.stringify({ type: "job_logs", jobId, logs });
  for (const client of wsClients) {
    if (client.readyState === 1 && client.subscribedJobId === jobId) {
      try {
        client.send(str);
      } catch {}
    }
  }
}

wss.on("connection", async (ws, req) => {
  let isAuth = false;
  try {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    if (token && (await isValidAdminToken(token))) {
      isAuth = true;
    }
  } catch {}

  if (isAuth) {
    wsClients.add(ws);
    try {
      const [jobsList, workersList, prsList] = await Promise.all([
        db.jobs.listJobs(100),
        db.workers.listWorkers(30000),
        db.pullRequests.listPullRequests(50),
      ]);
      ws.send(
        JSON.stringify({
          type: "init",
          jobs: jobsList,
          workers: workersList,
          pullRequests: prsList,
        }),
      );
    } catch {}
  }

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "auth") {
        if (msg.token && (await isValidAdminToken(msg.token))) {
          isAuth = true;
          wsClients.add(ws);
          const [jobsList, workersList, prsList] = await Promise.all([
            db.jobs.listJobs(100),
            db.workers.listWorkers(30000),
            db.pullRequests.listPullRequests(50),
          ]);
          ws.send(
            JSON.stringify({
              type: "init",
              jobs: jobsList,
              workers: workersList,
              pullRequests: prsList,
            }),
          );
        } else {
          ws.send(
            JSON.stringify({ type: "error", error: "Invalid admin token" }),
          );
          ws.close(4401, "Unauthorized");
        }
        return;
      }

      if (!isAuth) {
        ws.send(JSON.stringify({ type: "error", error: "Unauthorized" }));
        ws.close(4401, "Unauthorized");
        return;
      }

      if (msg.type === "get_state") {
        const [jobsList, workersList, prsList] = await Promise.all([
          db.jobs.listJobs(100),
          db.workers.listWorkers(30000),
          db.pullRequests.listPullRequests(50),
        ]);
        ws.send(
          JSON.stringify({
            type: "snapshot",
            jobs: jobsList,
            workers: workersList,
            pullRequests: prsList,
          }),
        );
      } else if (msg.type === "subscribe_job" && msg.jobId) {
        ws.subscribedJobId = msg.jobId;
        const initialLogs = await db.logs.getJobLogs({
          jobId: msg.jobId,
          afterId: 0,
          limit: 1000,
        });
        ws.send(
          JSON.stringify({
            type: "job_logs_full",
            jobId: msg.jobId,
            logs: initialLogs,
          }),
        );
      } else if (msg.type === "unsubscribe_job") {
        if (ws.subscribedJobId === msg.jobId) {
          ws.subscribedJobId = null;
        }
      } else if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch {}
  });

  ws.on("close", () => {
    wsClients.delete(ws);
  });

  ws.on("error", () => {
    wsClients.delete(ws);
  });
});

// Broadcast worker status heartbeat every 3 seconds to keep 'online' state accurate
const workerBroadcastInterval = setInterval(() => {
  if (wsClients.size > 0) {
    broadcastWorkers();
  }
}, 3000);
workerBroadcastInterval.unref();

// Stale job recovery check every 15 seconds
const staleRecoveryInterval = setInterval(async () => {
  try {
    const recovered = await db.jobs.recoverStaleJobs(180);
    if (recovered && recovered.length > 0) {
      console.log(
        `[Infraxis Core] Recovered ${recovered.length} stale job(s):`,
        recovered,
      );
      await broadcastJobs();
      await broadcastWorkers();
    }
  } catch (err) {
    // Non-fatal
  }
}, 15000);
staleRecoveryInterval.unref();

let managedWorkerProcess = null;

function startManagedWorker() {
  if (process.env.CI_AUTO_START_WORKER === "false") return;
  if (managedWorkerProcess && !managedWorkerProcess.killed) {
    try {
      managedWorkerProcess.send({ type: "CHECK_NOW" });
    } catch {}
    return;
  }
  const workerScript = path.join(__dirname, "../worker/agent.js");
  if (!fs.existsSync(workerScript)) return;

  const env = {
    ...process.env,
    CI_BASE_URL: `http://${BIND_HOST}:${PORT}`,
    INFRAXIS_BASE_URL: `http://${BIND_HOST}:${PORT}`,
    CI_WORKER_TOKEN: WORKER_TOKEN,
    INFRAXIS_WORKER_TOKEN: WORKER_TOKEN,
  };

  try {
    managedWorkerProcess = child_process.fork(workerScript, [], {
      env,
      stdio: "inherit",
    });

    managedWorkerProcess.on("exit", () => {
      managedWorkerProcess = null;
    });

    console.log(
      "[Infraxis Core] Infraxis Agent auto-started for local build processing.",
    );
  } catch (err) {
    console.error("[Infraxis Core] Failed to auto-start agent:", err.message);
  }
}

function triggerWorkerOnJobQueued() {
  startManagedWorker();
}

function notifyWorkerToCancel(jobId = null) {
  if (managedWorkerProcess && !managedWorkerProcess.killed) {
    try {
      managedWorkerProcess.send({
        type: jobId ? "CANCEL_JOB" : "CANCEL_ALL",
        jobId,
      });
    } catch (e) {
      console.error(
        "[Infraxis Core] Error notifying agent to cancel:",
        e.message,
      );
    }
  }
}

function shutdown() {
  if (managedWorkerProcess) {
    try {
      managedWorkerProcess.kill("SIGTERM");
    } catch {}
  }
  db.closePool().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Health check endpoint
app.get("/health", async (_req, res) => {
  let redisPing = false;
  if (redis && redisConnected) {
    try {
      redisPing = (await redis.ping()) === "PONG";
    } catch {}
  }

  const dbHealth = await db.checkHealth();

  res.json({
    ok: dbHealth.healthy,
    service: "infraxis-core",
    name: "Infraxis Core",
    version: "0.2.0",
    tagline: "Infrastructure for every release.",
    database: {
      provider: "postgresql",
      healthy: dbHealth.healthy,
      name: dbHealth.database || "infraxis",
    },
    redis: {
      enabled: true,
      connected: redisConnected,
      status: redisPing ? "PONG" : "OFFLINE",
    },
  });
});

const webOutDir = path.join(__dirname, "..", "web", "out");
if (fs.existsSync(webOutDir)) {
  app.use(express.static(webOutDir));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(webOutDir, "index.html"));
  });
}

// --- Authentication Endpoints (PostgreSQL + Optional Redis OTP & Session Caching) ---

async function createOtp(email, purpose) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const id = newId();
  const cleanEmail = email.toLowerCase().trim();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  // Store in Redis with 1800s TTL
  if (redis && redisConnected) {
    try {
      await redis.set(`ci:otp:${purpose}:${cleanEmail}`, code, "EX", 1800);
    } catch {}
  }

  await db.auth.recordOtp({
    id,
    email: cleanEmail,
    otpCode: code,
    purpose,
    expiresAt,
  });
  console.log(
    `[Infraxis Auth] Verification OTP for ${cleanEmail} (${purpose}): ${code} [PostgreSQL & Redis]`,
  );
  return code;
}

async function verifyOtpCode(email, code, purpose) {
  if (!email || !code) return false;
  const cleanEmail = email.toLowerCase().trim();
  const cleanCode = code.trim();

  // Fast path: Check Redis first
  if (redis && redisConnected) {
    try {
      const cached = await redis.get(`ci:otp:${purpose}:${cleanEmail}`);
      if (cached && cached === cleanCode) {
        await redis.del(`ci:otp:${purpose}:${cleanEmail}`);
        try {
          await db.auth.verifyOtp({
            email: cleanEmail,
            otpCode: cleanCode,
            purpose,
          });
        } catch {}
        return true;
      }
    } catch {}
  }

  // Persistent fallback: Check PostgreSQL
  const verified = await db.auth.verifyOtp({
    email: cleanEmail,
    otpCode: cleanCode,
    purpose,
  });
  if (verified && redis && redisConnected) {
    redis.del(`ci:otp:${purpose}:${cleanEmail}`).catch(() => {});
  }
  return verified;
}

// 1. Sign Up Step 1
app.post("/api/auth/signup-init", async (req, res) => {
  const {
    email,
    password,
    username,
    fullName,
    phone,
    organization,
    roleTitle,
  } = req.body || {};

  const cleanEmail = (email || "").trim().toLowerCase();
  const cleanUsername = (username || "").trim().toLowerCase();
  const cleanPassword = (password || "").trim();
  const cleanFullName = (fullName || "").trim();
  const cleanPhone = (phone || "").trim();
  const cleanOrg = (organization || "").trim();
  const cleanRoleTitle = (roleTitle || "").trim();

  if (!cleanEmail || !cleanEmail.includes("@")) {
    return res.status(400).json({ error: "Valid email address is required" });
  }
  if (!cleanUsername || cleanUsername.length < 3) {
    return res
      .status(400)
      .json({ error: "Username must be at least 3 characters" });
  }
  if (!cleanPassword || cleanPassword.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters" });
  }
  if (!cleanFullName) {
    return res.status(400).json({ error: "Full Name is required" });
  }

  const existing = await db.auth.getUserByEmailOrUsername(cleanEmail);
  const existingUser =
    existing || (await db.auth.getUserByEmailOrUsername(cleanUsername));
  if (existingUser) {
    return res.status(409).json({
      error: "An account with this email or username already exists",
    });
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(cleanPassword, salt);
  const pendingId = newId();

  await db.auth.createPendingRegistration({
    id: pendingId,
    email: cleanEmail,
    username: cleanUsername,
    fullName: cleanFullName,
    phone: cleanPhone,
    organization: cleanOrg,
    roleTitle: cleanRoleTitle,
    passwordHash,
    salt,
  });

  if (redis && redisConnected) {
    redis
      .set(
        `ci:pending:${cleanEmail}`,
        JSON.stringify({
          username: cleanUsername,
          email: cleanEmail,
          fullName: cleanFullName,
          organization: cleanOrg,
          roleTitle: cleanRoleTitle,
          phone: cleanPhone,
        }),
        "EX",
        1800,
      )
      .catch(() => {});
  }

  const otp = await createOtp(cleanEmail, "signup");

  res.json({
    ok: true,
    step: "otp_verification",
    message: `Verification code generated for ${cleanEmail}`,
    email: cleanEmail,
    devOtp: otp,
  });
});

// 2. Sign Up Step 2
app.post("/api/auth/signup-verify", async (req, res) => {
  const { email, otp } = req.body || {};
  const cleanEmail = (email || "").trim().toLowerCase();
  const cleanOtp = (otp || "").trim();

  if (!cleanEmail || !cleanOtp) {
    return res
      .status(400)
      .json({ error: "Email and OTP verification code are required" });
  }

  const isValid = await verifyOtpCode(cleanEmail, cleanOtp, "signup");
  if (!isValid) {
    return res.status(400).json({ error: "Invalid or expired OTP code" });
  }

  const pending = await db.auth.getPendingRegistration(cleanEmail);
  if (!pending) {
    return res.status(404).json({
      error: "Pending registration expired or not found. Please sign up again.",
    });
  }

  const userId = newId();
  const token = crypto.randomBytes(32).toString("hex");

  const user = await db.auth.activateUserFromPending({
    pending,
    userId,
    token,
  });

  tokenCache.add(token);
  if (redis && redisConnected) {
    redis
      .set(`ci:token:${token}`, JSON.stringify(user), "EX", 7 * 86400)
      .catch(() => {});
    redis.del(`ci:pending:${cleanEmail}`).catch(() => {});
  }

  res.status(201).json({
    ok: true,
    token,
    user,
  });
});

// 3. Sign In Step 1
app.post("/api/auth/login-init", async (req, res) => {
  const { email, username, password } = req.body || {};
  const identifier = (email || username || "").trim().toLowerCase();
  const cleanPassword = (password || "").trim();

  if (!identifier || !cleanPassword) {
    return res
      .status(400)
      .json({ error: "Email/username and password are required" });
  }

  const user = await db.auth.getUserByEmailOrUsername(identifier);
  if (!user || !verifyPassword(cleanPassword, user.salt, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const otp = await createOtp(user.email, "login");

  res.json({
    ok: true,
    step: "otp_verification",
    email: user.email,
    username: user.username,
    message: `Verification OTP generated for ${user.email}`,
    devOtp: otp,
  });
});

// 4. Sign In Step 2
app.post("/api/auth/login-verify", async (req, res) => {
  const { email, otp } = req.body || {};
  const cleanEmail = (email || "").trim().toLowerCase();
  const cleanOtp = (otp || "").trim();

  if (!cleanEmail || !cleanOtp) {
    return res
      .status(400)
      .json({ error: "Email and OTP verification code are required" });
  }

  const isValid = await verifyOtpCode(cleanEmail, cleanOtp, "login");
  if (!isValid) {
    return res
      .status(400)
      .json({ error: "Invalid or expired verification OTP" });
  }

  const user = await db.auth.getUserByEmailOrUsername(cleanEmail);
  if (!user) {
    return res.status(404).json({ error: "User account not found" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  await db.auth.createToken(token, user.id, "Session Token");

  tokenCache.add(token);
  const userPayload = {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.full_name,
    organization: user.organization,
    roleTitle: user.role_title,
    role: user.role,
  };

  if (redis && redisConnected) {
    redis
      .set(`ci:token:${token}`, JSON.stringify(userPayload), "EX", 7 * 86400)
      .catch(() => {});
  }

  res.json({
    ok: true,
    token,
    user: userPayload,
  });
});

// 5. Resend OTP
app.post("/api/auth/resend-otp", async (req, res) => {
  const { email, purpose } = req.body || {};
  const cleanEmail = (email || "").trim().toLowerCase();
  const cleanPurpose = (purpose || "login").trim();

  if (!cleanEmail) {
    return res.status(400).json({ error: "Email is required to resend OTP" });
  }

  const otp = await createOtp(cleanEmail, cleanPurpose);
  res.json({
    ok: true,
    message: `New verification code generated for ${cleanEmail}`,
    email: cleanEmail,
    devOtp: otp,
  });
});

// 6. Direct Sign Up
app.post("/api/auth/signup", async (req, res) => {
  const {
    email,
    password,
    username,
    name,
    fullName,
    phone,
    organization,
    roleTitle,
  } = req.body || {};
  const cleanEmail = (email || "").trim().toLowerCase();
  const cleanUsername = (username || "").trim().toLowerCase();
  const cleanPassword = (password || "").trim();
  const cleanFullName = (fullName || name || cleanUsername).trim();

  if (!cleanEmail || !cleanEmail.includes("@")) {
    return res.status(400).json({ error: "Valid email address is required" });
  }
  if (!cleanUsername || cleanUsername.length < 3) {
    return res
      .status(400)
      .json({ error: "Username must be at least 3 characters" });
  }
  if (!cleanPassword || cleanPassword.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters" });
  }

  const existing = await db.auth.getUserByEmailOrUsername(cleanEmail);
  const existingUser =
    existing || (await db.auth.getUserByEmailOrUsername(cleanUsername));
  if (existingUser) {
    return res
      .status(409)
      .json({ error: "User with this email or username already exists" });
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(cleanPassword, salt);
  const userId = newId();
  const token = crypto.randomBytes(32).toString("hex");

  const user = await db.auth.createDirectUser({
    id: userId,
    username: cleanUsername,
    email: cleanEmail,
    passwordHash,
    salt,
    fullName: cleanFullName,
    phone: (phone || "").trim(),
    organization: (organization || "").trim(),
    roleTitle: (roleTitle || "").trim(),
    token,
  });

  tokenCache.add(token);
  res.status(201).json({
    ok: true,
    token,
    user,
  });
});

// 7. Direct Sign In
app.post("/api/auth/login", async (req, res) => {
  const { email, username, password } = req.body || {};
  const identifier = (email || username || "").trim().toLowerCase();
  const cleanPassword = (password || "").trim();

  if (!identifier || !cleanPassword) {
    return res
      .status(400)
      .json({ error: "Email/username and password are required" });
  }

  const user = await db.auth.getUserByEmailOrUsername(identifier);
  if (!user || !verifyPassword(cleanPassword, user.salt, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  await db.auth.createToken(token, user.id, "Session Token");
  tokenCache.add(token);

  res.json({
    ok: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      organization: user.organization,
      roleTitle: user.role_title,
      role: user.role,
    },
  });
});

app.get("/api/auth/me", async (req, res) => {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  if (safeEqual(token, ADMIN_TOKEN)) {
    return res.json({
      ok: true,
      user: {
        id: "root-admin",
        username: "admin",
        email: "admin@infraxis.local",
        fullName: "Infraxis Administrator",
        organization: "Platform Engineering",
        roleTitle: "Root Admin",
        role: "admin",
      },
    });
  }

  const user = await db.auth.findUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  res.json({ ok: true, user });
});

// Git repository local & remote inspector
app.get("/api/inspect-local", async (req, res) => {
  const raw = (req.query.path || "").trim();
  if (!raw) return res.status(400).json({ error: "Missing path parameter" });

  const parsedGit = parseGitUrl(raw);
  if (parsedGit) {
    try {
      const { resolveAccountAndToken, getAdapter } = require("./services/git-providers");
      const { token, adapter } = await resolveAccountAndToken({ provider: parsedGit.provider });
      const { detectRemoteRepository } = require("./services/remote-detector");

      let branch = "main";
      let commitHash = "HEAD";
      let commitMsg = "";

      const activeAdapter = adapter || getAdapter(parsedGit.provider);
      if (token) {
        try {
          const repoDetail = await activeAdapter.getRepository({ token, owner: parsedGit.owner, repo: parsedGit.repo });
          if (repoDetail.defaultBranch) branch = repoDetail.defaultBranch;
          const commitRes = await activeAdapter.listCommits({ token, owner: parsedGit.owner, repo: parsedGit.repo, branch, perPage: 1 });
          if (commitRes.commits?.[0]) {
            commitHash = commitRes.commits[0].hash;
            commitMsg = commitRes.commits[0].message;
          }
        } catch {}
      }

      const detection = await detectRemoteRepository({
        adapter: activeAdapter,
        token,
        owner: parsedGit.owner,
        repo: parsedGit.repo,
        ref: commitHash,
      });

      return res.json({
        ok: true,
        path: raw,
        folderName: parsedGit.repo,
        appName: detection.name || parsedGit.fullName,
        branch,
        commitHash,
        commitMsg,
        packageManager: detection.packageManager || "npm",
        isGit: true,
        primaryType: detection.primaryType,
        category: detection.category,
        technologies: detection.technologies,
        requiredCapabilities: detection.requiredCapabilities,
        isMonorepo: detection.isMonorepo,
        monorepoType: detection.monorepoType,
        subApps: detection.subApps,
        hasInfraxisConfig: detection.hasInfraxisConfig,
        hasDockerfile: detection.hasDockerfile,
        recommendedProfile: detection.recommendedProfile,
        pipelineTarget: detection.pipelineTarget,
        availableProfiles: detection.availableProfiles,
        detection,
      });
    } catch (remoteErr) {
      console.warn(`[Remote Inspect Warning] ${raw}:`, remoteErr.message);
      return res.json({
        ok: true,
        path: raw,
        folderName: parsedGit.repo,
        appName: parsedGit.fullName,
        branch: "main",
        commitHash: "HEAD",
        commitMsg: "",
        packageManager: "auto",
        isGit: true,
        primaryType: "general",
        category: "general",
        technologies: [],
        requiredCapabilities: [],
        isMonorepo: false,
        subApps: [],
        hasInfraxisConfig: false,
        recommendedProfile: "pr-checks",
      });
    }
  }

  let target = raw.replace(/^file:\/\//, "");
  if (target.startsWith("~")) {
    target = path.join(process.env.HOME || "", target.slice(1));
  }
  target = path.resolve(target);

  if (!fs.existsSync(target)) {
    return res
      .status(404)
      .json({ error: `Directory does not exist: ${target}` });
  }
  if (!fs.statSync(target).isDirectory()) {
    return res
      .status(400)
      .json({ error: `Path is not a directory: ${target}` });
  }

  let folderName = path.basename(target);
  let appName = folderName;
  try {
    const pkgPath = path.join(target, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.name) appName = pkg.name;
    }
  } catch {}

  let branch = "main";
  let commitHash = "HEAD";
  let commitMsg = "";
  let isGit = false;

  try {
    const b = child_process
      .execFileSync(
        "git",
        ["-C", target, "rev-parse", "--abbrev-ref", "HEAD"],
        {
          encoding: "utf8",
          timeout: 2000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      )
      .trim();
    if (b) {
      branch = b === "HEAD" ? "main" : b;
      isGit = true;
    }
  } catch {}

  try {
    const c = child_process
      .execFileSync("git", ["-C", target, "rev-parse", "HEAD"], {
        encoding: "utf8",
        timeout: 2000,
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();
    if (c) {
      commitHash = c;
      isGit = true;
    }
  } catch {}

  try {
    const m = child_process
      .execFileSync(
        "git",
        ["-C", target, "log", "-1", "--pretty=format:%h %s"],
        {
          encoding: "utf8",
          timeout: 2000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      )
      .trim();
    if (m) commitMsg = m;
  } catch {}

  let packageManager = "npm";
  const npmrc = path.join(target, ".npmrc");
  let hasNodeLinker = false;
  if (fs.existsSync(npmrc)) {
    try {
      hasNodeLinker = fs.readFileSync(npmrc, "utf8").includes("node-linker");
    } catch {}
  }
  if (
    fs.existsSync(path.join(target, "pnpm-lock.yaml")) ||
    fs.existsSync(path.join(target, "pnpm-workspace.yaml")) ||
    hasNodeLinker
  ) {
    packageManager = "pnpm";
  } else if (fs.existsSync(path.join(target, "yarn.lock"))) {
    packageManager = "yarn";
  }

  // Universal Project Detection & Pipeline Planning
  let detection = null;
  try {
    detection = detectRepository(target);
  } catch {}

  const customConfig = loadRepoConfig(target);
  const recommendation = getRecommendedProfileAndTarget(detection, customConfig);

  const suggestedPipelines = {
    "pr-checks": planPipeline({
      detection,
      profile: "pr-checks",
      customConfig,
    }),
    "dev-build": planPipeline({
      detection,
      profile: "dev-build",
      customConfig,
    }),
    "release-build": planPipeline({
      detection,
      profile: "release-build",
      customConfig,
    }),
  };

  if (recommendation.availableProfiles.includes("android-debug")) {
    suggestedPipelines["android-debug"] = planPipeline({
      detection,
      profile: "android-debug",
      customConfig,
    });
    suggestedPipelines["android-release"] = planPipeline({
      detection,
      profile: "android-release",
      customConfig,
    });
  }
  if (recommendation.availableProfiles.includes("ios-simulator")) {
    suggestedPipelines["ios-simulator"] = planPipeline({
      detection,
      profile: "ios-simulator",
      customConfig,
    });
    suggestedPipelines["ios-release"] = planPipeline({
      detection,
      profile: "ios-release",
      customConfig,
    });
  }
  if (customConfig?.pipelines?.["custom-pipeline"]) {
    suggestedPipelines["custom-pipeline"] = planPipeline({
      detection,
      profile: "custom-pipeline",
      customConfig,
    });
  }

  res.json({
    ok: true,
    path: target,
    folderName,
    appName: detection?.name || appName,
    branch,
    commitHash,
    commitMsg,
    packageManager: detection?.packageManager || packageManager,
    isGit,
    primaryType: detection?.primaryType || "general",
    category: detection?.category || "general",
    technologies: detection?.technologies || [],
    requiredCapabilities: detection?.requiredCapabilities || [],
    isMonorepo: detection?.isMonorepo || false,
    monorepoType: detection?.monorepoType || null,
    subApps: detection?.subApps || [],
    hasInfraxisConfig: Boolean(customConfig || detection?.hasInfraxisConfig),
    hasDockerfile: detection?.hasDockerfile || false,
    recommendedProfile: recommendation.recommendedProfile,
    pipelineTarget: recommendation.pipelineTarget,
    availableProfiles: recommendation.availableProfiles,
    suggestedPipelines,
    detection,
  });
});

// Universal Project Detection API
app.post("/api/detect", requireAdmin, async (req, res) => {
  const target = (req.body?.path || "").trim();
  if (!target) return res.status(400).json({ error: "Missing path parameter" });

  const parsedGit = parseGitUrl(target);
  if (parsedGit) {
    try {
      const { resolveAccountAndToken, getAdapter } = require("./services/git-providers");
      const { token, adapter } = await resolveAccountAndToken({ provider: parsedGit.provider });
      const { detectRemoteRepository } = require("./services/remote-detector");
      const activeAdapter = adapter || getAdapter(parsedGit.provider);
      const detection = await detectRemoteRepository({
        adapter: activeAdapter,
        token,
        owner: parsedGit.owner,
        repo: parsedGit.repo,
        ref: req.body?.branch || "HEAD",
      });
      return res.json({
        ok: true,
        path: target,
        appName: detection.name || parsedGit.fullName,
        branch: req.body?.branch || "main",
        commitHash: "HEAD",
        ...detection,
      });
    } catch (remoteErr) {
      return res.status(500).json({ error: remoteErr.message });
    }
  }

  try {
    let resolved = target.replace(/^file:\/\//, "");
    if (resolved.startsWith("~")) {
      resolved = path.join(process.env.HOME || "", resolved.slice(1));
    }
    resolved = path.resolve(resolved);
    const detection = detectRepository(resolved);
    const customConfig = loadRepoConfig(resolved);
    const recommendation = getRecommendedProfileAndTarget(detection, customConfig);

    const suggestedPipelines = {
      "pr-checks": planPipeline({
        detection,
        profile: "pr-checks",
        customConfig,
      }),
      "dev-build": planPipeline({
        detection,
        profile: "dev-build",
        customConfig,
      }),
      "release-build": planPipeline({
        detection,
        profile: "release-build",
        customConfig,
      }),
    };

    if (recommendation.availableProfiles.includes("android-debug")) {
      suggestedPipelines["android-debug"] = planPipeline({
        detection,
        profile: "android-debug",
        customConfig,
      });
      suggestedPipelines["android-release"] = planPipeline({
        detection,
        profile: "android-release",
        customConfig,
      });
    }
    if (recommendation.availableProfiles.includes("ios-simulator")) {
      suggestedPipelines["ios-simulator"] = planPipeline({
        detection,
        profile: "ios-simulator",
        customConfig,
      });
      suggestedPipelines["ios-release"] = planPipeline({
        detection,
        profile: "ios-release",
        customConfig,
      });
    }
    if (customConfig?.pipelines?.["custom-pipeline"]) {
      suggestedPipelines["custom-pipeline"] = planPipeline({
        detection,
        profile: "custom-pipeline",
        customConfig,
      });
    }

    res.json({
      ok: true,
      detection,
      customConfig,
      recommendedProfile: recommendation.recommendedProfile,
      pipelineTarget: recommendation.pipelineTarget,
      availableProfiles: recommendation.availableProfiles,
      suggestedPipelines,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Universal Pipeline Planning API
app.post("/api/pipelines/plan", requireAdmin, (req, res) => {
  const {
    detection,
    profile = "pr-checks",
    customConfig,
    options,
  } = req.body || {};
  try {
    const plan = planPipeline({ detection, profile, customConfig, options });
    res.json({ ok: true, plan });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Pull Requests & Checks APIs
app.get("/api/pull-requests", requireAdmin, async (_req, res) => {
  const prs = await db.pullRequests.listPullRequests(50);
  res.json(prs);
});

app.get("/api/pull-requests/:id", requireAdmin, async (req, res) => {
  const prs = await db.pullRequests.listPullRequests(100);
  const found = prs.find((p) => p.id === req.params.id);
  if (!found) return res.status(404).json({ error: "Pull request not found" });
  res.json(found);
});

// Git Integrations (GitHub & Bitbucket)
integrationsRouter.setCallbacks({
  triggerWorkerOnJobQueued,
  broadcastJobs,
  broadcastPullRequests,
});

app.use(
  "/api/integrations",
  (req, res, next) => {
    // OAuth callbacks and status do not require Bearer token
    if (
      (req.path.includes("/oauth/") && req.path.endsWith("/callback")) ||
      req.path === "/status"
    ) {
      return next();
    }
    return requireAdmin(req, res, next);
  },
  integrationsRouter,
);

// Internal Git credential helper for worker checkouts (never exposes passwords in URLs)
app.get("/api/jobs/:id/git-credentials", requireWorker, async (req, res) => {
  try {
    const job = await db.jobs.getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: "Job not found" });

    let provider = job.metadata?.provider;
    if (!provider) {
      if (job.clone_url?.includes("github.com")) provider = "github";
      else if (job.clone_url?.includes("bitbucket.org")) provider = "bitbucket";
    }

    if (!provider) {
      return res.json({ header: null });
    }

    const { resolveAccountAndToken } = require("./services/git-providers");
    const { token } = await resolveAccountAndToken({
      accountId: job.metadata?.connectedAccountId || null,
      provider,
    });

    if (!token) {
      return res.json({ header: null });
    }

    const header = provider === "bitbucket" ? `Bearer ${token}` : `token ${token}`;
    return res.json({ header, provider });
  } catch (err) {
    console.warn(`[Git Credentials] Failed for job ${req.params.id}:`, err.message);
    res.json({ header: null });
  }
});

// Pipeline Stages APIs
app.get("/api/jobs/:id/stages", requireAdminOrWorker, async (req, res) => {
  const stages = await db.pipelineStages.getJobPipelineStages(req.params.id);
  res.json(stages);
});

app.post("/api/jobs/:id/stages", requireWorker, async (req, res) => {
  const {
    name,
    category,
    status,
    duration_ms,
    output,
    started_at,
    finished_at,
  } = req.body || {};
  if (!name) return res.status(400).json({ error: "Missing stage name" });
  const recorded = await db.pipelineStages.recordPipelineStage({
    job_id: req.params.id,
    name,
    category: category || "custom",
    status: status || "pending",
    duration_ms: duration_ms || 0,
    output: output || null,
    started_at: started_at || null,
    finished_at: finished_at || null,
  });
  wsBroadcast({
    type: "pipeline_stage",
    jobId: req.params.id,
    stage: recorded,
  });
  res.json({ ok: true, stage: recorded });
});

// Job Queue and Releases APIs
app.post("/api/jobs", requireAdmin, async (req, res) => {
  const fields = extractJobFields(req.body);
  const error = validateJobFields(fields);
  if (error) {
    return res.status(400).json({ error });
  }

  const { job } = await db.jobs.createJob({
    repo: fields.ownerRepo,
    cloneUrl: fields.cloneUrl,
    commitHash: fields.commitHash,
    branch: fields.branch,
    kind: fields.kind,
    packageManager: fields.packageManager || "auto",
    requestedBy: "dashboard",
    idempotencyKey: req.body?.idempotencyKey || null,
    metadata: fields.metadata,
  });

  triggerWorkerOnJobQueued();
  await broadcastJobs();
  res.status(201).json(job);
});

app.get("/api/ios/signing-identities", requireAdmin, (req, res) => {
  if (process.platform !== "darwin") {
    return res.json({
      identities: [],
      defaultTeamId: null,
      isMac: false,
      exportMethods: ["development", "ad-hoc", "app-store", "enterprise"],
    });
  }
  try {
    const { execSync } = require("child_process");
    const out = execSync("security find-identity -p codesigning -v", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const identities = [];
    const lines = out.split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*\d+\)\s+([A-F0-9]{40})\s+"([^"]+)"/);
      if (match) {
        const hash = match[1];
        const title = match[2];
        const teamMatch = title.match(/\(([A-Z0-9]{10})\)$/);
        const isDistribution = title.toLowerCase().includes("distribution");
        identities.push({
          hash,
          title,
          teamId: teamMatch ? teamMatch[1] : null,
          type: isDistribution ? "distribution" : "development",
        });
      }
    }
    const defaultTeamId = identities[0]?.teamId || null;
    res.json({
      identities,
      defaultTeamId,
      isMac: true,
      exportMethods: ["development", "ad-hoc", "app-store", "enterprise"],
    });
  } catch (err) {
    res.json({
      identities: [],
      defaultTeamId: null,
      error: err.message,
      isMac: true,
      exportMethods: ["development", "ad-hoc", "app-store", "enterprise"],
    });
  }
});

app.post("/api/releases", requireAdmin, async (req, res) => {
  const fields = extractJobFields(req.body);
  const platform = (req.body?.platform ?? "").trim().toLowerCase();
  const kind =
    platform === "android"
      ? "android-release"
      : platform === "ios"
        ? "ios-release"
        : "";
  if (!kind) {
    return res.status(400).json({
      error: 'Invalid platform for release. Expected "android" or "ios".',
    });
  }
  const error = validateJobFields({ ...fields, kind }, { requireKind: false });
  if (error) {
    return res.status(400).json({ error });
  }

  const { job } = await db.jobs.createJob({
    repo: fields.ownerRepo,
    cloneUrl: fields.cloneUrl,
    commitHash: fields.commitHash,
    branch: fields.branch,
    kind,
    packageManager: fields.packageManager || "auto",
    requestedBy: "manual-release",
    idempotencyKey: req.body?.idempotencyKey || null,
  });

  triggerWorkerOnJobQueued();
  await broadcastJobs();
  res.status(201).json(job);
});

app.get("/api/jobs", requireAdmin, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const jobsList = await db.jobs.listJobs(limit);
  res.json(jobsList);
});

app.get("/api/jobs/:id", requireAdminOrWorker, async (req, res) => {
  const job = await db.jobs.getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.post("/api/jobs/:id/cancel", requireAdmin, async (req, res) => {
  const result = await db.jobs.cancelJob(req.params.id, "administrator");
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  notifyWorkerToCancel(req.params.id);
  await broadcastJobs();
  res.json(result.job);
});

app.post("/api/jobs/cancel-all", requireAdmin, async (req, res) => {
  const result = await db.jobs.cancelAllJobs("administrator");
  notifyWorkerToCancel(null);
  await broadcastJobs();
  await broadcastWorkers();
  res.json({ success: true, cancelled_count: result.cancelledCount });
});

app.post("/api/jobs/:id/rebuild", requireAdmin, async (req, res) => {
  const original = await db.jobs.getJobById(req.params.id);
  if (!original) {
    return res.status(404).json({ error: "Job not found" });
  }

  if (original.status === "cancelled") {
    return res
      .status(400)
      .json({ error: "Cancelled builds cannot be rebuilt" });
  }

  const job = await db.jobs.resetJobForRebuild(req.params.id);
  triggerWorkerOnJobQueued();
  await broadcastJobs();
  res.status(200).json(job);
});

app.post("/api/jobs/rebuild-failed", requireAdmin, async (req, res) => {
  const allJobs = await db.jobs.listJobs(100);
  const failedJobs = allJobs.filter((j) => j.status === "failed");
  const rebuilt = [];

  for (const f of failedJobs) {
    const job = await db.jobs.resetJobForRebuild(f.id);
    if (job) rebuilt.push(job);
  }

  if (rebuilt.length > 0) {
    triggerWorkerOnJobQueued();
    await broadcastJobs();
  }

  res.json({
    success: true,
    rebuilt_count: rebuilt.length,
    jobs: rebuilt,
  });
});

app.delete("/api/jobs", requireAdmin, async (req, res) => {
  notifyWorkerToCancel(null);

  // Clear filesystem artifacts
  try {
    if (fs.existsSync(ARTIFACT_DIR)) {
      for (const f of fs.readdirSync(ARTIFACT_DIR)) {
        const p = path.join(ARTIFACT_DIR, f);
        try {
          if (fs.statSync(p).isDirectory()) {
            fs.rmSync(p, { recursive: true, force: true });
          } else {
            fs.unlinkSync(p);
          }
        } catch {}
      }
    }
  } catch {}

  // Clear filesystem work folders
  try {
    if (fs.existsSync(WORK_DIR)) {
      for (const f of fs.readdirSync(WORK_DIR)) {
        const p = path.join(WORK_DIR, f);
        try {
          if (fs.statSync(p).isDirectory()) {
            fs.rmSync(p, { recursive: true, force: true });
          } else {
            fs.unlinkSync(p);
          }
        } catch {}
      }
    }
  } catch {}

  await db.jobs.clearAllJobs("administrator");
  await broadcastJobs();
  await broadcastWorkers();
  res.json({
    success: true,
    message: "All jobs, logs, artifacts, and work folders cleared.",
  });
});

app.delete("/api/jobs/:id", requireAdmin, async (req, res) => {
  const job = await db.jobs.getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });

  notifyWorkerToCancel(job.id);

  // Remove local job artifacts from disk
  const artifacts = await db.artifacts.listArtifactsByJobId(job.id);
  for (const a of artifacts) {
    try {
      if (a.path && fs.existsSync(a.path)) fs.unlinkSync(a.path);
    } catch {}
  }

  // Remove local job work folder from disk if present
  try {
    const jobWorkDir = path.join(WORK_DIR, job.id);
    if (fs.existsSync(jobWorkDir)) {
      fs.rmSync(jobWorkDir, { recursive: true, force: true });
    }
  } catch {}

  const result = await db.jobs.deleteJob(job.id, "administrator");
  await broadcastJobs();
  await broadcastWorkers();
  res.json({ success: true, id: job.id });
});

app.get("/api/jobs/:id/logs", requireAdmin, async (req, res) => {
  const after = Math.max(Number(req.query.after) || 0, 0);
  const logs = await db.logs.getJobLogs({
    jobId: req.params.id,
    afterId: after,
    limit: 1000,
  });
  res.json(logs);
});

app.get("/api/jobs/:id/events", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const initialJob = await db.jobs.getJobById(id);
  if (!initialJob) return res.status(404).end();

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  let after = Math.max(Number(req.query.after) || 0, 0);

  const send = async () => {
    try {
      const lines = await db.logs.getJobLogs({
        jobId: id,
        afterId: after,
        limit: 500,
      });

      for (const line of lines) {
        res.write(
          `id: ${line.id}\nevent: log\ndata: ${JSON.stringify(line)}\n\n`,
        );
        after = line.id;
      }

      const job = await db.jobs.getJobById(id);
      if (job) {
        res.write(`event: status\ndata: ${JSON.stringify(job)}\n\n`);
      }

      if (!job || ["succeeded", "failed", "cancelled"].includes(job.status)) {
        clearInterval(timer);
        res.end();
      }
    } catch {
      clearInterval(timer);
      res.end();
    }
  };

  const timer = setInterval(send, 1000);
  send();
  req.on("close", () => clearInterval(timer));
});

// Workers APIs
app.get("/api/workers", requireAdmin, async (_req, res) => {
  const workers = await db.workers.listWorkers(30000);
  res.json(workers);
});

app.post("/api/workers/heartbeat", requireWorker, async (req, res) => {
  const {
    id,
    labels,
    current_job,
    platform,
    version,
    arch,
    capabilities,
    system_info,
  } = req.body || {};
  if (
    !requiredString(id, 120) ||
    !Array.isArray(labels) ||
    labels.some((x) => typeof x !== "string" || x.length > 60)
  ) {
    return res.status(400).json({ error: "Invalid worker payload" });
  }

  await db.workers.upsertWorkerHeartbeat({
    id,
    labels,
    current_job: current_job || null,
    platform: platform || "unknown",
    arch: arch || "unknown",
    capabilities: capabilities || {},
    system_info: system_info || {},
    version: version || "0.2.0",
  });

  await broadcastWorkers();
  res.json({ ok: true });
});

/**
 * Atomic concurrent job claiming using SELECT ... FOR UPDATE SKIP LOCKED
 */
app.post("/api/workers/claim", requireWorker, async (req, res) => {
  const { id, labels, capabilities, platform, arch } = req.body || {};
  if (!requiredString(id, 120) || !Array.isArray(labels)) {
    return res.status(400).json({ error: "Invalid worker payload" });
  }

  const claimed = await db.jobs.claimNextJob({
    workerId: id,
    labels,
    capabilities: capabilities || {},
    platform: platform || "unknown",
    arch: arch || "unknown",
  });

  if (!claimed) {
    return res.json({ job: null });
  }

  await broadcastJobs();
  await broadcastWorkers();

  res.json({
    job: {
      ...claimed,
      clone_url: claimed.clone_url,
      package_manager: claimed.package_manager || "auto",
    },
  });
});

app.post("/api/jobs/:id/logs", requireWorker, async (req, res) => {
  try {
    const job = await db.jobs.getJobById(req.params.id);
    if (!job || job.status !== "running") {
      return res.status(409).json({ error: "Job is not running" });
    }

    const { lines } = req.body || {};
    if (!Array.isArray(lines) || lines.length > 200) {
      return res
        .status(400)
        .json({ error: "Send 1-200 log lines per request" });
    }

    const attemptNumber = (job.retry_count || 0) + 1;
    const inserted = await db.logs.insertJobLogs({
      jobId: job.id,
      lines,
      attemptNumber,
    });

    if (inserted && inserted.length > 0) {
      broadcastJobLogs(job.id, inserted);
    }
    if (job.worker_id) {
      db.workers
        .upsertWorkerHeartbeat({
          id: job.worker_id,
          current_job: job.id,
        })
        .catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(
      `[Logs Error] Failed to persist logs for job ${req.params.id}:`,
      err.message,
    );
    res
      .status(500)
      .json({ error: "Failed to persist logs", message: err.message });
  }
});

app.post(
  "/api/jobs/:id/artifacts",
  requireWorker,
  express.raw({ type: "application/octet-stream", limit: "500mb" }),
  async (req, res) => {
    const job = await db.jobs.getJobById(req.params.id);
    if (!job || job.status !== "running") {
      return res.status(409).json({ error: "Job is not running" });
    }

    const filename = String(req.query.filename || "");
    if (
      !/^[A-Za-z0-9_.-]{1,180}$/.test(filename) ||
      !Buffer.isBuffer(req.body)
    ) {
      return res.status(400).json({ error: "Invalid artifact upload" });
    }

    const id = newId();
    const dir = path.join(ARTIFACT_DIR, job.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const dest = path.join(dir, `${id}-${filename}`);
    fs.writeFileSync(dest, req.body, { mode: 0o600, flag: "wx" });

    const checksum = crypto.createHash("sha256").update(req.body).digest("hex");
    const attemptNumber = (job.retry_count || 0) + 1;

    const record = await db.artifacts.createArtifactMetadata({
      id,
      jobId: job.id,
      attemptNumber,
      filename,
      contentType: "application/octet-stream",
      path: dest,
      size: req.body.length,
      checksum,
    });

    res.status(201).json(record);
  },
);

app.get("/api/jobs/:id/artifacts", requireAdmin, async (req, res) => {
  const artifacts = await db.artifacts.listArtifactsByJobId(req.params.id);
  res.json(artifacts);
});

app.get("/api/artifacts", requireAdmin, async (req, res) => {
  const artifacts = await db.artifacts.listAllArtifacts(100);
  res.json(artifacts);
});

app.get("/api/artifacts/:id", requireAdmin, async (req, res) => {
  const a = await db.artifacts.getArtifactById(req.params.id);
  if (!a || !fs.existsSync(a.path)) {
    return res.status(404).json({ error: "Artifact not found" });
  }
  res.download(a.path, a.filename);
});

app.delete("/api/artifacts/:id", requireAdmin, async (req, res) => {
  try {
    const artifact = await db.artifacts.getArtifactById(req.params.id);
    if (!artifact) {
      return res.status(404).json({ error: "Artifact not found" });
    }

    // Remove physical file from disk
    if (artifact.path && fs.existsSync(artifact.path)) {
      try {
        fs.unlinkSync(artifact.path);
        // Clean up parent directory if empty
        const parentDir = path.dirname(artifact.path);
        if (
          fs.existsSync(parentDir) &&
          fs.readdirSync(parentDir).length === 0
        ) {
          fs.rmdirSync(parentDir);
        }
      } catch (err) {
        console.warn(
          `[Artifacts] Warning deleting file ${artifact.path}:`,
          err.message,
        );
      }
    }

    await db.artifacts.deleteArtifactById(req.params.id);

    await db.audit
      .recordAuditEvent({
        action: "artifact.deleted",
        actor: req.user?.username || req.token || "administrator",
        entityType: "artifact",
        entityId: req.params.id,
        metadata: { filename: artifact.filename, jobId: artifact.job_id },
      })
      .catch(() => {});

    res.json({ ok: true, id: req.params.id, filename: artifact.filename });
  } catch (err) {
    console.error(`[Artifacts] Error deleting artifact ${req.params.id}:`, err);
    res
      .status(500)
      .json({ error: "Failed to delete artifact", message: err.message });
  }
});

app.delete("/api/artifacts", requireAdmin, async (req, res) => {
  try {
    const deleted = await db.artifacts.deleteAllArtifacts();
    for (const a of deleted) {
      if (a.path && fs.existsSync(a.path)) {
        try {
          fs.unlinkSync(a.path);
          const parentDir = path.dirname(a.path);
          if (
            fs.existsSync(parentDir) &&
            fs.readdirSync(parentDir).length === 0
          ) {
            fs.rmdirSync(parentDir);
          }
        } catch {}
      }
    }

    await db.audit
      .recordAuditEvent({
        action: "artifacts.cleared",
        actor: req.user?.username || req.token || "administrator",
        entityType: "artifact",
        metadata: { count: deleted.length },
      })
      .catch(() => {});

    res.json({ ok: true, count: deleted.length });
  } catch (err) {
    console.error("[Artifacts] Error clearing all artifacts:", err);
    res
      .status(500)
      .json({ error: "Failed to clear artifacts", message: err.message });
  }
});

app.post("/api/jobs/:id/finish", requireWorker, async (req, res) => {
  try {
    const { exit_code, error, check_results } = req.body || {};

    const result = await db.jobs.finishJob({
      jobId: req.params.id,
      workerId: req.body?.worker_id || null,
      exitCode: exit_code,
      error,
    });

    if (!result.ok) {
      return res.status(409).json({ error: result.error });
    }

    // Check if this job has an associated Pull Request
    const job = await db.jobs.getJobById(req.params.id);
    if (job && job.commit_hash) {
      const pr = await db.pullRequests.getPullRequestByCommit(job.commit_hash);
      if (pr) {
        const prStatus =
          result.status === "succeeded"
            ? "success"
            : result.status === "cancelled"
              ? "cancelled"
              : "failure";

        await db.pullRequests.upsertPullRequest({
          repo: pr.repo,
          provider: pr.provider,
          pr_number: pr.pr_number,
          title: pr.title,
          source_branch: pr.source_branch,
          target_branch: pr.target_branch,
          commit_hash: pr.commit_hash,
          status: prStatus,
          latest_job_id: job.id,
          check_results: check_results || pr.check_results || [],
        });

        reportCommitStatus({
          provider: pr.provider,
          repo: pr.repo,
          commitHash: job.commit_hash,
          state: prStatus === "success" ? "success" : "failure",
          description:
            prStatus === "success"
              ? "Infraxis: All checks passed"
              : `Infraxis: Check failed (${error || "exit code " + exit_code})`,
          context: `infraxis/${job.kind || "pr-checks"}`,
        }).catch(() => {});

        await broadcastPullRequests();
      }
    }

    await broadcastJobs();
    await broadcastWorkers();
    res.json({ ok: true, status: result.status });
  } catch (err) {
    console.error(
      `[Finish Error] Failed to finish job ${req.params.id}:`,
      err.message,
    );
    res
      .status(500)
      .json({ error: "Failed to finish job", message: err.message });
  }
});

// GitHub Webhook Intake
app.post("/webhooks/github", async (req, res) => {
  if (!GITHUB_WEBHOOK_SECRET) {
    return res.status(503).json({
      error: "GitHub webhook is not configured. Set GITHUB_WEBHOOK_SECRET.",
    });
  }

  const signature = req.headers["x-hub-signature-256"];
  if (typeof signature !== "string" || !signature.startsWith("sha256=")) {
    return res.status(401).json({ error: "Missing GitHub signature" });
  }

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", GITHUB_WEBHOOK_SECRET)
      .update(req.rawBody || Buffer.from(""))
      .digest("hex");

  if (!safeEqual(signature, expected)) {
    return res.status(401).json({ error: "Invalid GitHub signature" });
  }

  const event = req.headers["x-github-event"];
  const deliveryId = req.headers["x-github-delivery"] || "";
  const body = req.body || {};
  const repo = body.repository;
  let commit = null;
  let branch = null;
  let targetBranch = null;
  let prNumber = null;
  let prTitle = null;
  let kind = null;

  if (
    event === "pull_request" &&
    ["opened", "synchronize", "reopened", "ready_for_review"].includes(
      body.action,
    )
  ) {
    commit = body.pull_request?.head?.sha;
    branch = body.pull_request?.head?.ref;
    targetBranch = body.pull_request?.base?.ref;
    prNumber = body.pull_request?.number;
    prTitle = body.pull_request?.title;
    kind = "pr-checks";
  } else if (event === "push") {
    commit = body.after;
    branch =
      typeof body.ref === "string"
        ? body.ref.replace(/^refs\/heads\//, "")
        : null;
    kind = "android-release";
  } else {
    return res.json({ ignored: true });
  }

  const rawClone =
    repo?.clone_url ||
    (repo?.full_name ? `https://github.com/${repo.full_name}.git` : "");
  const cleanClone = rawClone
    ? rawClone.replace(/^https:\/\/[^@/]+@/i, "https://")
    : "";

  const metadata = prNumber
    ? {
        prNumber,
        prTitle,
        targetBranch,
        provider: "github",
      }
    : {};

  const fields = extractJobFields({
    ownerRepo: repo?.full_name,
    cloneUrl: cleanClone,
    commitHash: commit,
    branch,
    kind,
    metadata,
  });

  const validationError = validateJobFields(fields);
  if (validationError) {
    return res
      .status(400)
      .json({ error: `Invalid GitHub webhook payload: ${validationError}` });
  }

  // Prevent duplicate jobs from redelivered events using deliveryId as idempotency key
  const idempotencyKey = deliveryId
    ? `github-${deliveryId}`
    : `github-${repo?.full_name}-${commit}-${branch}-${kind}`;

  const { job, isDuplicate } = await db.jobs.createJob({
    repo: fields.ownerRepo,
    cloneUrl: fields.cloneUrl,
    commitHash: fields.commitHash,
    branch: fields.branch,
    kind: fields.kind,
    packageManager: fields.packageManager || "auto",
    requestedBy: "github-webhook",
    idempotencyKey,
    metadata: fields.metadata,
  });

  if (isDuplicate) {
    return res
      .status(200)
      .json({ queued: false, duplicate: true, id: job.id, kind: job.kind });
  }

  if (prNumber) {
    await db.pullRequests.upsertPullRequest({
      repo: fields.ownerRepo,
      provider: "github",
      pr_number: prNumber,
      title: prTitle,
      source_branch: branch,
      target_branch: targetBranch || "main",
      commit_hash: commit,
      status: "pending",
      latest_job_id: job.id,
    });

    reportCommitStatus({
      provider: "github",
      repo: fields.ownerRepo,
      commitHash: commit,
      state: "pending",
      description: "Infraxis: PR checks queued",
      context: "infraxis/pr-checks",
    }).catch(() => {});

    await broadcastPullRequests();
  }

  triggerWorkerOnJobQueued();
  await broadcastJobs();
  return res.status(202).json({ queued: true, id: job.id, kind: fields.kind });
});

// Bitbucket Webhook Intake
app.post("/webhooks/bitbucket", async (req, res) => {
  if (!safeEqual(req.headers["x-ci-webhook-token"], WEBHOOK_TOKEN)) {
    return res.status(401).json({ error: "Invalid webhook token" });
  }

  const event = req.headers["x-event-key"];
  const hookUuid =
    req.headers["x-hook-uuid"] || req.headers["x-request-uuid"] || "";
  const body = req.body || {};

  if (
    !["pullrequest:created", "pullrequest:updated", "repo:push"].includes(event)
  ) {
    return res.json({ ignored: true });
  }

  const repo = body.repository;
  let commit = null;
  let branch = null;
  let targetBranch = null;
  let prNumber = null;
  let prTitle = null;
  let kind = null;

  if (event.startsWith("pullrequest:")) {
    commit = body.pullrequest?.source?.commit?.hash;
    branch = body.pullrequest?.source?.branch?.name;
    targetBranch = body.pullrequest?.destination?.branch?.name;
    prNumber = body.pullrequest?.id;
    prTitle = body.pullrequest?.title;
    kind = "pr-checks";
  } else {
    commit = body.push?.changes?.find((c) => c.new)?.new?.target?.hash;
    branch = body.push?.changes?.find((c) => c.new)?.new?.name;
    kind = "android-release";
  }

  const rawClone =
    repo?.links?.clone?.find((c) => c.name === "https")?.href ||
    (repo?.full_name ? `https://bitbucket.org/${repo.full_name}.git` : "");
  const cleanClone = rawClone
    ? rawClone.replace(/^https:\/\/[^@/]+@/i, "https://")
    : "";

  const metadata = prNumber
    ? {
        prNumber,
        prTitle,
        targetBranch,
        provider: "bitbucket",
      }
    : {};

  const fields = extractJobFields({
    ownerRepo: repo?.full_name,
    cloneUrl: cleanClone,
    commitHash: commit,
    branch,
    kind,
    metadata,
  });

  const validationError = validateJobFields(fields);
  if (validationError) {
    return res
      .status(400)
      .json({ error: `Invalid Bitbucket webhook payload: ${validationError}` });
  }

  // Prevent duplicate jobs from redelivered events
  const idempotencyKey = hookUuid
    ? `bitbucket-${hookUuid}`
    : `bitbucket-${repo?.full_name}-${commit}-${branch}-${kind}`;

  const { job, isDuplicate } = await db.jobs.createJob({
    repo: fields.ownerRepo,
    cloneUrl: fields.cloneUrl,
    commitHash: fields.commitHash,
    branch: fields.branch,
    kind: fields.kind,
    packageManager: fields.packageManager || "auto",
    requestedBy: "bitbucket-webhook",
    idempotencyKey,
    metadata: fields.metadata,
  });

  if (isDuplicate) {
    return res
      .status(200)
      .json({ queued: false, duplicate: true, id: job.id, kind: job.kind });
  }

  if (prNumber) {
    await db.pullRequests.upsertPullRequest({
      repo: fields.ownerRepo,
      provider: "bitbucket",
      pr_number: prNumber,
      title: prTitle,
      source_branch: branch,
      target_branch: targetBranch || "main",
      commit_hash: commit,
      status: "pending",
      latest_job_id: job.id,
    });

    reportCommitStatus({
      provider: "bitbucket",
      repo: fields.ownerRepo,
      commitHash: commit,
      state: "pending",
      description: "Infraxis: PR checks queued",
      context: "infraxis/pr-checks",
    }).catch(() => {});

    await broadcastPullRequests();
  }

  triggerWorkerOnJobQueued();
  await broadcastJobs();
  res.status(202).json({ queued: true, id: job.id, kind: fields.kind });
});

if (fs.existsSync(webOutDir)) {
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/webhooks")) {
      return next();
    }
    res.sendFile(path.join(webOutDir, "index.html"));
  });
}

// Startup: run database migrations and start server
async function startServer() {
  try {
    console.log("[Infraxis Core] Running database migrations...");
    await db.runMigrations();
    console.log("[Infraxis Core] Database migrations verified.");
  } catch (err) {
    console.error(
      "[Infraxis Core] Failed to run database migrations:",
      err.message,
    );
    process.exit(1);
  }

  server.listen(PORT, BIND_HOST, () => {
    console.log(`Infraxis Core listening on http://${BIND_HOST}:${PORT}`);
    console.log("Tagline: Infrastructure for every release.");
    startManagedWorker();
  });
}

function stopManagedWorker() {
  if (managedWorkerProcess && !managedWorkerProcess.killed) {
    try {
      managedWorkerProcess.kill("SIGTERM");
    } catch {}
    managedWorkerProcess = null;
  }
}

async function closeServer() {
  stopManagedWorker();
  if (redis) {
    try {
      redis.disconnect();
    } catch {}
  }
  if (redisSub) {
    try {
      redisSub.disconnect();
    } catch {}
  }
  await db.closePool().catch(() => {});
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  server,
  startServer,
  closeServer,
  stopManagedWorker,
  redis,
  redisSub,
};
