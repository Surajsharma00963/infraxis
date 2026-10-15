export type JobStatus =
  | "queued"
  | "running"
  | "claimed"
  | "succeeded"
  | "failed"
  | "cancelled";

export type BuildKind =
  | "pr-checks"
  | "dev-build"
  | "release-build"
  | "custom-pipeline"
  | "android-release"
  | "android-debug"
  | "ios-release"
  | "ios-simulator";

export type PackageManager = "auto" | "pnpm" | "npm" | "yarn";

export interface Job {
  id: string;
  repo: string;
  ownerRepo?: string;
  clone_url: string;
  cloneUrl?: string;
  commit_hash: string;
  commitHash?: string;
  branch: string;
  kind: string;
  package_manager?: string;
  status: JobStatus;
  requested_by: string;
  worker_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  error: string | null;
  retry_count?: number;
  queued_at?: string | null;
  metadata?: Record<string, any>;
  pr_number?: number | null;
  target_app?: string | null;
  project_type?: string | null;
}

export interface PipelineStage {
  id?: string;
  job_id?: string;
  name?: string;
  stage_name?: string;
  category?: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  duration_ms?: number;
  output?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
}

export interface PullRequest {
  id: string;
  repo_id?: string | null;
  repo: string;
  provider: "github" | "bitbucket";
  pr_number: number;
  title: string | null;
  source_branch: string;
  target_branch: string;
  commit_hash: string;
  status:
    | "pending"
    | "running"
    | "success"
    | "failure"
    | "cancelled"
    | "skipped";
  latest_job_id: string | null;
  check_results?: Array<{
    name: string;
    category?: string;
    status: string;
    icon?: string;
    duration_ms?: number;
  }>;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetectionResult {
  path?: string;
  name?: string;
  primaryType: string;
  category: "mobile" | "web" | "backend" | "desktop" | "containers" | "general";
  technologies: string[];
  requiredCapabilities: string[];
  isMonorepo: boolean;
  monorepoType: string | null;
  packageManager?: string;
  subApps: Array<{
    name: string;
    path: string;
    primaryType: string;
    category: string;
    technologies: string[];
  }>;
  hasInfraxisConfig?: boolean;
  hasDockerfile?: boolean;
}

export interface IosSigningIdentity {
  hash: string;
  title: string;
  teamId: string | null;
  type: "development" | "distribution";
}

export interface IosSigningIdentitiesResponse {
  identities: IosSigningIdentity[];
  defaultTeamId: string | null;
  isMac: boolean;
  exportMethods: string[];
}

export interface WorkerInfo {
  id: string;
  labels: string[];
  last_seen: string;
  current_job: string | null;
  online: boolean;
  status?: string;
  platform?: string;
  arch?: string;
  capabilities?: Record<string, boolean>;
  system_info?: Record<string, any>;
  last_heartbeat?: string;
}

export interface LogEntry {
  id: number;
  at: string;
  stream: "stdout" | "stderr" | "system";
  line: string;
}

export interface Artifact {
  id: string;
  job_id: string;
  filename: string;
  path: string;
  size: number;
  created_at: string;
}

export interface PipelineTargetInfo {
  name: string;
  platform: string;
  runtime: string;
  osRequirement: string;
  summary: string;
}

export interface InspectLocalResponse {
  path: string;
  appName: string;
  branch: string;
  commitHash: string;
  commitMsg: string;
  packageManager: "pnpm" | "npm" | "yarn" | "auto";
  isGit: boolean;
  primaryType?: string;
  category?: string;
  technologies?: string[];
  requiredCapabilities?: string[];
  isMonorepo?: boolean;
  monorepoType?: string | null;
  subApps?: Array<{
    name: string;
    path: string;
    primaryType: string;
    category: string;
    technologies: string[];
  }>;
  hasInfraxisConfig?: boolean;
  hasDockerfile?: boolean;
  recommendedProfile?: BuildKind;
  pipelineTarget?: PipelineTargetInfo;
  availableProfiles?: string[];
  suggestedPipelines?: Record<string, any>;
  detection?: ProjectDetectionResult;
  error?: string;
}

export interface GitAccount {
  id: string;
  provider: "github" | "bitbucket";
  accountId: string;
  username: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  authType: "oauth" | "pat";
  scopes?: string[];
  status: "active" | "expired" | "revoked" | "error";
  errorMessage?: string | null;
  lastSyncedAt?: string | null;
  createdAt: string;
}

export interface GitRepository {
  id: string;
  provider: "github" | "bitbucket";
  owner: string;
  name: string;
  fullName: string;
  description: string;
  isPrivate: boolean;
  defaultBranch: string;
  cloneUrl: string;
  htmlUrl: string;
  updatedAt: string;
  topics?: string[];
  language?: string | null;
  starsCount?: number;
  forksCount?: number;
  detectedTech?: Record<string, any>;
  connectedAccountId?: string;
}

export interface GitBranch {
  name: string;
  commitHash?: string;
  isProtected?: boolean;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  url?: string | null;
}

