"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Header from "../components/Header";
import AuthScreen from "../components/AuthScreen";
import QueueBuildForm from "../components/QueueBuildForm";
import RecentBuildsTable from "../components/RecentBuildsTable";
import BuildInspector from "../components/BuildInspector";
import BuildArtifactsTable from "../components/BuildArtifactsTable";
import PullRequestsTable from "../components/PullRequestsTable";
import GitIntegrationsHub from "../components/GitIntegrationsHub";
import {
  Sparkles,
  Smartphone,
  Globe,
  Boxes,
  Terminal,
  Cpu,
  Layers,
  Zap,
  GitPullRequest,
  Activity,
  ArrowUpRight,
} from "lucide-react";
import { Job, WorkerInfo, PullRequest } from "../types/ci";
import {
  apiFetch,
  getStoredToken,
  getWebSocketUrl,
  setStoredToken,
} from "../lib/api";

function areWorkersEqual(prev: WorkerInfo[], next: WorkerInfo[]): boolean {
  if (prev === next) return true;
  if (!prev || !next || prev.length !== next.length) return false;
  return prev.every((w, i) => {
    const nw = next[i];
    return (
      w.id === nw.id &&
      w.online === nw.online &&
      w.status === nw.status &&
      w.platform === nw.platform &&
      w.last_heartbeat === nw.last_heartbeat
    );
  });
}

function areJobsEqual(prev: Job[], next: Job[]): boolean {
  if (prev === next) return true;
  if (!prev || !next || prev.length !== next.length) return false;
  return prev.every((j, i) => {
    const nj = next[i];
    return (
      j.id === nj.id &&
      j.status === nj.status &&
      j.worker_id === nj.worker_id &&
      j.finished_at === nj.finished_at &&
      j.exit_code === nj.exit_code
    );
  });
}

