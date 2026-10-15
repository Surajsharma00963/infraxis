# Infraxis — Universal CI/CD & Software Infrastructure

**Infrastructure for every release.**

Infraxis is a self-hosted engineering platform to build, test, and deliver software across mobile, web, desktop, backend, and containerized workloads.

While React Native is the first deeply supported mobile use case (with Fastlane, Gradle, and Xcode toolchains), Infraxis is architected as a general-purpose continuous integration control plane with versioned PostgreSQL persistence, atomic queue scheduling, real-time WebSocket telemetry, and resilient remote agents.

> **Naming & Legal Notice:** The name *Infraxis* is a proposed platform identity. Trademark, domain, GitHub organization, and npm package availability checks have not yet been finalized.

---

## Architecture Overview

```
                      ┌──────────────────────────────────────┐
                      │    Infraxis Console (Next.js 16)     │
                      │  Dashboard, Inspector, Forms, Auth   │
                      └──────────────────┬───────────────────┘
                                         │ HTTP / WebSocket (/ws)
                                         ▼
                      ┌──────────────────────────────────────┐
                      │     Infraxis Core (Express & Node)   │
                      │  Auth, Queue, Webhooks, Artifacts    │
                      └──────────────┬──────────────┬────────┘
                                     │              │
                   PostgreSQL (pg)   │              │ Worker Heartbeats / Atomic Claim
     (SELECT FOR UPDATE SKIP LOCKED) │              │ (/api/workers/claim)
                                     ▼              ▼
           ┌───────────────────────────┐      ┌──────────────────────────┐
           │      PostgreSQL 16        │      │      Infraxis Agents     │
           │  Jobs, Attempts, Workers, │      │ macOS (iOS/Android/Sign) │
           │  Logs, Artifacts, Auth    │      │ Linux (PRs/Android/Web)  │
           └───────────────────────────┘      └──────────────────────────┘
```

### Platform Components

| Component | Responsibility | Tech Stack |
|---|---|---|
| **Infraxis Console** | Real-time browser dashboard, manual build submission, live log streaming, artifact downloads, user management | Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Lucide |
| **Infraxis Core** | Central control plane, queue scheduler, webhook signature validation, artifact storage, SSE/WebSocket dispatcher | Node.js (>=20), Express, PostgreSQL (`pg`), optional Redis |
| **Infraxis Agents** | Self-hosted build workers that claim queued jobs atomically and execute isolated build steps | Node.js, Git, Gradle, Xcode, Fastlane |
| **CLI (`infraxis`)** | Command-line management interface for local development, migrations, and remote administration | Planned roadmap |

---

## Key Capabilities

- **PostgreSQL Persistence**: Versioned database migrations, relational integrity, UTC timestamps, JSONB worker capabilities, and audit logs.
- **Atomic Concurrent Job Claiming**: Leverages `SELECT ... FOR UPDATE SKIP LOCKED` inside database transactions so concurrent Infraxis Agents never claim the same job simultaneously, with zero lock contention.
- **Bounded Retries & Stale Worker Recovery**: Heartbeat-based lease expiration automatically detects crashed agents (>90s) and safely requeues jobs up to configurable limits (`max_retries`).
- **Webhook Idempotency**: Deduplicates repeated GitHub (`X-GitHub-Delivery`) and Bitbucket (`X-Hook-UUID`) webhook deliveries using unique idempotency keys.
- **Secure Secret Separation**: Separate tokens for administrators and agents. Sensitive credentials embedded in clone URLs and logs are automatically sanitized.
- **Safe SQLite Migration**: One-time, restartable utility migrates historical users, tokens, OTPs, workers, and jobs into PostgreSQL while keeping the original SQLite database intact.
- **Dual Development & Embedded Modes**: Run Next.js with hot reload on port 3000 during development, or serve the static export (`web/out/`) directly from Infraxis Core on port 8787 in production.

---

## Prerequisites

