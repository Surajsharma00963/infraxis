"use strict";
// Minimal worker agent. Only runs hard-coded job types; never accepts arbitrary shell commands from the server.
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");

// Automatically load .env if environment variables are not already set
if (
  (!process.env.CI_BASE_URL && !process.env.INFRAXIS_BASE_URL) ||
  (!process.env.CI_WORKER_TOKEN && !process.env.INFRAXIS_WORKER_TOKEN)
) {
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    try {
      if (typeof process.loadEnvFile === "function") {
        process.loadEnvFile(envPath);
      } else {
        const content = fs.readFileSync(envPath, "utf8");
        for (const line of content.split("\n")) {
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

const BASE_URL = process.env.INFRAXIS_BASE_URL || process.env.CI_BASE_URL;
const TOKEN = process.env.INFRAXIS_WORKER_TOKEN || process.env.CI_WORKER_TOKEN;
const WORKER_ID =
  process.env.INFRAXIS_WORKER_ID ||
  process.env.CI_WORKER_ID ||
  `${os.hostname()}-${crypto.randomUUID().slice(0, 8)}`;
const LABELS = (
  process.env.INFRAXIS_WORKER_LABELS ||
  process.env.CI_WORKER_LABELS ||
  (process.platform === "darwin" ? "android,release,ios" : "android,release")
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const WORK_DIR = path.resolve(
  process.env.INFRAXIS_WORK_DIR || process.env.CI_WORK_DIR || "./work",
);
const POLL_MS = Number(
  process.env.CI_POLL_MS || process.env.INFRAXIS_POLL_MS || 5000,
);
if (!BASE_URL || !TOKEN)
  throw new Error(
    "Set INFRAXIS_BASE_URL (or CI_BASE_URL) and INFRAXIS_WORKER_TOKEN (or CI_WORKER_TOKEN) in .env or environment",
  );
fs.mkdirSync(WORK_DIR, { recursive: true });

// Ensure standard CLI tools (pnpm, yarn, npm, brew, android sdk) are in PATH
{
  const extraPaths = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(process.env.HOME || "", "Library/pnpm/bin"),
    path.join(process.env.HOME || "", "Library/pnpm"),
    path.join(process.env.HOME || "", ".local/bin"),
    path.join(process.env.HOME || "", ".cargo/bin"),
    path.join(process.env.HOME || "", "Library/Android/sdk/platform-tools"),
  ];
  const curPaths = (process.env.PATH || "").split(path.delimiter);
  for (const p of extraPaths) {
    if (p && !curPaths.includes(p) && fs.existsSync(p)) {
      curPaths.unshift(p);
    }
  }
  process.env.PATH = curPaths.join(path.delimiter);
}

async function api(route, options = {}) {
  const response = await fetch(`${BASE_URL.replace(/\/$/, "")}${route}`, {
    ...options,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) },
  });
  if (!response.ok)
    throw new Error(
      `API ${route}: HTTP ${response.status} ${await response.text()}`,
    );
  return response.status === 204 ? null : response.json();
}

// Batched log buffer to prevent socket exhaustion during heavy build output
let logBuffer = [];
let logTimer = null;
let currentJobId = null;

async function flushLogs() {
  if (logTimer) {
    clearTimeout(logTimer);
    logTimer = null;
  }
  if (!logBuffer.length || !currentJobId) return;
  const chunk = logBuffer.splice(0, 150);
  try {
    await api(`/api/jobs/${currentJobId}/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines: chunk }),
    });
  } catch (e) {
    if (logBuffer.length < 500) {
      logBuffer.unshift(...chunk);
    }
  }
  if (logBuffer.length > 0 && !logTimer) {
    logTimer = setTimeout(() => {
      flushLogs().catch(() => {});
    }, 50);
  }
}

function queueLog(jobId, line, stream = "stdout") {
  currentJobId = jobId;
  logBuffer.push({ line: String(line).slice(0, 4000), stream });
  if (logBuffer.length >= 80) {
    flushLogs().catch(() => {});
  } else if (!logTimer) {
    logTimer = setTimeout(() => {
      flushLogs().catch(() => {});
    }, 100);
  }
}

async function log(job, line, stream = "system") {
  process.stdout.write(`[${job.id}] ${line}\n`);
  queueLog(job.id, line, stream);
  await flushLogs();
}

let currentJobContext = null;

function killProcessTree(child) {
  if (!child || !child.pid) return;
  const pid = child.pid;
  try {
    if (process.platform !== "win32") {
      process.kill(-pid, "SIGKILL");
    } else {
      child.kill("SIGKILL");
    }
  } catch (e) {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  if (process.platform === "darwin" || process.platform === "linux") {
    try {
      const { execSync } = require("child_process");
      execSync(`pkill -9 -P ${pid}`, { stdio: "ignore" });
    } catch {}
  }
}

function killWorkspaceProcesses(workspaceDir) {
  if (!workspaceDir || !fs.existsSync(workspaceDir)) return;
  try {
    if (process.platform === "darwin" || process.platform === "linux") {
      const { execSync } = require("child_process");
      const out = execSync(`lsof -t "${workspaceDir}"`, {
        encoding: "utf8",
      }).trim();
      if (out) {
        const pids = out.split(/\s+/).filter(Boolean);
        for (const p of pids) {
          const num = Number(p);
          if (num && num !== process.pid && num !== process.ppid) {
            try {
              process.kill(num, "SIGKILL");
            } catch {}
          }
        }
      }
    }
  } catch {}
}

function cancelCurrentJobProcess(reason = "Cancelled by administrator") {
  if (!currentJobContext) return;
  currentJobContext.cancelled = true;
  currentJobContext.cancelReason = reason;

  if (currentJobContext.activeChild) {
    const child = currentJobContext.activeChild;
    currentJobContext.activeChild = null;
    killProcessTree(child);
  }

  if (currentJobContext.dir) {
    killWorkspaceProcesses(currentJobContext.dir);
  }
}

function run(cmd, args, cwd, env, onLine) {
  return new Promise((resolve) => {
    if (currentJobContext?.cancelled) {
      return resolve({
        code: 130,
        error: currentJobContext.cancelReason || "Job cancelled",
      });
    }

    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      detached: process.platform !== "win32",
    });

    if (currentJobContext) {
      currentJobContext.activeChild = child;
    }

    let buffers = { stdout: "", stderr: "" };
    for (const [streamName, stream] of [
      ["stdout", child.stdout],
      ["stderr", child.stderr],
    ]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        buffers[streamName] += chunk;
        const lines = buffers[streamName].split(/\r?\n/);
        buffers[streamName] = lines.pop() || "";
        for (const line of lines) onLine(line, streamName);
      });
    }
    child.on("error", (e) => {
      if (currentJobContext?.activeChild === child)
        currentJobContext.activeChild = null;
      resolve({ code: 127, error: e.message });
    });
    child.on("close", (code, signal) => {
      if (currentJobContext?.activeChild === child)
        currentJobContext.activeChild = null;
      for (const name of ["stdout", "stderr"])
        if (buffers[name]) onLine(buffers[name], name);
      if (currentJobContext?.cancelled) {
        resolve({
          code: 130,
          error: currentJobContext.cancelReason || "Process terminated",
        });
      } else {
        resolve({ code: code == null ? (signal ? 1 : 0) : code });
      }
    });
  });
}

async function uploadFile(job, file) {
  if (!fs.existsSync(file)) return;
  const filename = path.basename(file);
  const buf = fs.readFileSync(file);
  await api(
    `/api/jobs/${job.id}/artifacts?filename=${encodeURIComponent(filename)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: buf,
    },
  );
  await log(
    job,
    `Artifact uploaded: ${filename} (${buf.length} bytes)`,
    "system",
  );
}

async function runStep(job, cwd, cmd, args, env = {}, options = {}) {
  if (currentJobContext?.cancelled) {
    throw new Error(currentJobContext.cancelReason || "Job was cancelled");
  }
  await log(job, `$ ${cmd} ${args.join(" ")}`, "system");
  const result = await run(
    cmd,
    args,
    options.cwd || cwd,
    env,
    (line, stream) => {
      queueLog(job.id, line, stream);
    },
  );
  await flushLogs();
  if (currentJobContext?.cancelled) {
    throw new Error(currentJobContext.cancelReason || "Job was cancelled");
  }
  if (result.error) await log(job, result.error, "stderr");
  if (result.code !== 0)
    throw new Error(`${cmd} exited with code ${result.code}`);
}
function workspace(job) {
  const dir = path.join(WORK_DIR, job.id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
async function checkout(job, dir) {
  const cloneUrl = job.cloneUrl || job.clone_url;
  const commitHash = job.commitHash || job.commit_hash || "HEAD";
  const isLocal =
    cloneUrl.startsWith("/") ||
    cloneUrl.startsWith("file://") ||
    cloneUrl.startsWith("./") ||
    cloneUrl.startsWith("../");

  const src = path.join(dir, "src");
  if (fs.existsSync(src)) {
    try {
      fs.rmSync(src, { recursive: true, force: true });
    } catch {}
  }

  const cloneArgs = isLocal
    ? ["clone", "--no-checkout", cloneUrl, "src"]
    : ["clone", "--no-checkout", "--depth", "50", cloneUrl, "src"];
  await runStep(job, dir, "git", cloneArgs);

  if (!isLocal || commitHash.toUpperCase() !== "HEAD") {
    try {
      await runStep(job, src, "git", [
        "fetch",
        "--depth",
        "1",
        "origin",
        commitHash,
      ]);
    } catch {
      // Local repositories already contain local commits
    }
  }
  await runStep(job, src, "git", ["checkout", "--detach", commitHash]);
  return src;
}
function detectPackageManager(src, job = {}) {
  const isWin = process.platform === "win32";
  const explicit = (
    job.packageManager ||
    job.package_manager ||
    ""
  ).toLowerCase();

  if (explicit === "pnpm") {
    return {
      name: "pnpm",
      cmd: isWin ? "pnpm.cmd" : "pnpm",
      installArgs: ["install", "--no-frozen-lockfile"],
      runArgs: (s) => ["run", s],
    };
  }
  if (explicit === "yarn") {
    return {
      name: "yarn",
      cmd: isWin ? "yarn.cmd" : "yarn",
      installArgs: ["install"],
      runArgs: (s) => ["run", s],
    };
  }
  if (explicit === "npm") {
    return {
      name: "npm",
      cmd: isWin ? "npm.cmd" : "npm",
      installArgs: ["install"],
      runArgs: (s) => ["run", s, "--if-present"],
    };
  }

  // 1. Check package.json for "packageManager"
  let hasPnpm = false;
  let hasYarn = false;
  try {
    const pkgPath = path.join(src, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (typeof pkg.packageManager === "string") {
        if (pkg.packageManager.startsWith("pnpm")) hasPnpm = true;
        if (pkg.packageManager.startsWith("yarn")) hasYarn = true;
      }
    }
  } catch {}

  // 2. Check for pnpm markers in checked-out code
  if (
    fs.existsSync(path.join(src, "pnpm-lock.yaml")) ||
    fs.existsSync(path.join(src, "pnpm-workspace.yaml"))
  ) {
    hasPnpm = true;
  }

  const npmrcPath = path.join(src, ".npmrc");
  if (fs.existsSync(npmrcPath)) {
    try {
      const content = fs.readFileSync(npmrcPath, "utf8");
      if (content.includes("node-linker") || content.includes("pnpm")) {
        hasPnpm = true;
      }
    } catch {}
  }

  // 3. If local directory clone, inspect original local folder for pnpm-lock, workspace, or config
  const cloneUrl = (job.cloneUrl || job.clone_url || "").trim();
  const isLocal =
    cloneUrl.startsWith("/") ||
    cloneUrl.startsWith("file://") ||
    cloneUrl.startsWith("./") ||
    cloneUrl.startsWith("../") ||
    cloneUrl.startsWith("~");

  if (isLocal) {
    let localSourceDir = cloneUrl.replace(/^file:\/\//, "");
    if (localSourceDir.startsWith("~")) {
      localSourceDir = path.join(
        process.env.HOME || "",
        localSourceDir.slice(1),
      );
    }
    localSourceDir = path.resolve(localSourceDir);

    if (fs.existsSync(localSourceDir)) {
      try {
        const origPkg = JSON.parse(
          fs.readFileSync(path.join(localSourceDir, "package.json"), "utf8"),
        );
        if (origPkg.packageManager?.startsWith("pnpm")) hasPnpm = true;
        if (origPkg.packageManager?.startsWith("yarn")) hasYarn = true;
      } catch {}

      const origPnpmLock = path.join(localSourceDir, "pnpm-lock.yaml");
      const origPnpmWorkspace = path.join(
        localSourceDir,
        "pnpm-workspace.yaml",
      );
      const origNpmrc = path.join(localSourceDir, ".npmrc");

      if (fs.existsSync(origNpmrc)) {
        try {
          if (fs.readFileSync(origNpmrc, "utf8").includes("node-linker")) {
            hasPnpm = true;
          }
        } catch {}
      }

      if (fs.existsSync(origPnpmLock) || fs.existsSync(origPnpmWorkspace)) {
        hasPnpm = true;
      }

      // Copy uncommitted/gitignored pnpm files into checked out src
      if (hasPnpm) {
        if (
          !fs.existsSync(path.join(src, "pnpm-lock.yaml")) &&
          fs.existsSync(origPnpmLock)
        ) {
          try {
            fs.copyFileSync(origPnpmLock, path.join(src, "pnpm-lock.yaml"));
          } catch {}
        }
        if (
          !fs.existsSync(path.join(src, "pnpm-workspace.yaml")) &&
          fs.existsSync(origPnpmWorkspace)
        ) {
          try {
            fs.copyFileSync(
              origPnpmWorkspace,
              path.join(src, "pnpm-workspace.yaml"),
            );
          } catch {}
        }
        if (
          !fs.existsSync(path.join(src, ".npmrc")) &&
          fs.existsSync(origNpmrc)
        ) {
          try {
            fs.copyFileSync(origNpmrc, path.join(src, ".npmrc"));
          } catch {}
        }
      }
    }
  }

  if (hasPnpm) {
    return {
      name: "pnpm",
      cmd: isWin ? "pnpm.cmd" : "pnpm",
      installArgs: ["install", "--no-frozen-lockfile"],
      runArgs: (s) => ["run", s],
    };
  }

  if (hasYarn || fs.existsSync(path.join(src, "yarn.lock"))) {
    return {
      name: "yarn",
      cmd: isWin ? "yarn.cmd" : "yarn",
      installArgs: ["install"],
      runArgs: (s) => ["run", s],
    };
  }

  if (fs.existsSync(path.join(src, "package-lock.json"))) {
    return {
      name: "npm",
      cmd: isWin ? "npm.cmd" : "npm",
      installArgs: ["ci"],
      runArgs: (s) => ["run", s, "--if-present"],
    };
  }

  return {
    name: "npm",
    cmd: isWin ? "npm.cmd" : "npm",
    installArgs: ["install"],
    runArgs: (s) => ["run", s, "--if-present"],
  };
}

function getAvailableSigningIdentities() {
  if (process.platform !== "darwin") return [];
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
        identities.push({
          hash,
          title,
          teamId: teamMatch ? teamMatch[1] : null,
        });
      }
    }
    return identities;
  } catch {
    return [];
  }
}

async function execute(job) {
  const dir = workspace(job);
  currentJobContext = {
    id: job.id,
    dir,
    cancelled: false,
    cancelReason: "",
    activeChild: null,
  };

  // Poll server every 1.5s to immediately detect cancellation or deletion
  const cancelCheckTimer = setInterval(async () => {
    if (!currentJobContext || currentJobContext.cancelled) return;
    try {
      const res = await api(`/api/jobs/${job.id}`);
      if (
        !res ||
        res.error ||
        ["cancelled", "failed", "succeeded"].includes(res.status)
      ) {
        console.log(
          `[Worker] Job ${job.id} status is ${res?.status || "cancelled/removed"}. Terminating process tree...`,
        );
        cancelCurrentJobProcess(
          res?.status === "cancelled"
            ? "Job cancelled by administrator"
            : "Job terminated on server",
        );
      }
    } catch (err) {
      if (
        err.message &&
        (err.message.includes("404") || err.message.includes("not found"))
      ) {
        console.log(
          `[Worker] Job ${job.id} deleted from server. Terminating process tree...`,
        );
        cancelCurrentJobProcess("Job deleted from server");
      }
    }
  }, 5000);

  let exitCode = 1;
  let error = null;
  try {
    await log(job, `Worker ${WORKER_ID} started ${job.kind}`, "system");
    const src = await checkout(job, dir);

    // Auto-detect pnpm, yarn, or npm
    const pm = detectPackageManager(src, job);
    await log(
      job,
      `Detected package manager: ${pm.name} (${pm.cmd} ${pm.installArgs.join(" ")})`,
      "system",
    );
    try {
      await runStep(job, src, pm.cmd, pm.installArgs);
    } catch (e) {
      if (pm.name === "npm" && pm.installArgs[0] === "ci") {
        await log(job, "npm ci failed, retrying with npm install...", "system");
        await runStep(job, src, pm.cmd, ["install"]);
      } else {
        throw e;
      }
    }

    // Ensure gradlew has executable permissions
    const androidDir = path.join(src, "android");
    if (fs.existsSync(androidDir)) {
      const gradlewPath = path.join(androidDir, "gradlew");
      if (fs.existsSync(gradlewPath)) {
        try {
          fs.chmodSync(gradlewPath, 0o755);
        } catch {}
      }
    }

    if (job.kind === "android-release" || job.kind === "android-debug") {
      if (!fs.existsSync(androidDir)) {
        throw new Error("No android/ directory found in project root.");
      }
      await log(
        job,
        "Building Android Release APK (./gradlew assembleRelease)...",
        "system",
      );
      await runStep(job, androidDir, "./gradlew", ["assembleRelease"]);

      // Locate generated Release APK
      const releaseApkDir = path.join(
        src,
        "android/app/build/outputs/apk/release",
      );
      let targetApk = null;
      if (fs.existsSync(releaseApkDir)) {
        const files = fs
          .readdirSync(releaseApkDir)
          .filter((f) => f.endsWith(".apk"));
        const preferred =
          files.find((f) => f === "app-release.apk") ||
          files.find((f) => !f.includes("unsigned")) ||
          files[0];
        if (preferred) {
          targetApk = path.join(releaseApkDir, preferred);
        }
      }

      if (!targetApk) {
        const apkRoot = path.join(src, "android/app/build/outputs/apk");
        if (fs.existsSync(apkRoot)) {
          const findApk = (d) => {
            for (const item of fs.readdirSync(d, { withFileTypes: true })) {
              const p = path.join(d, item.name);
              if (item.isDirectory()) {
                const found = findApk(p);
                if (found) return found;
              } else if (
                item.name.endsWith(".apk") &&
                !item.name.includes("debug")
              ) {
                return p;
              }
            }
            return null;
          };
          targetApk = findApk(apkRoot);
        }
      }

      if (!targetApk) {
        throw new Error(
          "No Release APK found in android/app/build/outputs/apk/release/",
        );
      }

      await uploadFile(job, targetApk);
    } else if (job.kind === "ios-release" || job.kind === "ios-simulator") {
      if (process.platform !== "darwin") {
        throw new Error("iOS release builds require macOS");
      }
      const iosDir = path.join(src, "ios");
      if (!fs.existsSync(iosDir)) {
        throw new Error("No ios/ directory found in project root.");
      }
      await log(
        job,
        "Installing iOS CocoaPods dependencies (pod install)...",
        "system",
      );
      await runStep(job, iosDir, "pod", ["install"]);

      // Enforce minimum iOS deployment target (15.1) across all Pods to prevent Xcode 15/16/27 build failures
      const podsProjPath = path.join(
        iosDir,
        "Pods",
        "Pods.xcodeproj",
        "project.pbxproj",
      );
      if (fs.existsSync(podsProjPath)) {
        try {
          let pbx = fs.readFileSync(podsProjPath, "utf8");
          let patchedCount = 0;
          pbx = pbx.replace(
            /IPHONEOS_DEPLOYMENT_TARGET\s*=\s*([0-9.]+);/g,
            (match, version) => {
              const vNum = parseFloat(version);
              if (!isNaN(vNum) && vNum < 15.1) {
                patchedCount++;
                return "IPHONEOS_DEPLOYMENT_TARGET = 15.1;";
              }
              return match;
            },
          );
          if (pbx.includes("com.apple.product-type.bundle")) {
            pbx = pbx.replace(
              /(productType\s*=\s*"com\.apple\.product-type\.bundle";[\s\S]*?buildSettings\s*=\s*\{)/g,
              "$1\n\t\t\t\tCODE_SIGNING_ALLOWED = NO;",
            );
          }
          if (patchedCount > 0) {
            fs.writeFileSync(podsProjPath, pbx, "utf8");
            await log(
              job,
              `[Infraxis Agent] Upgraded ${patchedCount} Pod deployment target(s) (< 15.1) to 15.1 for Xcode compatibility.`,
              "system",
            );
          }
        } catch (patchErr) {
          await log(
            job,
            `[Infraxis Agent] Warning: Could not patch Pod deployment targets: ${patchErr.message}`,
            "system",
          );
        }
      }

      // Auto-detect xcworkspace
      let workspaceName = process.env.IOS_WORKSPACE;
      if (!workspaceName) {
        const ws = fs
          .readdirSync(iosDir)
          .find((f) => f.endsWith(".xcworkspace"));
        if (ws) workspaceName = ws;
      }
      let scheme = process.env.IOS_SCHEME;
      if (!scheme && workspaceName) {
        scheme = path.basename(workspaceName, ".xcworkspace");
      }
      if (!workspaceName || !scheme) {
        throw new Error(
          "Could not detect iOS workspace or scheme in ios/ directory.",
        );
      }

      // Dynamic Code Signing & Packaging Configuration
      const jobMeta = job.metadata || {};
      const isSigningEnabled =
        jobMeta.iosSigningMode !== "disabled" &&
        process.env.IOS_CODE_SIGNING_ALLOWED !== "false" &&
        process.env.IOS_NO_SIGN !== "true";

      const availableIdentities = getAvailableSigningIdentities();

      // Dynamically inspect project's configured Team ID and signing settings from .xcodeproj
      let projectTeam = null;
      let projectIdentity = null;
      try {
        const xcodeProjFiles = fs
          .readdirSync(iosDir)
          .filter((f) => f.endsWith(".xcodeproj"));
        for (const proj of xcodeProjFiles) {
          const pbxPath = path.join(iosDir, proj, "project.pbxproj");
          if (fs.existsSync(pbxPath)) {
            const pbxContent = fs.readFileSync(pbxPath, "utf8");
            const teamMatch = pbxContent.match(
              /DEVELOPMENT_TEAM\s*=\s*([A-Z0-9]{10});/,
            );
            if (teamMatch) projectTeam = teamMatch[1];
            const signMatch = pbxContent.match(
              /CODE_SIGN_IDENTITY(?:\[sdk=[^\]]+\])?\s*=\s*"([^"]+)";/,
            );
            if (signMatch) projectIdentity = signMatch[1];
            break;
          }
        }
      } catch {}

      // 1. Dynamic Team Resolution
      let devTeam =
        jobMeta.iosTeamId ||
        process.env.IOS_DEVELOPMENT_TEAM ||
        process.env.DEVELOPMENT_TEAM;

      if (isSigningEnabled) {
        if (availableIdentities.length > 0) {
          await log(
            job,
            `[Infraxis Agent] Found ${availableIdentities.length} code signing identity(ies) in Keychain:`,
            "system",
          );
          for (const id of availableIdentities) {
            await log(
              job,
              `  • ${id.title} (${id.hash.slice(0, 8)}...)`,
              "system",
            );
          }

          // 1. Dynamic Team Resolution
          // Respect explicit user team -> explicit env team -> project configured team -> first available identity team
          if (!devTeam) {
            if (jobMeta.iosTeamId) {
              devTeam = jobMeta.iosTeamId;
            } else if (process.env.IOS_DEVELOPMENT_TEAM) {
              devTeam = process.env.IOS_DEVELOPMENT_TEAM;
            } else if (projectTeam) {
              devTeam = projectTeam;
              await log(
                job,
                `[Infraxis Agent] Using project's configured Development Team: ${projectTeam}`,
                "system",
              );
            } else if (availableIdentities[0]?.teamId) {
              devTeam = availableIdentities[0].teamId;
              await log(
                job,
                `[Infraxis Agent] Auto-detected Keychain Development Team: ${devTeam}`,
                "system",
              );
            }
          }
        } else {
          if (!devTeam && projectTeam) {
            devTeam = projectTeam;
            await log(
              job,
              `[Infraxis Agent] Using project's configured Development Team: ${devTeam}`,
              "system",
            );
          }
          await log(
            job,
            `[Infraxis Agent] Notice: No code signing identities found via security CLI. Relying on Xcode automatic signing / project profiles.`,
            "system",
          );
        }
      }

      // 2. Dynamic Export Method Resolution
      const exportMethod =
        jobMeta.iosExportMethod ||
        process.env.IOS_EXPORT_METHOD ||
        "development";

      // 3. Dynamic Identity Resolution
      // Note: During the ARCHIVE phase with Automatic Signing, Xcode strictly requires
      // Development signing (or default project identity). Distribution signing is only applied during -exportArchive.
      let codeSignIdentity =
        jobMeta.iosCodeSignIdentity && jobMeta.iosCodeSignIdentity !== "auto"
          ? jobMeta.iosCodeSignIdentity
          : process.env.IOS_CODE_SIGN_IDENTITY ||
            process.env.CODE_SIGN_IDENTITY;

      // Only pass CODE_SIGN_IDENTITY during archive if explicitly requested by user or manual signing
      let archiveSignIdentity = codeSignIdentity || null;
      if (
        archiveSignIdentity &&
        archiveSignIdentity.toLowerCase().includes("distribution")
      ) {
        // Prevent Xcode error: "conflicting provisioning settings... automatically signed for development, but conflicting code signing identity Apple Distribution specified"
        await log(
          job,
          `[Infraxis Agent] Notice: '${archiveSignIdentity}' specified for export. For archive compile step, using project development signing. Distribution signing will apply during IPA export.`,
          "system",
        );
        archiveSignIdentity = null;
      }

      const provProfile =
        jobMeta.iosProvisioningProfile ||
        process.env.IOS_PROVISIONING_PROFILE_SPECIFIER ||
        process.env.PROVISIONING_PROFILE_SPECIFIER;

      await log(
        job,
        `Building iOS Release (${workspaceName}, scheme: ${scheme})...`,
        "system",
      );
      const archivePath = path.join(src, "build/ios/app.xcarchive");
      fs.mkdirSync(path.dirname(archivePath), { recursive: true });

      const archiveArgs = [
        "-workspace",
        workspaceName,
        "-scheme",
        scheme,
        "-configuration",
        "Release",
        "-destination",
        "generic/platform=iOS",
        "-archivePath",
        archivePath,
        "archive",
      ];

      if (isSigningEnabled) {
        archiveArgs.push("-allowProvisioningUpdates");
        if (devTeam) {
          archiveArgs.push(`DEVELOPMENT_TEAM=${devTeam}`);
        }
        if (archiveSignIdentity) {
          archiveArgs.push(`CODE_SIGN_IDENTITY=${archiveSignIdentity}`);
        }
        if (provProfile) {
          archiveArgs.push(`PROVISIONING_PROFILE_SPECIFIER=${provProfile}`);
        }
        await log(
          job,
          `[Infraxis Agent] Code signing is ENABLED for iOS release (team: ${devTeam || "from project"}, identity: ${archiveSignIdentity || "automatic development"}).`,
          "system",
        );
      } else {
        archiveArgs.push(
          "CODE_SIGNING_ALLOWED=NO",
          "CODE_SIGNING_REQUIRED=NO",
          "CODE_SIGN_IDENTITY=",
        );
        await log(
          job,
          `[Infraxis Agent] Code signing is explicitly DISABLED by configuration.`,
          "system",
        );
      }

      try {
        await runStep(job, iosDir, "xcodebuild", archiveArgs);
      } catch (archiveErr) {
        if (
          isSigningEnabled &&
          (archiveErr.message.includes("65") ||
            archiveErr.message.includes("provisioning") ||
            archiveErr.message.includes("signing"))
        ) {
          await log(
            job,
            `[Infraxis Agent] Code signing encountered error 65 (provisioning profile or Apple developer account missing in Xcode).`,
            "stderr",
          );
          await log(
            job,
            `[Infraxis Agent] Attempting automatic fallback archive with CODE_SIGNING_ALLOWED=NO so release artifact can still be produced...`,
            "system",
          );
          const fallbackArgs = [
            "-workspace",
            workspaceName,
            "-scheme",
            scheme,
            "-configuration",
            "Release",
            "-destination",
            "generic/platform=iOS",
            "-archivePath",
            archivePath,
            "archive",
            "CODE_SIGNING_ALLOWED=NO",
            "CODE_SIGNING_REQUIRED=NO",
            "CODE_SIGN_IDENTITY=",
          ];
          await runStep(job, iosDir, "xcodebuild", fallbackArgs);
        } else {
          throw archiveErr;
        }
      }

      // Step: Export IPA Package
      const ipaFile = path.join(src, "build/ios/app.ipa");
      if (isSigningEnabled && fs.existsSync(archivePath)) {
        await log(
          job,
          `Exporting signed IPA package from archive...`,
          "system",
        );
        try {
          const exportDir = path.join(src, "build/ios/export");
          fs.mkdirSync(exportDir, { recursive: true });

          // Find or create ExportOptions.plist
          let exportOptionsPath =
            process.env.IOS_EXPORT_OPTIONS_PLIST ||
            (fs.existsSync(path.join(iosDir, "ExportOptions.plist"))
              ? path.join(iosDir, "ExportOptions.plist")
              : fs.existsSync(path.join(src, "ExportOptions.plist"))
                ? path.join(src, "ExportOptions.plist")
                : null);

          if (!exportOptionsPath) {
            exportOptionsPath = path.join(src, "build/ios/ExportOptions.plist");
            const style = (jobMeta.iosSigningMode || "automatic").toLowerCase();
            const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>${exportMethod}</string>
    <key>signingStyle</key>
    <string>${style}</string>
${devTeam ? `    <key>teamID</key>\n    <string>${devTeam}</string>\n` : ""}    <key>compileBitcode</key>
    <false/>
    <key>thinning</key>
    <string>&lt;none&gt;</string>
    <key>stripSwiftSymbols</key>
    <true/>
</dict>
</plist>
`;
            fs.writeFileSync(exportOptionsPath, plistContent, "utf8");
            await log(
              job,
              `[Infraxis Agent] Generated ExportOptions.plist (method: ${exportMethod}, team: ${devTeam || "automatic"}).`,
              "system",
            );
          }

          const exportArgs = [
            "-exportArchive",
            "-archivePath",
            archivePath,
            "-exportPath",
            exportDir,
            "-exportOptionsPlist",
            exportOptionsPath,
            "-allowProvisioningUpdates",
          ];

          await runStep(job, iosDir, "xcodebuild", exportArgs);

          // Locate exported .ipa
          if (fs.existsSync(exportDir)) {
            const files = fs.readdirSync(exportDir);
            const foundIpa = files.find((f) => f.endsWith(".ipa"));
            if (foundIpa) {
              const srcIpa = path.join(exportDir, foundIpa);
              fs.copyFileSync(srcIpa, ipaFile);
              await log(
                job,
                `[Infraxis Agent] Successfully packaged signed IPA: ${foundIpa}`,
                "system",
              );
            }
          }
        } catch (exportErr) {
          await log(
            job,
            `[Infraxis Agent] Warning: IPA export encountered an issue: ${exportErr.message}. The signed .xcarchive bundle will still be provided.`,
            "stderr",
          );
        }
      }

      // Upload generated artifacts
      let artifactUploaded = false;
      if (fs.existsSync(ipaFile)) {
        await uploadFile(job, ipaFile);
        artifactUploaded = true;
      }
      if (fs.existsSync(archivePath)) {
        const zipPath = path.join(src, "build/ios/app-release.xcarchive.zip");
        await runStep(job, path.dirname(archivePath), "zip", [
          "-r",
          "-q",
          "app-release.xcarchive.zip",
          "app.xcarchive",
        ]);
        await uploadFile(job, zipPath);
        artifactUploaded = true;
      }

      if (!artifactUploaded) {
        throw new Error(
          "No Release archive or IPA was generated in build/ios/",
        );
      }
    } else if (job.kind === "pr-checks") {
      let pkgScripts = {};
      try {
        pkgScripts =
          JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"))
            .scripts || {};
      } catch {}

      const jobMeta = job.metadata || {};
      const strictLint =
        jobMeta.strictLint === true || process.env.CI_STRICT_LINT === "true";
      const checkResults = [];

      // 1. Code Quality & Linting
      if (pkgScripts.lint) {
        await log(job, "Running Code Quality & Lint Check (lint)...", "system");
        try {
          await runStep(job, src, pm.cmd, pm.runArgs("lint"));
          checkResults.push({
            name: "Lint Check",
            status: "PASSED",
            icon: "✅",
          });
        } catch (lintErr) {
          if (strictLint) {
            checkResults.push({
              name: "Lint Check",
              status: "FAILED",
              icon: "❌",
            });
            throw new Error(
              `Lint check failed in strict mode: ${lintErr.message}`,
            );
          } else {
            checkResults.push({
              name: "Lint Check",
              status: "WARNING (Non-blocking)",
              icon: "⚠️",
            });
            await log(
              job,
              `[Infraxis Agent] ⚠️ Lint check completed with issues. Non-blocking mode active: continuing PR verification...`,
              "system",
            );
          }
        }
      }

      // 2. TypeScript Check
      if (pkgScripts.typecheck) {
        await log(job, "Running TypeScript Check (typecheck)...", "system");
        try {
          await runStep(job, src, pm.cmd, pm.runArgs("typecheck"));
          checkResults.push({
            name: "TypeScript Check",
            status: "PASSED",
            icon: "✅",
          });
        } catch (tcErr) {
          checkResults.push({
            name: "TypeScript Check",
            status: "FAILED",
            icon: "❌",
          });
          throw tcErr;
        }
      }

      // 3. Automated Tests
      const testScript = pkgScripts["test:ci"]
        ? "test:ci"
        : pkgScripts.test
          ? "test"
          : null;
      if (testScript) {
        await log(job, `Running Automated Tests (${testScript})...`, "system");
        try {
          await runStep(job, src, pm.cmd, pm.runArgs(testScript));
          checkResults.push({
            name: "Automated Tests",
            status: "PASSED",
            icon: "✅",
          });
        } catch (testErr) {
          checkResults.push({
            name: "Automated Tests",
            status: "FAILED",
            icon: "❌",
          });
          throw testErr;
        }
      }

      // 4. Android Build Verification
      if (LABELS.includes("android") && fs.existsSync(androidDir)) {
        await log(
          job,
          "Verifying Android Compilation (./gradlew assembleRelease)...",
          "system",
        );
        try {
          await runStep(job, androidDir, "./gradlew", ["assembleRelease"], {
            CI: "true",
          });
          checkResults.push({
            name: "Android Native Compilation",
            status: "PASSED",
            icon: "✅",
          });
        } catch (androidErr) {
          checkResults.push({
            name: "Android Native Compilation",
            status: "FAILED",
            icon: "❌",
          });
          throw androidErr;
        }
      }

      // Final Verification Summary
      await log(
        job,
        "═══════════════════════════════════════════════════════════",
        "system",
      );
      await log(job, "Infraxis PR Verification Report:", "system");
      for (const r of checkResults) {
        await log(job, `  ${r.icon} ${r.name}: ${r.status}`, "system");
      }
      await log(
        job,
        "═══════════════════════════════════════════════════════════",
        "system",
      );
    } else {
      throw new Error(`Unsupported job kind: ${job.kind}`);
    }
    exitCode = 0;
  } catch (e) {
    error = e.message;
    if (!currentJobContext?.cancelled) {
      await log(job, `FAILED: ${error}`, "stderr");
    }
  } finally {
    clearInterval(cancelCheckTimer);
    const wasCancelled = currentJobContext?.cancelled;
    const cancelReason =
      currentJobContext?.cancelReason || "Cancelled by administrator";
    currentJobContext = null;

    if (wasCancelled) {
      await log(
        job,
        `[system] ${cancelReason}. Process tree terminated.`,
        "system",
      );
      killWorkspaceProcesses(dir);
      // Stop Gradle daemons if gradle was run
      try {
        const androidDir = path.join(dir, "src/android");
        if (fs.existsSync(androidDir)) {
          const gradlew = path.join(androidDir, "gradlew");
          if (fs.existsSync(gradlew)) {
            require("child_process").execSync("./gradlew --stop", {
              cwd: androidDir,
              stdio: "ignore",
            });
          }
        }
      } catch {}
      // Always remove workspace immediately on cancellation/deletion
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }

    try {
      await flushLogs();
      if (!wasCancelled) {
        await api(`/api/jobs/${job.id}/finish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exit_code: exitCode, error }),
        });
      }
    } catch (e) {
      process.stderr.write(`finish failed: ${e.message}\n`);
    }
    // Keep workspaces for debugging by default. Enable CI_CLEAN_WORKSPACES=true after successful rollout.
    if (process.env.CI_CLEAN_WORKSPACES === "true" && exitCode === 0)
      fs.rmSync(dir, { recursive: true, force: true });
  }
}
let wakeUpResolver = null;

