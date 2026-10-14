"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Header from "../components/Header";
import AuthScreen from "../components/AuthScreen";
import QueueBuildForm from "../components/QueueBuildForm";
import RecentBuildsTable from "../components/RecentBuildsTable";
import BuildInspector from "../components/BuildInspector";
import BuildArtifactsTable from "../components/BuildArtifactsTable";
import {
  Sparkles,
  Smartphone,
  Globe,
  Boxes,
  Terminal,
  Cpu,
  Layers,
  Zap,
} from "lucide-react";
import { Job, WorkerInfo } from "../types/ci";
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
  };

  const handleRefresh = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setIsLoadingJobs(true);
      wsRef.current.send(JSON.stringify({ type: "get_state" }));
      setTimeout(() => setIsLoadingJobs(false), 400);
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
          <section className="glass-panel-elevated rounded-2xl p-6 sm:p-7 border border-slate-200/90 dark:border-slate-800/80 bg-gradient-to-br from-white via-slate-50/70 to-blue-50/30 dark:bg-gradient-to-br dark:from-slate-900/90 dark:via-[#090f1e]/85 dark:to-indigo-950/25 transition-all shadow-xs dark:shadow-none">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              {/* Left Column: Platform Branding & Workflows */}
              <div className="space-y-3 max-w-2xl">
                {/* Top Badges */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gradient-to-r from-blue-500/10 to-indigo-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Universal CI/CD & Software Infrastructure</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Self-Hosted
                  </span>
                </div>

                {/* Primary Headline with subtle gradient */}
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 dark:from-white dark:via-slate-100 dark:to-slate-300 bg-clip-text text-transparent">
                  Infrastructure for every release.
                </h2>

                {/* Tagline Description */}
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  Infraxis is a self-hosted engineering platform to build, test, and
                  deliver software across mobile, web, desktop, backend, and containers.
                </p>

                {/* Supported Target Badges */}
                <div className="pt-1 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-medium text-slate-500 dark:text-slate-400 mr-1">Workflows:</span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-medium">
                    <Smartphone className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
                    <span>iOS & Android</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-medium">
                    <Globe className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                    <span>Web & Cloud</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-medium">
                    <Boxes className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                    <span>Containers</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-medium">
                    <Terminal className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                    <span>PR Checks</span>
                  </span>
                </div>
              </div>

              {/* Right Column: Platform Metrics */}
              <div className="flex flex-col sm:flex-row lg:flex-col gap-3 self-stretch lg:self-center min-w-[240px]">
                {/* Infraxis Agents Stat Card */}
                <div className="p-3.5 rounded-xl bg-gradient-to-r from-slate-50 to-white dark:from-slate-950/80 dark:to-slate-900/40 border border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
                      <Cpu className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                        Infraxis Agents
                      </span>
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        {workers.filter((w) => w.online).length} Online
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">
                    {workers.length} registered
                  </span>
                </div>

                {/* Total Builds Stat Card */}
                <div className="p-3.5 rounded-xl bg-gradient-to-r from-slate-50 to-white dark:from-slate-950/80 dark:to-slate-900/40 border border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
                      <Layers className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase font-mono tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                        Total Builds
                      </span>
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        {jobs.length} Runs
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">
                    {jobs.filter((j) => ["queued", "running", "claimed"].includes(j.status)).length} active
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Queue Build Form */}
          <section>
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

          {/* Build Artifacts Table (Outside Terminal) */}
          <section>
            <BuildArtifactsTable
              token={token}
              selectedJobId={selectedJobId}
              onSelectJob={handleSelectJob}
            />
          </section>

          {/* Recent Builds Table */}
          <section>
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
