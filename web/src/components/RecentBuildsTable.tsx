"use client";

import React, { useState } from "react";
import {
  ListFilter,
  Search,
  StopCircle,
  Trash2,
  RefreshCw,
  RotateCw,
  ExternalLink,
  Laptop,
  Globe,
  Clock,
  Layers,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Job, JobStatus } from "../types/ci";
import { timeAgo, isLocalUrl } from "../lib/api";

interface RecentBuildsTableProps {
  jobs: Job[];
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
  onCancelJob: (id: string) => void;
  onDeleteJob: (id: string) => void;
  onCancelAll: () => void;
  onClearAll: () => void;
  onRefresh: () => void;
  isLoading: boolean;
  onRebuildJob?: (id: string) => void;
  onRebuildFailed?: () => void;
}

export default function RecentBuildsTable({
  jobs,
  selectedJobId,
  onSelectJob,
  onCancelJob,
  onDeleteJob,
  onCancelAll,
  onClearAll,
  onRefresh,
  isLoading,
  onRebuildJob,
  onRebuildFailed,
}: RecentBuildsTableProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const [activeTab, setActiveTab] = useState<
    "all" | "active" | "succeeded" | "failed" | "cancelled"
  >("all");

  const filteredJobs = jobs.filter((j) => {
    // Tab filter
    if (
      activeTab === "active" &&
      !["queued", "running", "claimed"].includes(j.status)
    ) {
      return false;
    }
    if (activeTab === "succeeded" && j.status !== "succeeded") {
      return false;
    }
    if (activeTab === "failed" && j.status !== "failed") {
      return false;
    }
    if (activeTab === "cancelled" && j.status !== "cancelled") {
      return false;
    }

    // Query search
    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      const matchString =
        `${j.ownerRepo || j.repo} ${j.branch} ${j.commitHash || j.commit_hash} ${j.kind} ${j.id}`.toLowerCase();
      if (!matchString.includes(q)) return false;
    }

    return true;
  });

  const activeCount = jobs.filter((j) =>
    ["queued", "running", "claimed"].includes(j.status),
  ).length;

  const succeededCount = jobs.filter((j) => j.status === "succeeded").length;

  const failedCount = jobs.filter((j) => j.status === "failed").length;

  const cancelledCount = jobs.filter((j) => j.status === "cancelled").length;

  const renderStatusBadge = (status: JobStatus) => {
    switch (status) {
      case "running":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400 animate-ping" />
            running
          </span>
        );
      case "queued":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30">
            <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400 animate-pulse" />
            queued
          </span>
        );
      case "claimed":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30">
            <Activity className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
            claimed
          </span>
        );
      case "succeeded":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            succeeded
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30">
            <XCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
            failed
          </span>
        );
      case "cancelled":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            <AlertTriangle className="w-3 h-3 text-slate-500 dark:text-slate-400" />
            cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="glass-panel-elevated rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 transition-all">
      {/* Table Header */}
      <div className="p-5 border-b border-slate-200 dark:border-slate-800/80 bg-slate-50/80 dark:bg-slate-950/60 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              Recent Builds
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              {jobs.length} builds
              {activeCount > 0 ? ` • ${activeCount} active` : ""}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Live build queue, artifact outputs, and worker task statuses
          </p>
        </div>

        {/* Global Queue Controls */}
        <div className="flex items-center gap-2">
          {failedCount > 0 && onRebuildFailed && (
            <button
              type="button"
              onClick={onRebuildFailed}
              title="Rebuild all failed builds"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/10 dark:hover:bg-amber-500/20 border border-amber-200 dark:border-amber-500/30 rounded-lg shadow-xs dark:shadow-none transition-all cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              Rebuild Failed ({failedCount})
            </button>
          )}
          <button
            type="button"
            onClick={onCancelAll}
            title="Cancel all active builds and kill worker processes"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-300 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 border border-rose-200 dark:border-rose-500/30 rounded-lg shadow-xs dark:shadow-none transition-all cursor-pointer"
          >
            <StopCircle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
            Cancel All
          </button>
          <button
            type="button"
            onClick={onClearAll}
            title="Delete all jobs, logs, and artifacts"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 bg-white dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xs dark:shadow-none transition-all cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            Clear All
          </button>
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh builds list"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 bg-white dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xs dark:shadow-none transition-all cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-blue-500 dark:text-blue-400" : "text-slate-500 dark:text-slate-400"}`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="p-4 bg-slate-50/70 dark:bg-slate-950/40 border-b border-slate-200 dark:border-slate-800/60 flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter by repo, branch, or commit..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all shadow-xs dark:shadow-none"
          />
        </div>

        {/* Tab Pills */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-900/80 rounded-xl border border-slate-200 dark:border-slate-800/80 w-full sm:w-auto">
          {(
            ["all", "active", "succeeded", "failed", "cancelled"] as const
          ).map((tab) => {
            let count = jobs.length;
            if (tab === "active") count = activeCount;
            else if (tab === "succeeded") count = succeededCount;
            else if (tab === "failed") count = failedCount;
            else if (tab === "cancelled") count = cancelledCount;

            const isSelected = activeTab === tab;

            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex-1 sm:flex-none px-3 py-1 text-xs font-medium capitalize rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  isSelected
                    ? "bg-blue-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <span>{tab}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-semibold transition-colors ${
                    isSelected
                      ? "bg-white/25 text-white"
                      : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-100 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800/80 uppercase text-[10px] tracking-wider font-semibold">
            <tr>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Source</th>
              <th className="py-3 px-4">Repository / App</th>
              <th className="py-3 px-4">Workflow</th>
              <th className="py-3 px-4">Branch & Commit</th>
              <th className="py-3 px-4">Queued</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800/50 bg-white dark:bg-transparent">
            {filteredJobs.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="text-center py-12 text-slate-500 dark:text-slate-400"
                >
                  <div className="max-w-xs mx-auto space-y-1">
                    <ListFilter className="w-6 h-6 mx-auto text-slate-400 dark:text-slate-600 mb-2" />
                    <p className="font-medium text-slate-700 dark:text-slate-400">
                      {activeTab === "all"
                        ? "No builds found"
                        : `No ${activeTab} builds found`}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {jobs.length
                        ? "Try switching tabs or adjusting search query"
                        : "Queue a new release build above to get started"}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredJobs.map((j) => {
                const isSelected = j.id === selectedJobId;
                const isLocal = isLocalUrl(j.cloneUrl || j.clone_url);
                const repoName = j.ownerRepo || j.repo;
                const commitShort = (j.commitHash || j.commit_hash || "").slice(
                  0,
                  8,
                );
                const isActive = ["queued", "running", "claimed"].includes(
                  j.status,
                );

                return (
                  <tr
                    key={j.id}
                    onClick={() => onSelectJob(j.id)}
                    className={`cursor-pointer transition-all ${
                      isSelected
                        ? "bg-blue-600/10 border-l-2 border-l-blue-500"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/30"
                    }`}
                  >
                    <td className="py-3.5 px-4 font-medium whitespace-nowrap">
                      {renderStatusBadge(j.status)}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
                          isLocal
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"
                            : "bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20"
                        }`}
                      >
                        {isLocal ? (
                          <>
                            <Laptop className="w-3 h-3" />
                            Local
                          </>
                        ) : (
                          <>
                            <Globe className="w-3 h-3" />
                            Remote
                          </>
                        )}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      <div className="truncate max-w-50" title={repoName}>
                        {repoName}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-medium">
                          {j.kind}
                        </span>
                        {j.package_manager && j.package_manager !== "auto" && (
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20 dark:border-indigo-500/30">
                            {j.package_manager}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 font-mono text-slate-500 dark:text-slate-400">
                        <span className="text-slate-700 dark:text-slate-300">
                          {j.branch || "main"}
                        </span>
                        <span>·</span>
                        <span className="text-[11px] bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                          {commitShort || "HEAD"}
                        </span>
                      </div>
                    </td>

                    <td
                      className="py-3.5 px-4 text-slate-500 dark:text-slate-400 whitespace-nowrap"
                      title={j.created_at}
                    >
                      {timeAgo(j.created_at)}
                    </td>

                    <td
                      className="py-3.5 px-4 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onSelectJob(j.id)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-all cursor-pointer ${
                            isSelected
                              ? "bg-blue-600 text-white border-blue-500 shadow-xs"
                              : "bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                          }`}
                        >
                          {isSelected ? "Viewing" : "Inspect"}
                        </button>

                        {isActive ? (
                          <button
                            type="button"
                            onClick={() => onCancelJob(j.id)}
                            title="Cancel build & kill running process"
                            className="p-1 bg-rose-50 hover:bg-rose-100 dark:bg-transparent dark:hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30 rounded-md transition-all cursor-pointer"
                          >
                            <StopCircle className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <>
                            {j.status === "failed" &&
                              onRebuildJob && (
                                <button
                                  type="button"
                                  onClick={() => onRebuildJob(j.id)}
                                  title="Rebuild this failed build"
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/10 dark:hover:bg-amber-500/20 border border-amber-200 dark:border-amber-500/30 transition-all cursor-pointer"
                                >
                                  <RotateCw className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                  <span>Rebuild</span>
                                </button>
                              )}
                            <button
                              type="button"
                              onClick={() => onDeleteJob(j.id)}
                              title="Delete build from history"
                              className="p-1 bg-white hover:bg-slate-100 dark:bg-transparent dark:hover:bg-slate-700/60 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-md transition-all cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
