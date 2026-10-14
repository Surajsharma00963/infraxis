"use client";

import React, { useState, useEffect } from "react";
import {
  FolderGit2,
  Globe,
  Zap,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Layers,
  Box,
  GitBranch,
  GitCommit,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import {
  BuildKind,
  PackageManager,
  InspectLocalResponse,
  IosSigningIdentity,
  IosSigningIdentitiesResponse,
} from "../types/ci";
import { apiFetch, getStoredToken, isLocalUrl } from "../lib/api";

interface QueueBuildFormProps {
  onBuildQueued: (jobId: string) => void;
  token: string;
}

export default function QueueBuildForm({
  onBuildQueued,
  token,
}: QueueBuildFormProps) {
  const [mode, setMode] = useState<"local" | "remote">("local");
  const [cloneUrl, setCloneUrl] = useState("");
  const [repo, setRepo] = useState("");
  const [commit, setCommit] = useState("");
  const [branch, setBranch] = useState("");
  const [kind, setKind] = useState<BuildKind>("android-release");
  const [packageManager, setPackageManager] = useState<PackageManager>("auto");

  // Dynamic iOS Code Signing & Export State
  const [iosIdentities, setIosIdentities] = useState<IosSigningIdentity[]>([]);
  const [selectedIosIdentity, setSelectedIosIdentity] = useState<string>("auto");
  const [iosExportMethod, setIosExportMethod] = useState<string>("development");
  const [iosTeamId, setIosTeamId] = useState<string>("");
  const [isLoadingIdentities, setIsLoadingIdentities] = useState<boolean>(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectHint, setInspectHint] = useState<string>("");
  const [message, setMessage] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  // Auto-fetch available iOS signing identities from host
  useEffect(() => {
    if (kind !== "ios-release") return;
    const activeToken = token || getStoredToken();
    if (!activeToken) return;

    let isMounted = true;
    setIsLoadingIdentities(true);
    apiFetch<IosSigningIdentitiesResponse>(
      "/api/ios/signing-identities",
      {},
      activeToken,
    )
      .then((data) => {
        if (!isMounted) return;
        if (data && Array.isArray(data.identities)) {
          setIosIdentities(data.identities);
          if (data.defaultTeamId && !iosTeamId) {
            setIosTeamId(data.defaultTeamId);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setIsLoadingIdentities(false);
      });

    return () => {
      isMounted = false;
    };
  }, [kind, token]);

  // Auto-inspect local path when cloneUrl changes
  useEffect(() => {
    const activeToken = token || getStoredToken();
    if (!cloneUrl || !isLocalUrl(cloneUrl)) {
      setInspectHint("");
      return;
    }

    if (!activeToken) {
      setInspectHint("Connect with admin token in header to auto-inspect");
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsInspecting(true);
        const data: InspectLocalResponse = await apiFetch(
          `/api/inspect-local?path=${encodeURIComponent(cloneUrl)}`,
          {},
          activeToken,
        );
        if (data && !data.error) {
          if (data.appName) setRepo(data.appName);
          if (data.branch) setBranch(data.branch);
          if (data.commitHash) setCommit(data.commitHash);
          if (data.packageManager && data.packageManager !== "auto") {
            setPackageManager(data.packageManager as PackageManager);
          }
          setInspectHint(
            `Detected: ${data.packageManager.toUpperCase()} · ${data.appName} (${data.branch})`,
          );
        }
      } catch {
        setInspectHint("");
      } finally {
        setIsInspecting(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [cloneUrl, token]);

  const handleReset = () => {
    setMessage(null);
    setCloneUrl("");
    setRepo("");
    setCommit("");
    setBranch("");
    setKind("android-release");
    setPackageManager("auto");
    setInspectHint("");
  };

  const handleQueueBuild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setMessage({
        text: "Please connect with an admin token in the header first.",
        isError: true,
      });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    const isLocal = isLocalUrl(cloneUrl);
    const body: Record<string, any> = {
      ownerRepo: repo.trim(),
      cloneUrl: cloneUrl.trim(),
      commitHash: commit.trim() || (isLocal ? "HEAD" : ""),
      branch: branch.trim() || (isLocal ? "main" : ""),
      kind,
      packageManager,
      package_manager: packageManager,
      repo: repo.trim(),
      clone_url: cloneUrl.trim(),
      commit_hash: commit.trim() || (isLocal ? "HEAD" : ""),
    };

    if (kind === "ios-release") {
      body.metadata = {
        iosSigningMode:
          selectedIosIdentity === "disabled"
            ? "disabled"
            : selectedIosIdentity === "auto"
            ? "auto"
            : "manual",
        iosCodeSignIdentity:
          selectedIosIdentity !== "auto" && selectedIosIdentity !== "disabled"
            ? selectedIosIdentity
            : undefined,
        iosTeamId: iosTeamId.trim() || undefined,
        iosExportMethod: iosExportMethod,
      };
    }

    try {
      const data = await apiFetch<{ id: string }>(
        "/api/jobs",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        token,
      );

      setMessage({
        text: `Build queued successfully! Job ID: ${data.id}`,
        isError: false,
      });
      onBuildQueued(data.id);
    } catch (err: any) {
      setMessage({
        text: err.message || "Failed to queue build",
        isError: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="glass-panel-elevated rounded-2xl p-6 transition-all">
      {/* Header & Preset Shortcuts */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-5 mb-5 border-b border-slate-800 gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            Queue Build
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Orchestrate multi-platform builds and releases with dedicated Infraxis Agents
          </p>
        </div>

        {/* Clear Action */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="px-2.5 py-1 text-[11px] font-medium bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 border border-slate-200 dark:border-slate-700/80 rounded-lg shadow-xs dark:shadow-none transition-all cursor-pointer"
          >
            Clear Form
          </button>
        </div>
      </div>

      {/* Main Form */}
      <form onSubmit={handleQueueBuild} className="space-y-4">
        {/* Source Mode Toggle */}
        <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800/80 w-fit">
          <button
            type="button"
            onClick={() => setMode("local")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              mode === "local"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <FolderGit2 className="w-3.5 h-3.5" />
            Local Directory (Direct Build)
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("remote");
              if (isLocalUrl(cloneUrl)) {
                setCloneUrl(
                  "https://bitbucket.org/paycircle/dp-mobile-app-react-native.git",
                );
              }
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              mode === "remote"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            Remote Git Repository
          </button>
        </div>

        {/* Target Path & Repository Name */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300">
                {mode === "local" ? "Target Local Directory" : "Git Clone URL"}
              </label>
              {isInspecting && (
                <span className="text-[11px] text-blue-400 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Inspecting directory...
                </span>
              )}
              {inspectHint && !isInspecting && (
                <span className="text-[11px] text-emerald-400 font-mono">
                  {inspectHint}
                </span>
              )}
            </div>
            <input
              type="text"
              required
              value={cloneUrl}
              onChange={(e) => setCloneUrl(e.target.value)}
              placeholder={
                mode === "local"
                  ? "/path/to/react-native-project or ./"
                  : "https://bitbucket.org/user/repo.git"
              }
              className="w-full px-3 py-2 text-xs bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">
              App / Repository Label
            </label>
            <input
              type="text"
              required
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="e.g. dp-mobile-app-react-native"
              className="w-full px-3 py-2 text-xs bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>
        </div>

        {/* Branch, Commit, Target & Package Manager */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Branch */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-slate-400" />
              Branch
            </label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main or release/dev"
              className="w-full px-3 py-2 text-xs bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>

          {/* Commit Hash */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <GitCommit className="w-3.5 h-3.5 text-slate-400" />
              Commit Hash
            </label>
            <input
              type="text"
              value={commit}
              onChange={(e) => setCommit(e.target.value)}
              placeholder="HEAD or commit hash"
              className="w-full px-3 py-2 text-xs bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>

          {/* Build Target */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-blue-400" />
              Build Target
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as BuildKind)}
              className="w-full px-3 py-2 text-xs bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all cursor-pointer"
            >
              <option value="android-release">
                🤖 Android Release APK (assembleRelease)
              </option>
              <option value="ios-release">
                🍎 iOS Release Build (.xcarchive / .ipa)
              </option>
              <option value="pr-checks">
                🧪 PR Verification & Release Check (pr-checks)
              </option>
            </select>
          </div>

          {/* Package Manager */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-indigo-400" />
              Package Manager
            </label>
            <select
              value={packageManager}
              onChange={(e) =>
                setPackageManager(e.target.value as PackageManager)
              }
              className="w-full px-3 py-2 text-xs bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all cursor-pointer"
            >
              <option value="auto">⚡ Auto-detect (pnpm / npm / yarn)</option>
              <option value="pnpm">📦 pnpm (pnpm install)</option>
              <option value="npm">📦 npm (npm install / ci)</option>
              <option value="yarn">📦 yarn (yarn install)</option>
            </select>
          </div>
        </div>

        {/* Dynamic iOS Code Signing & Export Panel */}
        {kind === "ios-release" && (
          <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3.5 transition-all animate-fadeIn">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-200">
                  Apple Code Signing & Packaging (Dynamic)
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                {isLoadingIdentities ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                    Scanning Keychain...
                  </>
                ) : iosIdentities.length > 0 ? (
                  <span className="text-emerald-400">
                    ● {iosIdentities.length} Identity(ies) Detected
                  </span>
                ) : (
                  <span className="text-amber-400">● Automatic Xcode Signing</span>
                )}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Signing Identity Selection */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-300">
                  Signing Identity
                </label>
                <select
                  value={selectedIosIdentity}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedIosIdentity(val);
                    if (val !== "auto" && val !== "disabled") {
                      const found = iosIdentities.find(
                        (i) => i.title === val || i.hash === val,
                      );
                      if (found?.teamId) {
                        setIosTeamId(found.teamId);
                      }
                      if (found?.type === "distribution") {
                        setIosExportMethod("ad-hoc");
                      }
                    }
                  }}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="auto">
                    ⚡ Auto-detect (Inspect Project & Keychain)
                  </option>
                  {iosIdentities.map((id) => (
                    <option key={id.hash} value={id.title}>
                      {id.type === "distribution" ? "🚀 " : "🍎 "}
                      {id.title}
                    </option>
                  ))}
                  <option value="disabled">
                    🚫 Disable Signing (Unsigned Archive)
                  </option>
                </select>
              </div>

              {/* Export Method */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-300">
                  Export Target / Method
                </label>
                <select
                  value={iosExportMethod}
                  onChange={(e) => setIosExportMethod(e.target.value)}
                  disabled={selectedIosIdentity === "disabled"}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500 cursor-pointer disabled:opacity-50"
                >
                  <option value="development">
                    Development (Direct device install & debug)
                  </option>
                  <option value="ad-hoc">
                    Ad-Hoc (Ad-hoc device distribution)
                  </option>
                  <option value="app-store">
                    App Store (TestFlight & App Store)
                  </option>
                  <option value="enterprise">
                    Enterprise (In-house distribution)
                  </option>
                </select>
              </div>

              {/* Apple Developer Team ID */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-slate-300">
                  Team ID (Auto or Custom)
                </label>
                <input
                  type="text"
                  value={iosTeamId}
                  onChange={(e) => setIosTeamId(e.target.value.toUpperCase())}
                  placeholder="e.g. G3WQY6FQ95 (leave blank for auto)"
                  disabled={selectedIosIdentity === "disabled"}
                  maxLength={10}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-600 font-mono uppercase focus:outline-none focus:border-blue-500 disabled:opacity-50"
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Infraxis dynamically inspects your checked-out <code className="text-blue-300">project.pbxproj</code>, matches valid certificates in Keychain, generates a matching <code className="text-blue-300">ExportOptions.plist</code>, and exports a signed <code className="text-blue-300">.ipa</code> automatically.
            </p>
          </div>
        )}

        {/* Message Banner */}
        {message && (
          <div
            className={`p-3 rounded-xl flex items-center gap-2.5 text-xs font-medium border transition-all ${
              message.isError
                ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
                : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
            }`}
          >
            {message.isError ? (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            ) : (
              <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        {/* Submit Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 bg-linear-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 transition-all transform active:scale-[0.99]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Submitting Build to Queue...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 text-amber-300 fill-amber-300" />
                Queue Build
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