- **Node.js**: v20.0.0 or higher
- **PostgreSQL**: v14.0 or higher (PostgreSQL 16 recommended)
- **Git**: Installed and accessible in system `PATH`
- **Optional Redis**: v7+ (for multi-node horizontal scaling of real-time WebSocket events)
- **For Mobile Builds**:
  - **macOS Agent**: Xcode (for iOS simulator and store release builds), CocoaPods, Android SDK, compatible JDK
  - **Linux Agent**: Android SDK, compatible JDK, Node.js, Fastlane

---

## 1. Quick Start & PostgreSQL Setup

### Option A: Local PostgreSQL (Homebrew / pgAdmin / Native)

If you already have PostgreSQL installed locally or use pgAdmin:

1. Create the `infraxis` database:
   ```bash
   createdb infraxis
   ```
2. Configure `.env`:
   ```bash
   cp .env.example .env
   ```
   Set `DATABASE_URL` in `.env`:
   ```env
   DATABASE_URL=postgresql://postgres:password@127.0.0.1:5432/infraxis
   ```

### Option B: Docker Compose

For a containerized PostgreSQL and Redis instance without manual service configuration:

```bash
docker compose up -d
```

This starts PostgreSQL on port `5432` and Redis on `6379`.

---

## 2. Configuration (`.env`)

Replace the placeholder tokens in `.env` with secure random tokens:

```bash
# Generate three distinct 32-byte tokens:
openssl rand -hex 32  # For CI_ADMIN_TOKEN
openssl rand -hex 32  # For CI_WORKER_TOKEN
openssl rand -hex 32  # For BITBUCKET_WEBHOOK_TOKEN
```

### Essential Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://127.0.0.1:5432/infraxis` |
| `CI_ADMIN_TOKEN` | Master admin bearer token for API and dashboard access | Required (32+ chars) |
| `CI_WORKER_TOKEN` | Shared authentication token for Infraxis Agents | Required (32+ chars) |
| `BITBUCKET_WEBHOOK_TOKEN` | Token checked in `X-CI-Webhook-Token` header | Required (32+ chars) |
| `GITHUB_WEBHOOK_SECRET` | Secret used to verify GitHub HMAC-SHA256 signatures | Optional |
| `CI_PORT` | HTTP port for Infraxis Core | `8787` |
| `CI_BIND_HOST` | Bind address | `0.0.0.0` |
| `CI_DATA_DIR` | Directory for local runtime data and SQLite backups | `./data` |
| `CI_ARTIFACT_DIR` | Directory for build outputs (APKs, IPAs, logs) | `./artifacts` |
| `REDIS_URL` | Redis URL for multi-node event pub/sub | `redis://127.0.0.1:6379` |

Backward-compatibility note: Both `INFRAXIS_*` and `CI_*` environment variable prefixes are accepted.

---

## 3. Database Migrations

Infraxis Core includes versioned, repeatable SQL migrations located in `server/db/migrations/`.

### Run Pending Migrations

```bash
npm run db:migrate
```

The migration runner records applied migrations in `schema_migrations` and applies new ones inside database transactions.

---

## 4. SQLite Data Migration (Safe Upgrade)

If upgrading from the earlier SQLite version (`data/ci.sqlite`), run the safe migration utility:

```bash
npm run db:migrate-from-sqlite
```

### Safety Guarantees:
- **Zero data loss**: Opens `data/ci.sqlite` in strict **READ-ONLY** mode.
- **Idempotent**: Safe to run repeatedly; uses `ON CONFLICT DO NOTHING` for users, tokens, OTPs, jobs, and attempts.
- **Validation report**: Outputs a table showing copied, skipped, and failed records along with total PostgreSQL record counts.

---

## 5. Starting the Platform

### Development Mode

1. **Start Infraxis Core (Backend)**:
   ```bash
   npm run dev
   ```
   Runs on `http://127.0.0.1:8787`.

2. **Start Infraxis Console (Frontend)**:
   ```bash
   npm run web:dev
   ```
   Runs Next.js with hot module replacement on `http://localhost:3000`. API requests to `/api/*` and WebSocket connections to `/ws` are proxied to `:8787`.

