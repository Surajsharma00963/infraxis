"use client";

import React, { useState, useEffect } from "react";
import { Package, Download, RotateCw, Loader2 } from "lucide-react";
import { Artifact } from "../types/ci";
import { apiFetch, downloadArtifactFile, timeAgo } from "../lib/api";

interface ExtendedArtifact extends Artifact {
  repo?: string;
  kind?: string;
  branch?: string;
  commit_hash?: string;
}

interface BuildArtifactsTableProps {
  token: string;
  selectedJobId?: string | null;
  onSelectJob?: (jobId: string) => void;
}

export default function BuildArtifactsTable({
  token,
  selectedJobId,
  onSelectJob,
}: BuildArtifactsTableProps) {
  const [artifacts, setArtifacts] = useState<ExtendedArtifact[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<"all" | "selected">("all");

  // useEffect(() => {
  //   if (selectedJobId) {
  //     setFilterMode("selected");
  //   }
  // }, [selectedJobId]);

  const fetchArtifacts = async (silent = false) => {
    if (!token) return;
    if (!silent) setIsRefreshing(true);
    try {
      let url = "/api/artifacts";
      if (filterMode === "selected" && selectedJobId) {
        url = `/api/jobs/${selectedJobId}/artifacts`;
      }
      const data = await apiFetch<ExtendedArtifact[]>(url, {}, token);
      if (Array.isArray(data)) {
        setArtifacts(data);
        return;
      }
    } catch {
      // If /api/artifacts returned non-JSON, fallback to job-specific endpoint if available
      if (selectedJobId) {
        try {
          const fallbackData = await apiFetch<ExtendedArtifact[]>(
            `/api/jobs/${selectedJobId}/artifacts`,
            {},
            token,
          );
          if (Array.isArray(fallbackData)) {
            setArtifacts(fallbackData);
            return;
          }
        } catch {}
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchArtifacts(false);
  }, [token, filterMode, selectedJobId]);

  const handleDownload = async (id: string, filename: string) => {
    try {
      setDownloadingId(id);
      await downloadArtifactFile(id, filename, token);
    } catch (err: any) {
      alert(`Failed to download artifact: ${err?.message || "Unknown error"}`);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="glass-panel-elevated rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 transition-all">
      {/* Panel Header */}
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800/80 bg-slate-50/80 dark:bg-slate-950/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center">
            <Package className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                Build Artifacts
              </h3>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                {artifacts.length}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Generated packages, application bundles, and release deliverables
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* {selectedJobId && (
            <div className="flex items-center bg-slate-100 dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setFilterMode("selected")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                  filterMode === "selected"
                    ? "bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                Selected Build ({selectedJobId.slice(0, 8)})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                  filterMode === "all"
                    ? "bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                All Builds
              </button>
            </div>
          )} */}

          <button
            type="button"
            onClick={() => fetchArtifacts(false)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xs dark:shadow-none transition-all cursor-pointer"
            title="Refresh artifacts list"
          >
            <RotateCw
              className={`w-3.5 h-3.5 text-slate-500 dark:text-slate-400 ${
                isRefreshing ? "animate-spin" : ""
              }`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Artifacts Table */}
      {isLoading ? (
        <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
          Loading artifacts...
        </div>
      ) : artifacts.length === 0 ? (
        <div className="p-8 text-center bg-white dark:bg-slate-900/30">
          <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center justify-center mx-auto mb-3 text-slate-400 dark:text-slate-500">
            <Package className="w-6 h-6" />
          </div>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            No build artifacts generated yet.
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
            When{" "}
            <code className="font-mono text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
              assembleRelease
            </code>{" "}
            or an iOS archive completes successfully, the compiled APK, AAB, or
            IPA will appear here in this table.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800/80 bg-slate-100/70 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Artifact Name</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Build / Job</th>
                <th className="py-3 px-4">File Size</th>
                <th className="py-3 px-4">Generated</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/50 bg-white dark:bg-slate-900/20">
              {artifacts.map((a) => {
                const ext =
                  a.filename.split(".").pop()?.toUpperCase() || "FILE";
                const sizeMB = (a.size / 1024 / 1024).toFixed(2);
                const isApk = a.filename.endsWith(".apk");
                const isAab = a.filename.endsWith(".aab");
                const isIpa = a.filename.endsWith(".ipa");
                const isDownloading = downloadingId === a.id;

                return (
                  <tr
                    key={a.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <span className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
                          <Package className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        </span>
                        <div className="min-w-0 max-w-xs sm:max-w-md">
                          <p
                            className="font-medium text-slate-900 dark:text-slate-100 font-mono text-xs truncate"
                            title={a.filename}
                          >
                            {a.filename}
                          </p>
                          <p
                            className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate mt-0.5"
                            title={a.path}
                          >
                            {a.path}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase ${
                          isApk
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : isAab
                              ? "bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20"
                              : isIpa
                                ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20"
                                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                        }`}
                      >
                        {ext}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {a.job_id && onSelectJob ? (
                        <button
                          type="button"
                          onClick={() => onSelectJob(a.job_id)}
                          className="font-mono text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                          title={`View build ${a.job_id}`}
                        >
                          {a.repo ? `${a.repo} · ` : ""}
                          {a.job_id.slice(0, 8)}
                        </button>
                      ) : (
                        <span className="font-mono text-slate-500 dark:text-slate-400">
                          {a.job_id ? a.job_id.slice(0, 8) : "—"}
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap font-mono text-slate-700 dark:text-slate-300">
                      {sizeMB} MB
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                      <span title={new Date(a.created_at).toLocaleString()}>
                        {timeAgo(a.created_at)}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={() => handleDownload(a.id, a.filename)}
                        disabled={isDownloading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-lg shadow-xs hover:shadow transition-all font-semibold text-xs cursor-pointer disabled:opacity-50"
                        title="Download artifact"
                      >
                        {isDownloading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        Download
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