function waitForNextPoll() {
  return new Promise((resolve) => {
    wakeUpResolver = resolve;
    setTimeout(() => {
      wakeUpResolver = null;
      resolve();
    }, POLL_MS);
  });
}

function wakeUpWorker() {
  if (wakeUpResolver) {
    const fn = wakeUpResolver;
    wakeUpResolver = null;
    fn();
  }
}

process.on("message", (msg) => {
  if (msg?.type === "CHECK_NOW") {
    wakeUpWorker();
  } else if (msg?.type === "CANCEL_JOB") {
    if (
      currentJobContext &&
      (!msg.jobId || currentJobContext.id === msg.jobId)
    ) {
      console.log(
        `[Worker] Received IPC CANCEL_JOB for ${msg.jobId || "current job"}. Killing process tree...`,
      );
      cancelCurrentJobProcess("Job cancelled by administrator");
    }
  } else if (msg?.type === "CANCEL_ALL") {
    if (currentJobContext) {
      console.log("[Worker] Received IPC CANCEL_ALL. Killing process tree...");
      cancelCurrentJobProcess("All jobs cancelled by administrator");
    }
  }
});

let heartbeatInterval = null;

function ensureHeartbeatLoop() {
  if (heartbeatInterval) return;
  const sendHeartbeat = async () => {
    try {
      await api("/api/workers/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: WORKER_ID,
          labels: LABELS,
          current_job: currentJobContext?.id || null,
          platform: process.platform,
          version: "0.2.0",
        }),
      });
    } catch {}
  };

  // Send heartbeat every 10 seconds continuously
  heartbeatInterval = setInterval(sendHeartbeat, 10000);
  heartbeatInterval.unref();
  sendHeartbeat().catch(() => {});
}

async function main() {
  console.log(
    `[Infraxis Agent] Worker ${WORKER_ID} online (${process.platform}); labels=${LABELS.join(",")}`,
  );
  ensureHeartbeatLoop();

  while (true) {
    try {
      const result = await api("/api/workers/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: WORKER_ID, labels: LABELS }),
      });
      if (result.job) await execute(result.job);
      else await waitForNextPoll();
    } catch (e) {
      console.error("[Infraxis Agent]", e.message);
      await waitForNextPoll();
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