### Production Mode

Build the Next.js static console and run Infraxis Core:

```bash
# 1. Export the frontend static assets to web/out/
npm run web:build

# 2. Start Infraxis Core
npm start
```

Infraxis Core will serve the compiled dashboard directly at `http://127.0.0.1:8787`.

---

## 6. Setting Up Infraxis Agents (Workers)

Infraxis Agents poll Infraxis Core, claim jobs matching their platform labels atomically, stream build logs, and upload artifacts.

### macOS Agent (iOS & Android Releases)

```bash
export INFRAXIS_BASE_URL="http://127.0.0.1:8787"
export INFRAXIS_WORKER_TOKEN="<your CI_WORKER_TOKEN>"
export INFRAXIS_WORKER_ID="mac-agent-01"
export INFRAXIS_WORKER_LABELS="ios,android,release"
export INFRAXIS_WORK_DIR="$HOME/infraxis-work"
export IOS_WORKSPACE="ios/YourApp.xcworkspace"
export IOS_SCHEME="YourApp"

npm run worker
```

Or using the helper script:
```bash
./scripts/dev-worker-mac.sh
```

### Linux Agent (PR Checks & Android Debug Builds)

```bash
export INFRAXIS_BASE_URL="https://your-private-ci.example"
export INFRAXIS_WORKER_TOKEN="<your CI_WORKER_TOKEN>"
export INFRAXIS_WORKER_ID="linux-agent-01"
export INFRAXIS_WORKER_LABELS="linux,android"
export INFRAXIS_WORK_DIR="$HOME/infraxis-work"

npm run worker
```

### Worker Capability Labels

- `pr-checks`: Requires an agent labelled `android`
- `android-debug`: Requires `android`
- `android-release`: Requires `android`
- `ios-simulator`: Requires `ios`
- `ios-release`: Requires `ios`

---

## 7. Webhook Integrations

### GitHub Webhooks

1. Go to repository **Settings > Webhooks > Add webhook**.
2. **Payload URL**: `https://your-ci-host.example/webhooks/github`
3. **Content type**: `application/json`
4. **Secret**: Value matching `GITHUB_WEBHOOK_SECRET` in `.env`.
5. **Events**: Select **Pushes** and **Pull requests**.

GitHub signs payloads with `X-Hub-Signature-256`. Infraxis Core verifies the HMAC SHA-256 signature using constant-time comparison, validates git commit metadata, prevents duplicate jobs via `X-GitHub-Delivery`, and enqueues builds.

### Bitbucket Webhooks

1. Go to repository **Settings > Webhooks > Add webhook**.
2. **URL**: `https://your-ci-host.example/webhooks/bitbucket`
3. **HTTP Header**: Add custom header:
   - Header: `X-CI-Webhook-Token`
   - Value: Value matching `BITBUCKET_WEBHOOK_TOKEN` in `.env`.
4. **Triggers**: **Repository push** and **Pull request created/updated**.

Infraxis Core verifies the token, inspects branch names (including slash-delimited branches like `release/dev`), deduplicates deliveries via `X-Hook-UUID`, and enqueues builds.

---

## 8. Database Backup and Restore

### Backup PostgreSQL

```bash
pg_dump -Fc -d infraxis -f "backup-infraxis-$(date +%Y%m%d%H%M%S).dump"
```

### Restore PostgreSQL

```bash
pg_restore -d infraxis --clean "backup-infraxis-20261013120000.dump"
```

### Artifact Storage Backup

Artifact metadata is tracked in the `artifacts` PostgreSQL table, while binary archives (.apk, .ipa, build tarballs) reside on disk in `CI_ARTIFACT_DIR` (`./artifacts` by default). Back up this folder alongside database dumps:

```bash
tar -czf "artifacts-backup-$(date +%Y%m%d%H%M%S).tar.gz" artifacts/
```

---

## 9. Testing & Quality Verification

Run the automated test suite covering PostgreSQL migrations, concurrency, webhooks, and log ordering:

```bash
npm test
```