export default function DashboardPage() {
  const [token, setToken] = useState<string>("");
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>("");

  const [jobs, setJobs] = useState<Job[]>([]);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isLoadingJobs, setIsLoadingJobs] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef<boolean>(true);
  const activeTokenRef = useRef<string>("");
  const inspectorSectionRef = useRef<HTMLDivElement | null>(null);

  const safelyCloseWebSocket = (ws: WebSocket | null) => {
    if (!ws) return;
    ws.onmessage = null;
    ws.onerror = null;

    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.close(1000, "Normal closure");
      } catch {}
    } else if (ws.readyState === WebSocket.CONNECTING) {
      // If still connecting during React Fast Refresh / StrictMode unmount,
      // calling ws.close() immediately triggers browser console error:
      // "WebSocket is closed before the connection is established."
      // Defer closure until onopen fires to close cleanly without warning.
      ws.onopen = () => {
        try {
          ws.close(1000, "Normal closure");
        } catch {}
      };
      ws.onclose = null;
    }
  };

  const fetchUserProfile = async (authToken: string) => {
    try {
      const res = await apiFetch<any>("/api/auth/me", {}, authToken);
      if (res && res.user) {
        setCurrentUser(res.user);
      }
    } catch {}

    try {
      const prs = await apiFetch<PullRequest[]>(
        "/api/pull-requests",
        {},
        authToken,
      );
      if (prs && Array.isArray(prs)) {
        setPullRequests(prs);
      }
    } catch {}
  };

  // Connect via WebSocket using provided token
  const connectWithToken = useCallback((bearerToken: string) => {
    const trimmed = bearerToken.trim();
    if (!trimmed) {
      setAuthError("Token cannot be empty");
      return;
    }

    // Avoid duplicate connections if already connected or connecting with same token
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING) &&
      activeTokenRef.current === trimmed
    ) {
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      safelyCloseWebSocket(wsRef.current);
      wsRef.current = null;
    }

    activeTokenRef.current = trimmed;
    shouldReconnectRef.current = true;
    setIsConnecting(true);
    setAuthError("");

    const wsUrl = getWebSocketUrl(trimmed);
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) return;
        setIsConnecting(false);
        setIsConnected(true);
        setStoredToken(trimmed);
        fetchUserProfile(trimmed);
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "init" || msg.type === "snapshot") {
            setJobs(msg.jobs || []);
            setWorkers(msg.workers || []);
            if (msg.pullRequests) setPullRequests(msg.pullRequests);
            setIsLoadingJobs(false);
          } else if (msg.type === "jobs") {
            const nextJobs = msg.jobs || [];
            setJobs((prev) => (areJobsEqual(prev, nextJobs) ? prev : nextJobs));
            setIsLoadingJobs(false);
          } else if (msg.type === "workers") {
            const nextWorkers = msg.workers || [];
            setWorkers((prev) =>
              areWorkersEqual(prev, nextWorkers) ? prev : nextWorkers,
            );
          } else if (msg.type === "pull_requests") {
            setPullRequests(msg.pullRequests || []);
          } else if (msg.type === "error") {
            setAuthError(msg.error || "Authentication failed");
            setIsConnected(false);
            setIsConnecting(false);
          }
        } catch {}
      };

      ws.onerror = () => {
        if (wsRef.current !== ws) return;
        setIsConnecting(false);
      };

      ws.onclose = (event) => {
        if (wsRef.current !== ws) return;
        setIsConnected(false);
        setIsConnecting(false);
        if (event.code === 4401) {
          setAuthError("Invalid admin token (4401)");
          shouldReconnectRef.current = false;
          return;
        }
        // Auto-reconnect if connection dropped unexpectedly
        if (shouldReconnectRef.current && trimmed) {
          reconnectTimeoutRef.current = setTimeout(() => {
            if (shouldReconnectRef.current) {
              connectWithToken(trimmed);
            }
          }, 3000);
        }
      };
    } catch (err: any) {
      setIsConnecting(false);
      setIsConnected(false);
      setAuthError(err.message || "Failed to initialize WebSocket");
    }
  }, []);

  // Initialize token from storage (no hardcoded default token)
  useEffect(() => {
    const saved = getStoredToken();
    if (saved) {
      setToken(saved);
      connectWithToken(saved);
    }
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        safelyCloseWebSocket(wsRef.current);
        wsRef.current = null;
      }
      activeTokenRef.current = "";
    };
  }, [connectWithToken]);

  const handleDisconnect = () => {
    shouldReconnectRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      safelyCloseWebSocket(wsRef.current);
      wsRef.current = null;
    }
    activeTokenRef.current = "";
    setStoredToken("");
    setIsConnected(false);
    setIsConnecting(false);
    setSelectedJobId(null);
    setCurrentUser(null);
    setJobs([]);
    setWorkers([]);
    setPullRequests([]);
  };

  const handleRefresh = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setIsLoadingJobs(true);
      wsRef.current.send(JSON.stringify({ type: "get_state" }));
      setTimeout(() => setIsLoadingJobs(false), 400);
    }
    if (activeTokenRef.current) {
      apiFetch<PullRequest[]>("/api/pull-requests", {}, activeTokenRef.current)
        .then((prs) => {
          if (prs && Array.isArray(prs)) setPullRequests(prs);
        })
        .catch(() => {});
    }
  };

  const handleSelectJob = (id: string) => {
    setSelectedJobId(id);
    setTimeout(() => {
      inspectorSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);
  };

  const handleBuildQueued = (id: string) => {
    handleSelectJob(id);
  };

  const handleCancelJob = async (id: string) => {
    if (
      !confirm(
        `Cancel build ${id.slice(0, 8)} and terminate running process tree?`,
      )
    )
      return;
    try {
      await apiFetch(`/api/jobs/${id}/cancel`, { method: "POST" }, token);
    } catch (err: any) {
      alert(`Cancel failed: ${err.message}`);
    }
  };

  const handleDeleteJob = async (id: string) => {
    if (!confirm(`Delete build ${id.slice(0, 8)} from history?`)) return;
    try {
      await apiFetch(`/api/jobs/${id}`, { method: "DELETE" }, token);
      if (selectedJobId === id) setSelectedJobId(null);
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleCancelAll = async () => {
    if (
      !confirm("Are you sure you want to cancel all queued and running builds?")
    )
      return;
    try {
      const res = await apiFetch<{ cancelled_count: number }>(
        "/api/jobs/cancel-all",
        { method: "POST" },
        token,
      );
      alert(`Cancelled ${res.cancelled_count || 0} active builds.`);
    } catch (err: any) {
      alert(`Cancel all failed: ${err.message}`);
    }
  };

  const handleClearAll = async () => {
    if (
      !confirm(
        "Are you sure you want to delete and clear ALL build history, work folders, and artifacts? This cannot be undone.",
      )
    )
      return;
    try {
      await apiFetch("/api/jobs", { method: "DELETE" }, token);
      setSelectedJobId(null);
      setJobs([]);
      alert("All builds, logs, artifacts, and work folders cleared.");
    } catch (err: any) {
      alert(`Clear all failed: ${err.message}`);
    }
  };

  const handleRebuildJob = async (id: string) => {
    try {
      const newJob = await apiFetch<Job>(
        `/api/jobs/${id}/rebuild`,
        { method: "POST" },
        token,
      );
      if (newJob && newJob.id) {
        setSelectedJobId(newJob.id);
        if (inspectorSectionRef.current) {
          inspectorSectionRef.current.scrollIntoView({ behavior: "smooth" });
        }
      }
    } catch (err: any) {
      alert(`Rebuild failed: ${err.message}`);
    }
  };

  const handleRebuildFailed = async () => {
    try {
      const res = await apiFetch<{ success: boolean; rebuilt_count: number }>(
        "/api/jobs/rebuild-failed",
        { method: "POST" },
        token,
      );
      alert(`Queued ${res.rebuilt_count || 0} rebuilt jobs.`);
    } catch (err: any) {
      alert(`Rebuild failed: ${err.message}`);
    }
  };

  const onlineWorkersCount = workers.filter((w) => w.online).length;
  const activeJobsCount = jobs.filter((j) =>
    ["queued", "running", "claimed"].includes(j.status),
  ).length;
  const pendingPrCount = pullRequests.filter((pr) =>
    ["pending", "running"].includes(pr.status),
  ).length;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-[#070c18] dark:text-slate-100 transition-colors duration-200">
      {/* Top Header */}
      <Header
        token={token}
        onTokenChange={setToken}
        isConnected={isConnected}
        isConnecting={isConnecting}
        onConnect={() => connectWithToken(token)}
        onDisconnect={handleDisconnect}
        workers={workers}
        authError={authError}
        user={currentUser}
      />

      {!isConnected ? (
        <AuthScreen
          onAuthenticate={(t) => {
            setToken(t);
            connectWithToken(t);
          }}
          isConnecting={isConnecting}
          authError={authError}
        />
      ) : (
        /* Main Dashboard Layout */
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-fadeIn">
          {/* Welcome & Platform Overview */}
          <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 dark:border-slate-800/80 bg-gradient-to-br from-white via-slate-50/70 to-blue-50/40 dark:from-slate-900/90 dark:via-[#0a101f]/90 dark:to-slate-900/95 p-6 sm:p-8 shadow-xl dark:shadow-2xl dark:shadow-indigo-950/20 backdrop-blur-xl transition-all space-y-6">
            {/* Ambient Background Glows */}
            <div className="pointer-events-none absolute -top-24 -left-20 w-80 h-80 rounded-full bg-blue-500/10 dark:bg-blue-600/15 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -right-16 w-80 h-80 rounded-full bg-indigo-500/10 dark:bg-purple-600/15 blur-3xl" />

            {/* Tech Dot Matrix Overlay */}
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
              style={{
                backgroundImage:
                  "radial-gradient(currentColor 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }}
            />

            {/* Top Specular Border Highlight */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-500/30 dark:via-blue-400/40 to-transparent" />

            {/* Row 1: Platform Branding & Workflows */}
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
              <div className="space-y-3 max-w-3xl">
                {/* Top Badges */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/25 shadow-xs backdrop-blur-md">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-pulse" />
                    <span>Universal CI/CD & Software Infrastructure</span>
                  </span>

                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 backdrop-blur-md">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    <span>Self-Hosted</span>
                  </span>

                  <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700/70">
                    <Activity className="w-3 h-3 text-cyan-500" />
                    <span>Cluster Active</span>
                  </span>
                </div>

                {/* Primary Headline with Rich Gradient */}
                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.15]">
                  Infrastructure for{" "}
                  <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500 dark:from-blue-400 dark:via-indigo-300 dark:to-sky-300 bg-clip-text text-transparent">
                    every release.
                  </span>
                </h2>

                {/* Tagline Description */}
                <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300/90 leading-relaxed font-normal">
                  Infraxis is a unified self-hosted engineering platform to
                  build, test, and deliver software across mobile, web, desktop,
                  backend, and containers.
                </p>
                <div className="flex flex-wrap items-center gap-2 lg:justify-start">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mr-1 w-full sm:w-auto">
                    Workflows:
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById("queue-build-section")
                        ?.scrollIntoView({ behavior: "smooth" })
                    }
                    className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800/80 hover:bg-sky-50 dark:hover:bg-sky-500/10 border border-slate-200 dark:border-slate-700 hover:border-sky-500/40 text-slate-700 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-300 text-xs font-medium transition-all duration-200 shadow-xs hover:shadow-sm hover:-translate-y-0.5 cursor-pointer"
                    title="Click to queue an iOS or Android build"
                  >
                    <Smartphone className="w-3.5 h-3.5 text-sky-500 transition-transform group-hover:scale-110" />
                    <span>iOS & Android</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById("queue-build-section")
                        ?.scrollIntoView({ behavior: "smooth" })
                    }
                    className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 border border-slate-200 dark:border-slate-700 hover:border-emerald-500/40 text-slate-700 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 text-xs font-medium transition-all duration-200 shadow-xs hover:shadow-sm hover:-translate-y-0.5 cursor-pointer"
                    title="Click to queue a Web or Cloud service build"
                  >
                    <Globe className="w-3.5 h-3.5 text-emerald-500 transition-transform group-hover:scale-110" />
                    <span>Web & Cloud</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById("queue-build-section")
                        ?.scrollIntoView({ behavior: "smooth" })
                    }
                    className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800/80 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 border border-slate-200 dark:border-slate-700 hover:border-indigo-500/40 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 text-xs font-medium transition-all duration-200 shadow-xs hover:shadow-sm hover:-translate-y-0.5 cursor-pointer"
                    title="Click to queue Container builds"
                  >
                    <Boxes className="w-3.5 h-3.5 text-indigo-500 transition-transform group-hover:scale-110" />
                    <span>Containers</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById("pr-checks-section")
                        ?.scrollIntoView({ behavior: "smooth" })
                    }
                    className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800/80 hover:bg-amber-50 dark:hover:bg-amber-500/10 border border-slate-200 dark:border-slate-700 hover:border-amber-500/40 text-slate-700 dark:text-slate-300 hover:text-amber-600 dark:hover:text-amber-400 text-xs font-medium transition-all duration-200 shadow-xs hover:shadow-sm hover:-translate-y-0.5 cursor-pointer"
                    title="Click to view Pull Request checks"
                  >
                    <Terminal className="w-3.5 h-3.5 text-amber-500 transition-transform group-hover:scale-110" />
                    <span>PR Checks</span>
                  </button>
                </div>
              </div>

              {/* Interactive Workflow Badges */}
            </div>

            {/* Row 2: Telemetry Metrics Row (Full Width 3-Column Grid) */}
            <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-4 pt-5 border-t border-slate-200/70 dark:border-slate-800/70">
              {/* Card 1: Infraxis Agents */}
              <div className="relative group p-4 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800/90 hover:border-emerald-500/40 dark:hover:border-emerald-500/40 transition-all duration-200 shadow-xs hover:shadow-md hover:shadow-emerald-500/5 backdrop-blur-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <Cpu className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400 font-bold">
                        Infraxis Agents
                      </span>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="text-2xl font-black text-slate-900 dark:text-white font-mono tracking-tight">
                          {onlineWorkersCount}
                        </span>
                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Online
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700/60">
                    {workers.length} registered
                  </span>
                </div>
                {/* Micro capacity bar */}
                <div className="mt-3 w-full bg-slate-100 dark:bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                    style={{
                      width:
                        workers.length > 0
                          ? `${Math.min(
                              100,
                              Math.round(
                                (onlineWorkersCount / workers.length) * 100,
                              ),
                            )}%`
                          : "0%",
                    }}
                  />
                </div>
              </div>

              {/* Card 2: Total Builds */}
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById("recent-builds-section")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                className="relative group p-4 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800/90 hover:border-blue-500/40 dark:hover:border-blue-500/40 transition-all duration-200 shadow-xs hover:shadow-md hover:shadow-blue-500/5 backdrop-blur-sm text-left cursor-pointer w-full"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <Layers className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400 font-bold">
                        Total Builds
                      </span>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="text-2xl font-black text-slate-900 dark:text-white font-mono tracking-tight">
                          {jobs.length}
                        </span>
                        <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                          Runs
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[11px] font-mono px-2 py-0.5 rounded-md border ${
                        activeJobsCount > 0
                          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 animate-pulse"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700/60"
                      }`}
                    >
                      {activeJobsCount} active
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
                {/* Micro activity bar */}
                <div className="mt-3 w-full bg-slate-100 dark:bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                    style={{
                      width:
                        jobs.length > 0
                          ? `${Math.min(
                              100,
                              Math.max(
                                15,
                                Math.round(
                                  ((jobs.length - activeJobsCount) /
                                    jobs.length) *
                                    100,
                                ),
                              ),
                            )}%`
                          : "0%",
                    }}
                  />
                </div>
              </button>

              {/* Card 3: PR Checks */}
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById("pr-checks-section")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                className="relative group p-4 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/90 dark:border-slate-800/90 hover:border-purple-500/40 dark:hover:border-purple-500/40 transition-all duration-200 shadow-xs hover:shadow-md hover:shadow-purple-500/5 backdrop-blur-sm text-left cursor-pointer w-full"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <GitPullRequest className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400 font-bold">
                        PR Checks
                      </span>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="text-2xl font-black text-slate-900 dark:text-white font-mono tracking-tight">
                          {pullRequests.length}
                        </span>
                        <span className="text-xs font-bold text-purple-600 dark:text-purple-400">
                          Tracked
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[11px] font-mono px-2 py-0.5 rounded-md border ${
                        pendingPrCount > 0
                          ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700/60"
                      }`}
                    >
                      {pendingPrCount} pending
                    </span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-purple-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
                {/* Micro activity bar */}
                <div className="mt-3 w-full bg-slate-100 dark:bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-purple-500 h-1.5 rounded-full transition-all duration-500"
                    style={{
                      width:
                        pullRequests.length > 0
                          ? `${Math.min(
                              100,
                              Math.max(
                                20,
                                Math.round(
                                  ((pullRequests.length - pendingPrCount) /
                                    pullRequests.length) *
                                    100,
                                ),
                              ),
                            )}%`
                          : "100%",
                    }}
                  />
                </div>
              </button>
            </div>
          </section>

          {/* Git Repositories & Integrations Hub */}
          <section id="git-integrations-section">
            <GitIntegrationsHub
              token={token}
              recentJobs={jobs}
              onViewJobLogs={handleSelectJob}
            />
          </section>

          {/* Queue Build Form */}
          <section id="queue-build-section">
            <QueueBuildForm onBuildQueued={handleBuildQueued} token={token} />
          </section>

          {/* Live Inspector Panel */}
          {selectedJobId && (
            <section ref={inspectorSectionRef}>
              <BuildInspector
                jobId={selectedJobId}
                token={token}
                job={jobs.find((j) => j.id === selectedJobId) || null}
                ws={wsRef.current}
                onClose={() => setSelectedJobId(null)}
                onCancelJob={handleCancelJob}
                onDeleteJob={handleDeleteJob}
                onRebuildJob={handleRebuildJob}
              />
            </section>
          )}

          {/* Pull Requests & PR Checks Table */}
          <section id="pr-checks-section">
            <PullRequestsTable
              pullRequests={pullRequests}
              onSelectJob={handleSelectJob}
              onRefresh={handleRefresh}
              isLoading={isLoadingJobs}
            />
          </section>

          {/* Build Artifacts Table (Outside Terminal) */}
          <section id="artifacts-section">
            <BuildArtifactsTable
              token={token}
              selectedJobId={selectedJobId}
              onSelectJob={handleSelectJob}
            />
          </section>

          {/* Recent Builds Table */}
          <section id="recent-builds-section">
            <RecentBuildsTable
              jobs={jobs}
              selectedJobId={selectedJobId}
              onSelectJob={handleSelectJob}
              onCancelJob={handleCancelJob}
              onDeleteJob={handleDeleteJob}
              onCancelAll={handleCancelAll}
              onClearAll={handleClearAll}
              onRefresh={handleRefresh}
              isLoading={isLoadingJobs}
              onRebuildJob={handleRebuildJob}
              onRebuildFailed={handleRebuildFailed}
            />
          </section>
        </main>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-900 bg-white/70 dark:bg-slate-950/60 py-5 text-center text-xs text-slate-500 transition-colors">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>Infraxis Console · Infrastructure for every release.</p>
          <p className="font-mono text-[11px] text-slate-500 dark:text-slate-600">
            Infraxis Core v0.2.0 · PostgreSQL · Next.js 16 + Tailwind CSS v4
          </p>
        </div>
      </footer>
    </div>
  );
}
