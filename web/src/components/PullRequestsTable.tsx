"use client";

import React, { useState } from "react";
import {
  GitPullRequest,
  GitBranch,
  GitCommit,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  RotateCw,
  AlertCircle,
  Filter,
} from "lucide-react";
import { PullRequest } from "../types/ci";

interface PullRequestsTableProps {
  pullRequests: PullRequest[];
  onSelectJob: (jobId: string) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export default function PullRequestsTable({
  pullRequests,
  onSelectJob,
  onRefresh,
  isLoading = false,
}: PullRequestsTableProps) {
  const [filter, setFilter] = useState<
    "all" | "pending" | "success" | "failure"
  >("all");

  const filteredPRs = pullRequests.filter((pr) => {
    if (filter === "all") return true;
    if (filter === "pending") return ["pending", "running"].includes(pr.status);
    if (filter === "success") return pr.status === "success";
    if (filter === "failure")
      return ["failure", "cancelled"].includes(pr.status);
    return true;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Passed
          </span>
        );
      case "running":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Running
          </span>
        );
      case "failure":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
            <XCircle className="w-3.5 h-3.5" />
            Failed
          </span>
        );
      case "cancelled":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
            <AlertCircle className="w-3.5 h-3.5" />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <Clock className="w-3.5 h-3.5" />
            Pending
          </span>
        );
    }
  };

  return (
    <div className="glass-panel rounded-2xl border border-slate-200/90 dark:border-slate-800/80 bg-white dark:bg-slate-900/70 p-6 space-y-5 transition-all shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 flex items-center justify-center">
            <GitPullRequest className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              Pull Request Checks
              <span className="text-xs px-2 py-0.5 rounded-full font-mono font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {pullRequests.length}
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Automatic validation and status reporting for GitHub & Bitbucket
              PRs
            </p>
          </div>
        </div>

        {/* Filters & Refresh */}
        <div className="flex items-center gap-2">
          <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-xs font-medium text-slate-600 dark:text-slate-300">
            {(["all", "pending", "success", "failure"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-lg capitalize transition-all ${
                  filter === f
                    ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs font-semibold"
                    : "hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors disabled:opacity-50"
              title="Refresh PR Checks"
            >
              <RotateCw
                className={`w-4 h-4 ${isLoading ? "animate-spin text-blue-500" : ""}`}
              />
            </button>
          )}
        </div>
      </div>

      {/* Table / List */}
      {filteredPRs.length === 0 ? (
        <div className="py-12 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
          <GitPullRequest className="w-8 h-8 mx-auto text-slate-400 mb-2 opacity-50" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
            No pull requests received yet
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-sm mx-auto">
            Configure GitHub or Bitbucket webhooks to automatically trigger PR
            checks when pull requests are opened or updated.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800/80">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 dark:bg-slate-950/60 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Pull Request</th>
                <th className="py-3 px-4">Branches</th>
                <th className="py-3 px-4">Commit</th>
                <th className="py-3 px-4">Check Status</th>
                <th className="py-3 px-4">Verification Stages</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono text-slate-700 dark:text-slate-300">
              {filteredPRs.map((pr) => (
                <tr
                  key={pr.id}
                  className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-3.5 px-4 font-sans">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
                        #{pr.pr_number}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[220px]">
                        {pr.title || `PR #${pr.pr_number}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-slate-100 dark:bg-slate-800">
                        {pr.provider}
                      </span>
                      <span>{pr.repo}</span>
                    </div>
                  </td>

                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-1.5 text-xs">
                      <GitBranch className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-slate-900 dark:text-slate-200 font-medium">
                        {pr.source_branch}
                      </span>
                      <span className="text-slate-400">→</span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {pr.target_branch}
                      </span>
                    </div>
                  </td>

                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-1.5 font-mono text-xs">
                      <GitCommit className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-slate-800 dark:text-slate-200 font-medium">
                        {pr.commit_hash.slice(0, 7)}
                      </span>
                    </div>
                  </td>

                  <td className="py-3.5 px-4">{getStatusBadge(pr.status)}</td>

                  <td className="py-3.5 px-4 font-sans">
                    {pr.check_results && pr.check_results.length > 0 ? (
                      <div className="flex flex-wrap gap-1 max-w-[240px]">
                        {pr.check_results.map((c, i) => (
                          <span
                            key={i}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                              c.status === "PASSED"
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                : c.status.includes("WARNING")
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                            }`}
                          >
                            <span>{c.icon || "•"}</span>
                            <span>{c.name}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">
                        {pr.status === "pending"
                          ? "Awaiting worker..."
                          : "Checks running"}
                      </span>
                    )}
                  </td>

                  <td className="py-3.5 px-4 text-right">
                    {pr.latest_job_id ? (
                      <button
                        type="button"
                        onClick={() => onSelectJob(pr.latest_job_id!)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/30 dark:hover:text-blue-400 text-slate-700 dark:text-slate-300 transition-colors"
                      >
                        <span>View Build</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
