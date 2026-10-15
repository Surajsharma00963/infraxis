"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Terminal,
  StopCircle,
  Trash2,
  X,
  Copy,
  Check,
  Layers,
  Laptop,
  Globe,
  Clock,
  ArrowDownCircle,
  RotateCw,
  CheckCircle2,
  Loader2,
  XCircle,
  MinusCircle,
  PlayCircle,
  FastForward,
} from "lucide-react";
import { Job, LogEntry, PipelineStage } from "../types/ci";
import { apiFetch, isLocalUrl, timeAgo } from "../lib/api";

interface BuildInspectorProps {
  jobId: string;
  token: string;
  job?: Job | null;
  ws?: WebSocket | null;
  onClose: () => void;
  onCancelJob: (id: string) => void;
  onDeleteJob: (id: string) => void;
  onJobStatusChange?: () => void;
  onRebuildJob?: (id: string) => void;
}

export default function BuildInspector({
  jobId,
  token,
  job: jobProp,
  ws,
  onClose,
  onCancelJob,
  onDeleteJob,
  onJobStatusChange,
  onRebuildJob,
}: BuildInspectorProps) {
  const [localJob, setLocalJob] = useState<Job | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [logsText, setLogsText] = useState<string>(
    "Connecting to build stream...",
  );
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  const activeJob = jobProp || localJob;
  const activeJobRef = useRef(activeJob);
  activeJobRef.current = activeJob;

  const lastLogIdRef = useRef<number>(0);
  const terminalRef = useRef<HTMLPreElement | null>(null);

  // Load fallback job data if not in parent state
  useEffect(() => {
    let isCancelled = false;
    async function loadFallbackJob() {
      if (jobProp) return;
      try {
        const fallbackJob = await apiFetch<Job>(
          `/api/jobs/${jobId}`,
          {},
          token,
        );
        if (isCancelled) return;
        if (fallbackJob) setLocalJob(fallbackJob);
      } catch {}
    }
    loadFallbackJob();
    return () => {
      isCancelled = true;
    };
  }, [jobId, token, jobProp]);

  // Load and poll pipeline stages
  useEffect(() => {
    let isCancelled = false;
    async function loadStages() {
      try {
        const res = await apiFetch<PipelineStage[]>(
          `/api/jobs/${jobId}/stages`,
          {},
          token,
        );
        if (!isCancelled && res && Array.isArray(res)) {
          setStages(res);
        }
      } catch {}
    }
    loadStages();

    const isJobActive =
      activeJob && ["queued", "running", "claimed"].includes(activeJob.status);
    let interval: NodeJS.Timeout | null = null;
    if (isJobActive) {
      interval = setInterval(loadStages, 2000);
    }

    return () => {
      isCancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [jobId, token, activeJob?.status]);

  // Real-time WebSocket log streaming
  useEffect(() => {
    lastLogIdRef.current = 0;
    setLogsText("Connecting to live log stream...");

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Fallback one-time fetch if WebSocket is not open
      apiFetch<LogEntry[]>(`/api/jobs/${jobId}/logs`, {}, token)
        .then((logsData) => {
          if (logsData && logsData.length > 0) {
            let chunk = "";
            for (const l of logsData) {
              if (l.id > lastLogIdRef.current) lastLogIdRef.current = l.id;
              const prefix = l.stream === "stderr" ? "🔴 " : "";
              chunk += `[${l.at.slice(11, 19)}] ${prefix}[${l.stream}] ${l.line}\n`;
            }
            setLogsText(chunk);
          } else if (activeJobRef.current) {
            setInitialStatusLog(activeJobRef.current);
          }
        })
        .catch(() => {});
      return;
    }

    // Subscribe to job log stream
    try {
      ws.send(JSON.stringify({ type: "subscribe_job", jobId }));
    } catch {}

    const handleWsMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "job_logs_full" && msg.jobId === jobId) {
          if (msg.logs && msg.logs.length > 0) {
            let chunk = "";
            for (const l of msg.logs) {
              if (l.id > lastLogIdRef.current) lastLogIdRef.current = l.id;
              const prefix = l.stream === "stderr" ? "🔴 " : "";
              chunk += `[${l.at.slice(11, 19)}] ${prefix}[${l.stream}] ${l.line}\n`;
            }
            setLogsText(chunk);
          } else if (activeJobRef.current) {
            setInitialStatusLog(activeJobRef.current);
          }
        } else if (msg.type === "job_logs" && msg.jobId === jobId) {
          if (msg.logs && msg.logs.length > 0) {
            let chunk = "";
            for (const l of msg.logs) {
              if (l.id > lastLogIdRef.current) lastLogIdRef.current = l.id;
              const prefix = l.stream === "stderr" ? "🔴 " : "";
              chunk += `[${l.at.slice(11, 19)}] ${prefix}[${l.stream}] ${l.line}\n`;
            }
            setLogsText((prev) => {
              const base =
                prev.startsWith("[Status:") || prev.startsWith("Connecting")
                  ? ""
                  : prev;
              const updated = base + chunk;
              return updated.length > 300000 ? updated.slice(-300000) : updated;
            });
          }
        }
      } catch {}
    };

    ws.addEventListener("message", handleWsMessage);

    return () => {
      ws.removeEventListener("message", handleWsMessage);
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "unsubscribe_job", jobId }));
        } catch {}
      }
    };
  }, [ws, jobId, token, activeJob?.retry_count]);

  function setInitialStatusLog(j: Job) {
    if (j.status === "queued") {
      setLogsText(
        `[Status: Queued]\nJob ID: ${j.id}\nTarget: ${j.ownerRepo || j.repo} (${j.kind})\nBranch: ${j.branch || "main"} · Commit: ${j.commitHash || j.commit_hash || "HEAD"}\n\nWaiting for an available Infraxis Agent to claim this build...\n`,
      );
    } else if (j.status === "running") {
      setLogsText(
        `[Status: Running]\nJob claimed by Infraxis Agent (${j.worker_id || "active"}). Streaming logs...\n`,
      );
    } else if (j.status === "cancelled") {
      setLogsText(
        `[Status: Cancelled]\nJob was cancelled before execution completed.\n`,
      );
    } else {
      setLogsText(
        `[Status: ${j.status}]\nNo logs recorded. Exit code: ${j.exit_code ?? "N/A"}\n`,
      );
    }
  }

  // Auto scroll effect
  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logsText, autoScroll]);

  const fallbackCopy = (text: string) => {
    try {
      if (typeof document === "undefined") return;
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {}
  };

  const handleCopyLogs = () => {
    try {
      if (
        typeof window !== "undefined" &&
        window.navigator &&
        window.navigator.clipboard &&
        typeof window.navigator.clipboard.writeText === "function"
      ) {
        window.navigator.clipboard
          .writeText(logsText)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => fallbackCopy(logsText));
      } else {
        fallbackCopy(logsText);
      }
    } catch {
      fallbackCopy(logsText);
    }
  };

  const job = activeJob;
  const isLocal = isLocalUrl(job?.cloneUrl || job?.clone_url);
  const isActive = job && ["queued", "running", "claimed"].includes(job.status);
  const isFailed = job && job.status === "failed";

  return (
    <div className="glass-panel-elevated rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 transition-all">
      {/* Inspector Header */}
      <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800/80 bg-slate-50/80 dark:bg-slate-950/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30 font-semibold">
              {job?.kind || "build"}
            </span>
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {job?.ownerRepo || job?.repo || "Loading..."}
            </span>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              {(job?.commitHash || job?.commit_hash || "HEAD").slice(0, 8)}
            </span>
            {job && (
              <span
                className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full capitalize ${
                  job.status === "running"
                    ? "bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/40"
                    : job.status === "queued"
                      ? "bg-amber-50 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/40"
                      : job.status === "claimed"
                        ? "bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/40"
                        : job.status === "succeeded"
                          ? "bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/40"
                          : job.status === "failed"
                            ? "bg-rose-50 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/40"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                }`}
              >
                {job.status}
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
                isLocal
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"
                  : "bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20"
              }`}
            >
              {isLocal ? (
                <Laptop className="w-3 h-3" />
              ) : (
                <Globe className="w-3 h-3" />
              )}
              {isLocal ? "Local Directory" : "Remote Git"}
            </span>
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
            Job ID: {jobId} · Queued{" "}
            {job?.created_at ? timeAgo(job.created_at) : "recently"}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {isActive && (
            <button
              type="button"
              onClick={() => onCancelJob(jobId)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/15 dark:hover:bg-rose-500/25 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30 rounded-lg transition-all cursor-pointer"
            >
              <StopCircle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
              Cancel Build
            </button>
          )}

          {isFailed && onRebuildJob && (
            <button
              type="button"
              onClick={() => onRebuildJob(jobId)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/15 dark:hover:bg-amber-500/25 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30 rounded-lg transition-all cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              Rebuild
            </button>
          )}

          <button
            type="button"
            onClick={() => onDeleteJob(jobId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xs dark:shadow-none transition-all cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            Delete
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg transition-all cursor-pointer"
            title="Close inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Pipeline Execution Stages */}
      {stages.length > 0 && (
        <div className="px-4 py-3 bg-slate-50/90 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800/80 transition-colors">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-blue-500" />
              Pipeline Execution Plan
            </span>
            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                {stages.filter((s) => s.status === "passed").length} passed
              </span>
              <span>•</span>
              <span className="font-medium text-slate-600 dark:text-slate-300">
                {stages.length} total stages
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {stages.map((stage, idx) => {
              const isPassed = stage.status === "passed";
              const isRunning = stage.status === "running";
              const isFailed = stage.status === "failed";
              const isSkipped = stage.status === "skipped";

              return (
                <div
                  key={
                    stage.id ||
                    `${stage.stage_name || stage.name || "stage"}-${idx}`
                  }
                  className="flex items-center shrink-0"
                >
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                      isRunning
                        ? "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300 shadow-xs"
                        : isPassed
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                          : isFailed
                            ? "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300"
                            : isSkipped
                              ? "bg-slate-100 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/60 text-slate-400"
                              : "bg-slate-100/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {isPassed && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    )}
                    {isRunning && (
                      <Loader2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
                    )}
                    {isFailed && (
                      <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                    )}
                    {isSkipped && (
                      <FastForward className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                    {!isPassed && !isRunning && !isFailed && !isSkipped && (
                      <span className="w-3.5 h-3.5 rounded-full border border-slate-300 dark:border-slate-600 text-[10px] flex items-center justify-center text-slate-400">
                        {idx + 1}
                      </span>
                    )}

                    <span className="capitalize whitespace-nowrap">
                      {(stage.stage_name || stage.name || "stage").replace(
                        /-/g,
                        " ",
                      )}
                    </span>

                    {typeof stage.duration_ms === "number" &&
                      stage.duration_ms > 0 && (
                        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                          {(stage.duration_ms / 1000).toFixed(1)}s
                        </span>
                      )}
                  </div>

                  {idx < stages.length - 1 && (
                    <div className="w-3 h-0.5 mx-1 bg-slate-200 dark:bg-slate-800 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Terminal Titlebar */}
      <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between transition-colors">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <span className="text-xs font-mono text-slate-700 dark:text-slate-300">
            terminal: {jobId.slice(0, 8)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
            />
            Auto-scroll
          </label>

          <button
            type="button"
            onClick={handleCopyLogs}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 rounded-md shadow-xs dark:shadow-none transition-all cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-slate-500 dark:text-slate-400" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live Terminal Output */}
      <pre
        ref={terminalRef}
        className="terminal-code p-4 text-[12px] leading-relaxed bg-white dark:bg-[#050811] text-slate-900 dark:text-slate-100 max-h-125 overflow-y-auto whitespace-pre-wrap break-all select-text font-mono transition-colors"
      >
        {logsText}
      </pre>
    </div>
  );
}