Test coverage includes:
- PostgreSQL connection health and schema migration verification.
- Safe SQLite-to-PostgreSQL data migration idempotency.
- Atomic concurrent job claiming under simulated multi-worker contention (`FOR UPDATE SKIP LOCKED`).
- Duplicate webhook delivery prevention for GitHub and Bitbucket.
- Stale worker heartbeat timeout detection and automatic job requeuing.
- Strict status transition validation (preventing stale workers from overwriting completed jobs).
- Deterministic log sequencing and sensitive URL credential redaction.
- User authentication, session tokens, and one-time password (OTP) verification.

---

## 10. GitHub & Bitbucket Repository Integrations

Infraxis supports full repository lifecycle integration with GitHub and Bitbucket Cloud.

### 1. Account Authentication
- **OAuth 2.0**: Connect user or organization accounts via standard OAuth flows.
  - **GitHub Callback URL**: `http://localhost:8787/api/integrations/oauth/github/callback`
  - **Bitbucket Callback URL**: `http://localhost:8787/api/integrations/oauth/bitbucket/callback`
- **Personal Access Tokens (PAT)**: Scoped access tokens can be connected directly from the UI or via API.
- **AES-256-GCM Encryption**: All access and refresh tokens are encrypted at rest on the backend and are never exposed to the frontend console.

### 2. Repository Discovery & Remote Inspection
- Discovers private and public repositories with pagination and real-time search.
- Reads repository trees and manifests (`package.json`, `pubspec.yaml`, `build.gradle`, `Podfile`, `Dockerfile`, `go.mod`, `pom.xml`, `infraxis.yml`) without executing untrusted code.
- Automatically detects frameworks (Next.js, React Native, Expo, Flutter, Android, iOS, Docker, Go, Python, Java, Monorepos).
- Extracts build/test scripts and provides recommended pipeline profiles.

### 3. Build & PR Checks Integration
- Choose branch, commit hash, and pipeline profile to trigger builds on demand.
- Webhooks automatically trigger PR validation jobs on PR open and commit synchronization.
- Real-time commit statuses (`pending`, `success`, `failure`) are published back to GitHub Statuses API and Bitbucket Commit Status API.
- Secure Git Credential Injection: Workers query `/api/jobs/:id/git-credentials` over authenticated channels to inject short-lived Git HTTP authorization headers without saving passwords to disk or embedding them in URLs.

---

## 11. Troubleshooting

### 1. Database Connection Errors (`ECONNREFUSED 127.0.0.1:5432`)
- Check PostgreSQL service status: `pg_isready -h 127.0.0.1 -p 5432`.
- Verify `DATABASE_URL` in `.env` matches your database name, user, and password.
- If using Docker, ensure the container is running: `docker compose ps`.

### 2. Unauthorized Worker (`401 Unauthorized worker`)
- Confirm `CI_WORKER_TOKEN` (or `INFRAXIS_WORKER_TOKEN`) matches between the agent shell and Infraxis Core.
- Check that the token is at least 32 characters long.

### 3. Agent Online But Not Claiming Jobs
- Verify the worker has the required labels matching the queued job kind:
  - Android jobs require `android`.
  - iOS jobs require `ios`.
- Inspect the `/api/workers` response in the dashboard to confirm the worker heartbeat is within the 30-second window.

### 4. Git Authentication on Remote Agents
- Never embed passwords in clone URLs (`https://user:pass@host/repo.git`).
- Set up SSH keys (`git@github.com:...`) or a Git credential helper on each worker machine.

---

## 11. Known Limitations & Roadmap

- **Single-Host Artifacts**: Artifacts are currently persisted to the local filesystem. S3/GCS object storage adapters are planned for distributed agent clusters.
- **Dedicated CLI**: The `infraxis` CLI tool for terminal-based build triggering and queue inspection is under design.
- **Build Isolation**: PR builds execute code from git repositories. For untrusted public pull requests, run Infraxis Agents inside disposable Docker containers or ephemeral virtual machines without mounted host credentials.
