"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  FolderGit2,
  GitBranch,
  GitCommit as GitCommitIcon,
  Globe,
  Lock,
  Search,
  RefreshCw,
  Plus,
  Trash2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldCheck,
  Zap,
  ArrowRight,
  Layers,
  Terminal,
  Cpu,
  Smartphone,
  Server,
  Key,
  Copy,
  Check,
  ChevronRight,
  Sparkles,
  Info,
  Clock,
  Play,
  RotateCw,
} from "lucide-react";
import {
  GitAccount,
  GitRepository,
  GitBranch as GitBranchType,
  GitCommit as GitCommitType,
  BuildKind,
  InspectLocalResponse,
  Job,
} from "../types/ci";
import { apiFetch, getStoredToken, timeAgo } from "../lib/api";

interface GitIntegrationsHubProps {
  token: string;
  onSelectRepoForBuild?: (repoUrl: string, branch?: string, commit?: string, profile?: BuildKind) => void;
  recentJobs?: Job[];
  onViewJobLogs?: (jobId: string) => void;
}

export default function GitIntegrationsHub({
  token,
  onSelectRepoForBuild,
  recentJobs = [],
  onViewJobLogs,
}: GitIntegrationsHubProps) {
  const activeToken = token || getStoredToken();

  // Tab State: "browser" | "accounts" | "selected-repo"
  const [activeTab, setActiveTab] = useState<"browser" | "accounts" | "selected-repo">("browser");

  // Accounts state
  const [accounts, setAccounts] = useState<GitAccount[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState<boolean>(false);
  const [accountActionLoading, setAccountActionLoading] = useState<string | null>(null);
  const [statusInfo, setStatusInfo] = useState<{
    github: { oauthConfigured: boolean; webhookConfigured: boolean; clientId: string | null };
    bitbucket: { oauthConfigured: boolean; webhookConfigured: boolean; clientId: string | null };
  } | null>(null);

  // Connect Token Modal
  const [showConnectModal, setShowConnectModal] = useState<boolean>(false);
  const [connectProvider, setConnectProvider] = useState<"github" | "bitbucket">("github");
  const [patToken, setPatToken] = useState<string>("");
  const [isConnectingPat, setIsConnectingPat] = useState<boolean>(false);
  const [patError, setPatError] = useState<string | null>(null);

  // Repository list state
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState<boolean>(false);
  const [repoSearch, setRepoSearch] = useState<string>("");
  const [providerFilter, setProviderFilter] = useState<"all" | "github" | "bitbucket">("all");
  const [visibilityFilter, setVisibilityFilter] = useState<"all" | "public" | "private">("all");
  const [repoError, setRepoError] = useState<string | null>(null);

  // Selected Repository Detail State
  const [selectedRepo, setSelectedRepo] = useState<GitRepository | null>(null);
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState<boolean>(false);
  const [selectedBranch, setSelectedBranch] = useState<string>("main");
  const [commits, setCommits] = useState<GitCommitType[]>([]);
  const [isLoadingCommits, setIsLoadingCommits] = useState<boolean>(false);
  const [selectedCommit, setSelectedCommit] = useState<string>("HEAD");

  // Detection & Build trigger state
  const [repoDetection, setRepoDetection] = useState<InspectLocalResponse | null>(null);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [buildKind, setBuildKind] = useState<BuildKind>("pr-checks");
  const [isTriggeringBuild, setIsTriggeringBuild] = useState<boolean>(false);
  const [triggerSuccessMsg, setTriggerSuccessMsg] = useState<string | null>(null);
  const [triggerErrorMsg, setTriggerErrorMsg] = useState<string | null>(null);
  const [copiedCloneUrl, setCopiedCloneUrl] = useState<boolean>(false);

  // 1. Fetch Integration Status & Connected Accounts
  const fetchAccounts = useCallback(async () => {
    if (!activeToken) return;
    setIsLoadingAccounts(true);
    try {
      const [accRes, statusRes] = await Promise.all([
        apiFetch<{ accounts: GitAccount[] }>("/api/integrations/accounts", {}, activeToken),
        apiFetch<{
          github: { oauthConfigured: boolean; webhookConfigured: boolean; clientId: string | null };
          bitbucket: { oauthConfigured: boolean; webhookConfigured: boolean; clientId: string | null };
        }>("/api/integrations/status", {}, activeToken).catch(() => null),
      ]);

      setAccounts(accRes.accounts || []);
      if (statusRes) setStatusInfo(statusRes);
    } catch (err: any) {
      console.warn("Failed to fetch accounts:", err.message);
    } finally {
      setIsLoadingAccounts(false);
    }
  }, [activeToken]);

  // 2. Fetch Repositories
  const fetchRepositories = useCallback(async (refresh = false) => {
    if (!activeToken) return;
    setIsLoadingRepos(true);
    setRepoError(null);
    try {
      let url = `/api/integrations/repositories?page=1&per_page=100`;
      if (providerFilter !== "all") url += `&provider=${providerFilter}`;
      if (repoSearch.trim()) url += `&q=${encodeURIComponent(repoSearch.trim())}`;
      if (refresh) url += `&refresh=true`;

      const data = await apiFetch<{
        repositories: GitRepository[];
        noAccountsConnected: boolean;
      }>(url, {}, activeToken);

      setRepositories(data.repositories || []);
    } catch (err: any) {
      setRepoError(err.message || "Failed to load repositories");
    } finally {
      setIsLoadingRepos(false);
    }
  }, [activeToken, providerFilter, repoSearch]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    fetchRepositories();
  }, [fetchRepositories]);

  // Handle URL query parameters for OAuth redirect notifications
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const successProv = params.get("success");
    const errorMsg = params.get("error");
    if (successProv) {
      setActiveTab("accounts");
      fetchAccounts();
      fetchRepositories(true);
      // Clean query params from URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (errorMsg) {
      setPatError(decodeURIComponent(errorMsg));
      setActiveTab("accounts");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [fetchAccounts, fetchRepositories]);

  // Disconnect Account
  const handleDisconnect = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to disconnect ${name}?`)) return;
    setAccountActionLoading(id);
    try {
      await apiFetch(`/api/integrations/accounts/${id}`, { method: "DELETE" }, activeToken);
      await fetchAccounts();
      await fetchRepositories(true);
      if (selectedRepo?.connectedAccountId === id) {
        setSelectedRepo(null);
        setActiveTab("browser");
      }
    } catch (err: any) {
      alert(`Failed to disconnect: ${err.message}`);
    } finally {
      setAccountActionLoading(null);
    }
  };

  // Refresh Account
  const handleRefreshAccount = async (id: string) => {
    setAccountActionLoading(id);
    try {
      await apiFetch(`/api/integrations/accounts/${id}/refresh`, { method: "POST" }, activeToken);
      await fetchAccounts();
      await fetchRepositories(true);
    } catch (err: any) {
      alert(`Refresh failed: ${err.message}`);
    } finally {
      setAccountActionLoading(null);
    }
  };

  // Start OAuth Flow
  const handleStartOAuth = async (provider: "github" | "bitbucket") => {
    try {
      const res = await apiFetch<{ url: string }>(
        `/api/integrations/oauth/${provider}/authorize`,
        {},
        activeToken
      );
      if (res.url) {
        window.location.href = res.url;
      }
    } catch (err: any) {
      alert(`Could not start ${provider} OAuth: ${err.message}`);
    }
  };

  // Connect via PAT
  const handleConnectPat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patToken.trim()) return;
    setIsConnectingPat(true);
    setPatError(null);
    try {
      await apiFetch(
        "/api/integrations/accounts/connect-token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: connectProvider,
            token: patToken.trim(),
          }),
        },
        activeToken
      );
      setShowConnectModal(false);
      setPatToken("");
      await fetchAccounts();
      await fetchRepositories(true);
    } catch (err: any) {
      setPatError(err.message || "Failed to connect token");
    } finally {
      setIsConnectingPat(false);
    }
  };

  // Select Repository & Inspect
  const handleSelectRepository = async (repo: GitRepository) => {
    setSelectedRepo(repo);
    setActiveTab("selected-repo");
    setSelectedBranch(repo.defaultBranch || "main");
    setSelectedCommit("HEAD");
    setTriggerSuccessMsg(null);
    setTriggerErrorMsg(null);

    // 1. Fetch branches
    setIsLoadingBranches(true);
    try {
      const bRes = await apiFetch<{ branches: GitBranchType[] }>(
        `/api/integrations/repositories/${repo.provider}/${repo.owner}/${repo.name}/branches`,
        {},
        activeToken
      );
      setBranches(bRes.branches || []);
    } catch {
      setBranches([{ name: repo.defaultBranch || "main" }]);
    } finally {
      setIsLoadingBranches(false);
    }

    // 2. Fetch commits for default branch
    setIsLoadingCommits(true);
    try {
      const cRes = await apiFetch<{ commits: GitCommitType[] }>(
        `/api/integrations/repositories/${repo.provider}/${repo.owner}/${repo.name}/commits?branch=${encodeURIComponent(
          repo.defaultBranch || "main"
        )}`,
        {},
        activeToken
      );
      setCommits(cRes.commits || []);
      if (cRes.commits && cRes.commits[0]) {
        setSelectedCommit(cRes.commits[0].hash);
      }
    } catch {
      setCommits([]);
    } finally {
      setIsLoadingCommits(false);
    }

    // 3. Trigger remote detection
    setIsDetecting(true);
    try {
      const dRes = await apiFetch<InspectLocalResponse>(
        `/api/integrations/repositories/${repo.provider}/${repo.owner}/${repo.name}/detect?ref=${encodeURIComponent(
          repo.defaultBranch || "HEAD"
        )}`,
        {},
        activeToken
      );
      setRepoDetection(dRes);
      if (dRes.recommendedProfile) {
        setBuildKind(dRes.recommendedProfile);
      } else {
        setBuildKind("pr-checks");
      }
    } catch (err: any) {
      console.warn("Remote detection warning:", err.message);
      setRepoDetection(null);
      setBuildKind("pr-checks");
    } finally {
      setIsDetecting(false);
    }
  };

  // Branch change -> update commits and re-detect
  const handleBranchChange = async (branchName: string) => {
    setSelectedBranch(branchName);
    if (!selectedRepo) return;

    setIsLoadingCommits(true);
    try {
      const cRes = await apiFetch<{ commits: GitCommitType[] }>(
        `/api/integrations/repositories/${selectedRepo.provider}/${selectedRepo.owner}/${selectedRepo.name}/commits?branch=${encodeURIComponent(
          branchName
        )}`,
        {},
        activeToken
      );
      setCommits(cRes.commits || []);
      if (cRes.commits && cRes.commits[0]) {
        setSelectedCommit(cRes.commits[0].hash);
      }
    } catch {
      setCommits([]);
    } finally {
      setIsLoadingCommits(false);
    }
  };

  // Trigger Build via API
  const handleTriggerBuild = async () => {
    if (!selectedRepo) return;
    setIsTriggeringBuild(true);
    setTriggerSuccessMsg(null);
    setTriggerErrorMsg(null);

    try {
      const res = await apiFetch<{ queued: boolean; id: string; kind: string }>(
        `/api/integrations/repositories/${selectedRepo.provider}/${selectedRepo.owner}/${selectedRepo.name}/build`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branch: selectedBranch,
            commitHash: selectedCommit === "HEAD" ? undefined : selectedCommit,
            kind: buildKind,
            packageManager: repoDetection?.packageManager || "auto",
          }),
        },
        activeToken
      );

      setTriggerSuccessMsg(`Build successfully queued! Job ID: ${res.id.slice(0, 8)}`);
    } catch (err: any) {
      setTriggerErrorMsg(err.message || "Failed to trigger build");
    } finally {
      setIsTriggeringBuild(false);
    }
  };

  // Filtered repositories
  const filteredRepositories = useMemo(() => {
    return repositories.filter((r) => {
      if (providerFilter !== "all" && r.provider !== providerFilter) return false;
      if (visibilityFilter === "public" && r.isPrivate) return false;
      if (visibilityFilter === "private" && !r.isPrivate) return false;
      if (repoSearch.trim()) {
        const query = repoSearch.toLowerCase().trim();
        return (
          r.fullName.toLowerCase().includes(query) ||
          (r.description && r.description.toLowerCase().includes(query)) ||
          (r.language && r.language.toLowerCase().includes(query))
        );
      }
      return true;
    });
  }, [repositories, providerFilter, visibilityFilter, repoSearch]);

  // Jobs for selected repository
  const repoRecentJobs = useMemo(() => {
    if (!selectedRepo) return [];
    const cleanName = selectedRepo.fullName.toLowerCase();
    return recentJobs.filter((j) => (j.repo || "").toLowerCase().includes(cleanName));
  }, [selectedRepo, recentJobs]);

  const githubAccount = accounts.find((a) => a.provider === "github");
  const bitbucketAccount = accounts.find((a) => a.provider === "bitbucket");

  return (
    <section className="bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl border border-slate-200 dark:border-slate-800/80 rounded-2xl p-6 shadow-sm mb-8 transition-all">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20">
              <FolderGit2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Git Repositories & Integrations
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                  GitHub & Bitbucket
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Connect accounts, discover repositories, inspect project manifests, and run automated builds & PR checks.
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab("browser")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "browser"
                ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs font-semibold"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <FolderGit2 className="w-3.5 h-3.5" />
            Repositories ({repositories.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("accounts")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "accounts"
                ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs font-semibold"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Connected Accounts ({accounts.length})
          </button>
          {selectedRepo && (
            <button
              type="button"
              onClick={() => setActiveTab("selected-repo")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "selected-repo"
                  ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span className="max-w-[140px] truncate">{selectedRepo.name}</span>
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: CONNECTED ACCOUNTS */}
      {activeTab === "accounts" && (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* GitHub Card */}
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800/80">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 flex items-center justify-center font-bold text-sm shadow-sm">
                      <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">GitHub</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">OAuth & Personal Access Token</p>
                    </div>
                  </div>
                  {githubAccount ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Connected
                    </span>
                  ) : (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium">
                      Not Connected
                    </span>
                  )}
                </div>

                {/* Account Details or Connect Prompt */}
                {githubAccount ? (
                  <div className="py-4 space-y-3">
                    <div className="flex items-center gap-3">
                      {githubAccount.avatarUrl ? (
                        <img
                          src={githubAccount.avatarUrl}
                          alt={githubAccount.username}
                          className="w-10 h-10 rounded-full border border-slate-200 dark:border-slate-800"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center font-bold text-blue-500">
                          {githubAccount.username[0]?.toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                          {githubAccount.displayName || githubAccount.username}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          @{githubAccount.username} · {githubAccount.authType.toUpperCase()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 pt-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Last synced {timeAgo(githubAccount.lastSyncedAt || githubAccount.createdAt)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="py-4">
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                      Connect your GitHub account to access private repositories, view pull requests, and publish check statuses directly to commits.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800">repo</span>
                      <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800">read:user</span>
                      <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800">Least-Privilege</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-2">
                {githubAccount ? (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(accountActionLoading)}
                      onClick={() => handleRefreshAccount(githubAccount.id)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCw className={`w-3.5 h-3.5 ${accountActionLoading === githubAccount.id ? "animate-spin" : ""}`} />
                      Sync Repos
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(accountActionLoading)}
                      onClick={() => handleDisconnect(githubAccount.id, "GitHub")}
                      className="px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-2 w-full">
                    {statusInfo?.github.oauthConfigured ? (
                      <button
                        type="button"
                        onClick={() => handleStartOAuth("github")}
                        className="flex-1 px-3 py-2 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Connect OAuth
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setConnectProvider("github");
                        setPatToken("");
                        setShowConnectModal(true);
                      }}
                      className="flex-1 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-200/70 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Key className="w-3.5 h-3.5" />
                      Add Access Token (PAT)
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Bitbucket Card */}
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800/80">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-sm shadow-blue-500/20">
                      <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                        <path d="M2.663 3.666A1.666 1.666 0 0 0 1 5.334v.228l2.96 15.076a1.666 1.666 0 0 0 1.637 1.346h12.806a1.666 1.666 0 0 0 1.638-1.346L23 5.562V5.334a1.666 1.666 0 0 0-1.663-1.668H2.663zm11.75 12.834h-4.826L8.25 9.833h7.5l-1.337 6.667z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Bitbucket</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">OAuth 2.0 & Workspace Token</p>
                    </div>
                  </div>
                  {bitbucketAccount ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Connected
                    </span>
                  ) : (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium">
                      Not Connected
                    </span>
                  )}
                </div>

                {/* Account Details or Connect Prompt */}
                {bitbucketAccount ? (
                  <div className="py-4 space-y-3">
                    <div className="flex items-center gap-3">
                      {bitbucketAccount.avatarUrl ? (
                        <img
                          src={bitbucketAccount.avatarUrl}
                          alt={bitbucketAccount.username}
                          className="w-10 h-10 rounded-full border border-slate-200 dark:border-slate-800"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center font-bold text-blue-500">
                          {bitbucketAccount.username[0]?.toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                          {bitbucketAccount.displayName || bitbucketAccount.username}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          @{bitbucketAccount.username} · {bitbucketAccount.authType.toUpperCase()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 pt-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Last synced {timeAgo(bitbucketAccount.lastSyncedAt || bitbucketAccount.createdAt)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="py-4">
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                      Connect your Bitbucket Cloud workspaces to run pipelines on branches and post build statuses to Pull Requests automatically.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800">repository</span>
                      <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800">pullrequest</span>
                      <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800">account</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-2">
                {bitbucketAccount ? (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(accountActionLoading)}
                      onClick={() => handleRefreshAccount(bitbucketAccount.id)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCw className={`w-3.5 h-3.5 ${accountActionLoading === bitbucketAccount.id ? "animate-spin" : ""}`} />
                      Sync Repos
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(accountActionLoading)}
                      onClick={() => handleDisconnect(bitbucketAccount.id, "Bitbucket")}
                      className="px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                  </>
                ) : (
                  <div className="flex items-center gap-2 w-full">
                    {statusInfo?.bitbucket.oauthConfigured ? (
                      <button
                        type="button"
                        onClick={() => handleStartOAuth("bitbucket")}
                        className="flex-1 px-3 py-2 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Connect OAuth
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setConnectProvider("bitbucket");
                        setPatToken("");
                        setShowConnectModal(true);
                      }}
                      className="flex-1 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-200/70 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Key className="w-3.5 h-3.5" />
                      Add Workspace Token
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: REPOSITORY BROWSER */}
      {activeTab === "browser" && (
        <div className="mt-6 space-y-4">
          {/* Controls Bar: Search, Provider Filter, Visibility Filter, Refresh */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-1 items-center gap-2 max-w-md">
              <div className="relative w-full">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search repositories by name, owner, or topic..."
                  value={repoSearch}
                  onChange={(e) => setRepoSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Provider Filter */}
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs">
                {(["all", "github", "bitbucket"] as const).map((prov) => (
                  <button
                    key={prov}
                    type="button"
                    onClick={() => setProviderFilter(prov)}
                    className={`px-2.5 py-1 rounded-lg transition-all capitalize cursor-pointer ${
                      providerFilter === prov
                        ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold shadow-xs"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                    }`}
                  >
                    {prov}
                  </button>
                ))}
              </div>

              {/* Visibility Filter */}
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs">
                {(["all", "private", "public"] as const).map((vis) => (
                  <button
                    key={vis}
                    type="button"
                    onClick={() => setVisibilityFilter(vis)}
                    className={`px-2.5 py-1 rounded-lg transition-all capitalize cursor-pointer ${
                      visibilityFilter === vis
                        ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold shadow-xs"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                    }`}
                  >
                    {vis}
                  </button>
                ))}
              </div>

              {/* Refresh Button */}
              <button
                type="button"
                disabled={isLoadingRepos}
                onClick={() => fetchRepositories(true)}
                className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                title="Fetch live updates from git providers"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRepos ? "animate-spin" : ""}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {/* Error Message */}
          {repoError && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{repoError}</span>
            </div>
          )}

          {/* Repositories Grid */}
          {isLoadingRepos ? (
            <div className="py-16 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-3" />
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Fetching accessible repositories from GitHub and Bitbucket...
              </p>
            </div>
          ) : filteredRepositories.length === 0 ? (
            <div className="py-16 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl p-8">
              <FolderGit2 className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">
                {accounts.length === 0 ? "No Git Accounts Connected" : "No Repositories Found"}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-4">
                {accounts.length === 0
                  ? "Connect your GitHub or Bitbucket account to discover private and public projects."
                  : "No repositories matched your search or filters. Try adjusting your search query or refreshing the repository list."}
              </p>
              {accounts.length === 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab("accounts")}
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-500 transition-all cursor-pointer shadow-sm shadow-blue-500/20"
                >
                  Connect Git Account
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {filteredRepositories.map((repo) => (
                <div
                  key={`${repo.provider}-${repo.fullName}`}
                  onClick={() => handleSelectRepository(repo)}
                  className="group relative p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 hover:bg-white dark:hover:bg-slate-900/90 hover:border-blue-500/50 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 truncate">
                        {repo.provider === "github" ? (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-900 text-white dark:bg-white dark:text-slate-900">
                            GH
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-600 text-white">
                            BB
                          </span>
                        )}
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate group-hover:text-blue-500 transition-colors">
                          {repo.fullName}
                        </span>
                      </div>
                      {repo.isPrivate ? (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium">
                          <Lock className="w-2.5 h-2.5" />
                          Private
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                          <Globe className="w-2.5 h-2.5" />
                          Public
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 min-h-[32px] mb-3 leading-relaxed">
                      {repo.description || "No description provided for this repository."}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                    <div className="flex items-center gap-1 font-mono">
                      <GitBranch className="w-3 h-3 text-slate-400" />
                      <span>{repo.defaultBranch || "main"}</span>
                    </div>
                    <div className="flex items-center gap-1 text-blue-500 dark:text-blue-400 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                      <span>Inspect</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: SELECTED REPOSITORY & BUILD LAUNCHER */}
      {activeTab === "selected-repo" && selectedRepo && (
        <div className="mt-6 space-y-6">
          {/* Top Banner */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
                <FolderGit2 className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {selectedRepo.fullName}
                  </h3>
                  {selectedRepo.isPrivate ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium">
                      Private
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                      Public
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Provider: <span className="capitalize font-semibold">{selectedRepo.provider}</span> · Default Branch: <span className="font-mono">{selectedRepo.defaultBranch}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={selectedRepo.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View on {selectedRepo.provider === "github" ? "GitHub" : "Bitbucket"}
              </a>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(selectedRepo.cloneUrl);
                  setCopiedCloneUrl(true);
                  setTimeout(() => setCopiedCloneUrl(false), 2000);
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
              >
                {copiedCloneUrl ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedCloneUrl ? "Copied" : "Copy Clone URL"}
              </button>
            </div>
          </div>

          {/* Technology Detection & Config Card */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              Manifest Detection & Recommended Toolchains
            </h4>

            {isDetecting ? (
              <div className="py-6 flex items-center justify-center gap-2 text-xs text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                <span>Scanning repository trees and manifests through provider API...</span>
              </div>
            ) : repoDetection ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800/80">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Primary Framework</span>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase mt-0.5">
                      {repoDetection.primaryType || "General"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800/80">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Category</span>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 capitalize mt-0.5">
                      {repoDetection.category || "General"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800/80">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Package Manager</span>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 capitalize mt-0.5">
                      {repoDetection.packageManager || "npm"}
                    </p>
                  </div>
                </div>

                {/* Technologies List */}
                {repoDetection.technologies && repoDetection.technologies.length > 0 && (
                  <div>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                      Detected Frameworks & Technologies:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {repoDetection.technologies.map((t) => (
                        <span
                          key={t}
                          className="px-2.5 py-1 text-xs font-medium rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sub-Apps list if monorepo / multi-app */}
                {repoDetection.subApps && repoDetection.subApps.length > 0 && (
                  <div>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                      Discovered Workspace Sub-Projects:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {repoDetection.subApps.map((sub) => (
                        <span
                          key={sub.path}
                          className="px-2.5 py-1 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                        >
                          <strong className="font-semibold">{sub.name}</strong>{" "}
                          <span className="text-slate-400 text-[11px]">({sub.path})</span> ·{" "}
                          <span className="uppercase text-[10px] font-bold text-blue-600 dark:text-blue-400">
                            {sub.primaryType}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Custom infraxis.yml notice */}
                {repoDetection.hasInfraxisConfig && (
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Custom <strong>infraxis.yml</strong> pipeline detected and loaded from repository root!</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No detection metadata available for this repository.</p>
            )}
          </div>

          {/* Build Configurator */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs space-y-4">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-500" />
              Build & PR Check Launcher
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Branch Selector */}
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                  Select Branch
                </label>
                <div className="relative">
                  <select
                    value={selectedBranch}
                    onChange={(e) => handleBranchChange(e.target.value)}
                    disabled={isLoadingBranches}
                    className="w-full px-3 py-2 text-xs bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer"
                  >
                    {branches.length > 0 ? (
                      branches.map((b) => (
                        <option key={b.name} value={b.name}>
                          {b.name}
                        </option>
                      ))
                    ) : (
                      <option value="main">main</option>
                    )}
                  </select>
                </div>
              </div>

              {/* Build Profile Selector */}
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                  Pipeline Profile
                </label>
                <select
                  value={buildKind}
                  onChange={(e) => setBuildKind(e.target.value as BuildKind)}
                  className="w-full px-3 py-2 text-xs bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer"
                >
                  <option value="pr-checks">PR Checks (Fast Validation, Lint, Tests)</option>
                  <option value="release-build">Release Build (Binaries & Artifacts)</option>
                  <option value="dev-build">Dev Build (Fast Compilation)</option>
                  <option value="android-release">Android Release (APK & AAB Packaging)</option>
                  <option value="ios-release">Apple iOS Release (Xcode Archive)</option>
                  <option value="custom-pipeline">Custom infraxis.yml Pipeline</option>
                </select>
              </div>
            </div>

            {/* Recent Commits Selector */}
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5 flex items-center justify-between">
                <span>Target Commit (Branch: {selectedBranch})</span>
                {isLoadingCommits && <span className="text-[10px] text-blue-500 animate-pulse">Loading commits...</span>}
              </label>
              <select
                value={selectedCommit}
                onChange={(e) => setSelectedCommit(e.target.value)}
                disabled={isLoadingCommits || commits.length === 0}
                className="w-full px-3 py-2 text-xs bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer font-mono"
              >
                <option value="HEAD">HEAD (Latest commit on {selectedBranch})</option>
                {commits.map((c) => (
                  <option key={c.hash} value={c.hash}>
                    {c.shortHash} — {c.message.slice(0, 60)} ({c.author})
                  </option>
                ))}
              </select>
            </div>

            {/* Notification messages */}
            {triggerSuccessMsg && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{triggerSuccessMsg}</span>
              </div>
            )}
            {triggerErrorMsg && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{triggerErrorMsg}</span>
              </div>
            )}

            {/* Trigger Button */}
            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (onSelectRepoForBuild) {
                    onSelectRepoForBuild(selectedRepo.cloneUrl, selectedBranch, selectedCommit, buildKind);
                  }
                }}
                className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl transition-all cursor-pointer"
              >
                Open in Full Build Form
              </button>
              <button
                type="button"
                disabled={isTriggeringBuild}
                onClick={handleTriggerBuild}
                className="px-5 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-md shadow-blue-500/20 disabled:opacity-50"
              >
                {isTriggeringBuild ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-current" />
                )}
                <span>Trigger Build Now</span>
              </button>
            </div>
          </div>

          {/* Repository Build History */}
          {repoRecentJobs.length > 0 && (
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-xs">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-3">
                Recent Builds for {selectedRepo.name}
              </h4>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {repoRecentJobs.slice(0, 5).map((j) => (
                  <div key={j.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          j.status === "succeeded"
                            ? "bg-emerald-500"
                            : j.status === "failed"
                            ? "bg-rose-500"
                            : j.status === "running"
                            ? "bg-blue-500 animate-ping"
                            : "bg-slate-400"
                        }`}
                      />
                      <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        {j.id.slice(0, 8)}
                      </span>
                      <span className="text-slate-500">· {j.kind}</span>
                      <span className="font-mono text-slate-400 text-[11px]">({j.branch})</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-400">{timeAgo(j.created_at)}</span>
                      {onViewJobLogs && (
                        <button
                          type="button"
                          onClick={() => onViewJobLogs(j.id)}
                          className="text-blue-500 hover:underline text-[11px] font-semibold cursor-pointer"
                        >
                          Logs
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* CONNECT TOKEN MODAL */}
      {showConnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-scaleUp">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 mb-1 flex items-center gap-2">
              <Key className="w-5 h-5 text-blue-500" />
              Connect {connectProvider === "github" ? "GitHub" : "Bitbucket"} Token
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
              Enter a Personal Access Token (PAT) with read repository and PR check scopes. Credentials are encrypted at rest with AES-256-GCM and never exposed to the browser.
            </p>

            <form onSubmit={handleConnectPat} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Access Token
                </label>
                <input
                  type="password"
                  placeholder={connectProvider === "github" ? "ghp_xxxxxxxxxxxxxxxxxxxx" : "workspace-access-token"}
                  value={patToken}
                  onChange={(e) => setPatToken(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>

              {patError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">
                  {patError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConnectModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isConnectingPat || !patToken.trim()}
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isConnectingPat ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>Connect Account</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
