export type JobStatus = "queued" | "running" | "claimed" | "succeeded" | "failed" | "cancelled";

export type BuildKind = "android-release" | "ios-release" | "pr-checks";

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

export interface InspectLocalResponse {
  path: string;
  appName: string;
  branch: string;
  commitHash: string;
  commitMsg: string;
  packageManager: "pnpm" | "npm" | "yarn" | "auto";
  isGit: boolean;
  error?: string;
}
