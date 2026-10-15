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
  Smartphone,
  Server,
  Monitor,
  Container,
  Code2,
  Wrench,
  CheckCircle2,
  Cpu,
  ArrowRight,
  Target,
  Activity,
} from "lucide-react";
import {
  BuildKind,
  PackageManager,
  InspectLocalResponse,
  IosSigningIdentity,
  IosSigningIdentitiesResponse,
  ProjectDetectionResult,
  PipelineTargetInfo,
} from "../types/ci";
import { apiFetch, getStoredToken, isLocalUrl } from "../lib/api";

function getAutoDetectedProfile(
  detection: InspectLocalResponse | null,
): BuildKind {
  if (!detection) return "pr-checks";
  if (detection.recommendedProfile) {
    if (detection.recommendedProfile === "android-debug")
      return "android-release";
    if (detection.recommendedProfile === "ios-simulator") return "ios-release";
    return detection.recommendedProfile;
  }
  if (detection.hasInfraxisConfig) return "custom-pipeline";
  if (detection.primaryType === "ios") return "ios-release";
  if (detection.primaryType === "android") return "android-release";
  if (detection.hasDockerfile || detection.category === "containers")
    return "release-build";
  return "pr-checks";
}

function getAutoDetectedTarget(
  detection: InspectLocalResponse | null,
): PipelineTargetInfo | null {
  if (!detection) return null;
  if (detection.pipelineTarget) return detection.pipelineTarget;

  const pt = detection.primaryType || "general";
  const cat = detection.category || "general";
  const hasConfig = Boolean(detection.hasInfraxisConfig);

  if (hasConfig) {
    return {
      name: "Custom infraxis.yml Pipeline",
      platform: "Infraxis Pipeline Engine",
      runtime: "User Defined (infraxis.yml)",
      osRequirement: "Agent Matched",
      summary:
        "Executes stages and commands configured in the repository's infraxis.yml.",
    };
  }
  if (pt === "ios") {
    return {
      name: "Apple iOS Simulator",
      platform: "Apple iOS",
      runtime: "Xcode & xcodebuild",
      osRequirement: "macOS (Apple Silicon / Intel) Required",
      summary:
        "Compiles and executes iOS simulator test suites on macOS worker agents.",
    };
  }
  if (pt === "android") {
    return {
      name: "Android Debug APK & Tests",
      platform: "Android OS",
      runtime: "Java 17+ & Gradle",
      osRequirement: "Android SDK Required (Linux / macOS)",
      summary:
        "Assembles debug APK and executes Android lint and unit test suites.",
    };
  }
  if (pt === "flutter") {
    return {
      name: "Flutter Cross-Platform Suite",
      platform: "Mobile / Web / Desktop",
      runtime: "Flutter SDK & Dart",
      osRequirement: "Universal",
      summary:
        "Runs flutter pub get, flutter analyze, and automated test suites.",
    };
  }
  if (pt === "react-native") {
    return {
      name: "React Native Mobile Suite",
      platform: "iOS & Android",
      runtime: "Node.js & Mobile Toolchains",
      osRequirement: "Linux / macOS (macOS for iOS)",
      summary:
        "Validates JavaScript codebase, Metro bundle, and native mobile bridge integrity.",
    };
  }
  if (cat === "containers" || detection.hasDockerfile || pt === "docker") {
    return {
      name: "OCI Container Image",
      platform: "Docker / Container Engine",
      runtime: "Docker CLI & Daemon",
      osRequirement: "Docker Host Required",
      summary:
        "Builds container images, verifies multi-stage Dockerfile, and validates containers.",
    };
  }
  if (
    cat === "web" ||
    ["nextjs", "react", "vue", "angular", "vite", "nuxt", "svelte"].includes(pt)
  ) {
    const fw =
      pt === "nextjs" ? "Next.js" : pt.charAt(0).toUpperCase() + pt.slice(1);
    return {
      name: `${fw} Web Application`,
      platform: "Web / Node.js Engine",
      runtime: `Node.js (${detection.packageManager || "npm"})`,
      osRequirement: "Universal (Linux / macOS)",
      summary:
        "Runs package integrity checks, ESLint, TypeScript validation, and test suites.",
    };
  }
  if (["go", "rust", "python", "java"].includes(pt)) {
    return {
      name: `${pt.toUpperCase()} Service Target`,
      platform: "Cloud Native / Server",
      runtime: `${pt.toUpperCase()} Toolchain`,
      osRequirement: "Universal",
      summary: `Compiles, tests, and builds standalone ${pt} service artifacts.`,
    };
  }
  return {
    name: "Universal Software Target",
    platform: "Cross-Platform",
    runtime: detection.packageManager
      ? `Node.js (${detection.packageManager})`
      : "Standard Toolchain",
    osRequirement: "Universal",
    summary:
      "Executes automated PR validation, lint checks, test suites, and build verification.",
  };
}

export type ProjectCategory =
  | "auto"
  | "mobile"
  | "web"
  | "backend"
  | "containers"
  | "desktop"
  | "custom";

export interface ProfileOption {
  id: BuildKind;
  title: string;
  desc: string;
  badge: string;
}

function getProfilesForCategory(cat: ProjectCategory): ProfileOption[] {
  if (cat === "mobile") {
    return [
      {
        id: "pr-checks",
        title: "PR Checks",
        desc: "Fast validation, lint & mobile tests",
        badge: "Default for all",
      },
      {
        id: "android-release",
        title: "Android",
        desc: "Build release APK & bundle (Gradle)",
        badge: "Android",
      },
      {
        id: "ios-release",
        title: "iOS",
        desc: "Xcode archive & signed IPA",
        badge: "macOS Required",
      },
    ];
  }

  if (cat === "web") {
    return [
      {
        id: "pr-checks",
        title: "PR Checks",
        desc: "Fast validation, lint & tests",
        badge: "Default for all",
      },
      {
        id: "dev-build",
        title: "Development Build",
        desc: "Full dev compile & test suite",
        badge: "Dev",
      },
      {
        id: "release-build",
        title: "Release Build",
        desc: "Production package & artifacts",
        badge: "Prod",
      },
      {
        id: "custom-pipeline",
        title: "Custom Pipeline",
        desc: "User-defined custom commands",
        badge: "Custom",
      },
    ];
  }

  if (cat === "backend") {
    return [
      {
        id: "pr-checks",
        title: "PR Checks",
        desc: "Service unit tests, vet & lint",
        badge: "Default for all",
      },
      {
        id: "dev-build",
        title: "Development Build",
        desc: "Local microservice compile & test",
        badge: "Dev",
      },
      {
        id: "release-build",
        title: "Release Build",
        desc: "Production binary packaging",
        badge: "Prod",
      },
      {
        id: "custom-pipeline",
        title: "Custom Pipeline",
        desc: "User-defined custom commands",
        badge: "Custom",
      },
    ];
  }

  if (cat === "containers") {
    return [
      {
        id: "pr-checks",
        title: "PR Checks",
        desc: "Containerfile lint & health checks",
        badge: "Default for all",
      },
      {
        id: "release-build",
        title: "Release Build",
        desc: "Build & package OCI container image",
        badge: "Docker Engine",
      },
      {
        id: "dev-build",
        title: "Development Build",
        desc: "Development container image compile",
        badge: "Dev",
      },
      {
        id: "custom-pipeline",
        title: "Custom Pipeline",
        desc: "Multi-stage container execution",
        badge: "Custom",
      },
    ];
  }

  if (cat === "desktop") {
    return [
      {
        id: "pr-checks",
        title: "PR Checks",
        desc: "Desktop test runner & frontend lint",
        badge: "Default for all",
      },
      {
        id: "dev-build",
        title: "Development Build",
        desc: "Debug desktop binary compilation",
        badge: "Dev",
      },
      {
        id: "release-build",
        title: "Release Build",
        desc: "Package native installer & binary",
        badge: "Prod",
      },
      {
        id: "custom-pipeline",
        title: "Custom Pipeline",
        desc: "Custom desktop packaging commands",
        badge: "Custom",
      },
    ];
  }

  if (cat === "custom") {
    return [
      {
        id: "pr-checks",
        title: "PR Checks",
        desc: "Fast validation, lint & tests",
        badge: "Default for all",
      },
      {
        id: "custom-pipeline",
        title: "Custom Pipeline",
        desc: "Executes infraxis.yml stages",
        badge: "User Defined",
      },
    ];
  }

  return [
    {
      id: "pr-checks",
      title: "PR Checks",
      desc: "Fast validation, lint & tests",
      badge: "Default for all",
    },
    {
      id: "dev-build",
      title: "Development Build",
      desc: "Full dev compile & test suite",
      badge: "Dev",
    },
    {
      id: "release-build",
      title: "Release Build",
      desc: "Production package & artifacts",
      badge: "Prod",
    },
    {
      id: "custom-pipeline",
      title: "Custom Pipeline",
      desc: "User-defined custom commands",
      badge: "Custom",
    },
  ];
}

function getCategoryTargetInfo(
  cat: ProjectCategory,
  detection: InspectLocalResponse | null,
): PipelineTargetInfo {
  if (cat === "mobile") {
    return {
      name: "Mobile Platform (Android & iOS)",
      platform: "Android OS & Apple iOS",
      runtime: "Android SDK (Gradle) & Xcode (macOS)",
      osRequirement: "macOS for iOS · Linux/macOS for Android",
      summary:
        "Universal mobile CI/CD pipeline building and verifying Android and iOS release packages. PR checks is default for all builds.",
    };
  }
  if (cat === "web") {
    return {
      name: "Web Application",
      platform: "Web Browser / Node.js Engine",
      runtime: `Node.js (${detection?.packageManager || "npm"})`,
      osRequirement: "Universal (Linux / macOS)",
      summary:
        "Runs dependency audits, ESLint, TypeScript verification, unit tests, and production compilation. PR checks is default for all builds.",
    };
  }
  if (cat === "backend") {
    return {
      name: "Backend Service / API",
      platform: "Cloud Native / Server Architecture",
      runtime: detection?.primaryType
        ? `${detection.primaryType.toUpperCase()} Toolchain`
        : "Language Runtime",
      osRequirement: "Universal (Linux / macOS)",
      summary:
        "Runs unit test suites, static analysis, linting, and packages standalone microservice binaries. PR checks is default for all builds.",
    };
  }
  if (cat === "containers") {
    return {
      name: "OCI Container Image",
      platform: "Docker / Container Engine",
      runtime: "Docker CLI & Daemon",
      osRequirement: "Docker Daemon Required",
      summary:
        "Builds container images, verifies multi-stage Dockerfile instructions, and tests container health. PR checks is default for all builds.",
    };
  }
  if (cat === "desktop") {
    return {
      name: "Desktop Application",
      platform: "Cross-Platform Desktop (Native GUI)",
      runtime: "Chromium / Node.js / Rust (Cargo)",
      osRequirement: "Universal (Linux / macOS / Windows)",
      summary:
        "Runs automated desktop tests, lints scripts, and packages distribution assets. PR checks is default for all builds.",
    };
  }
  if (cat === "custom") {
    return {
      name: "Custom infraxis.yml Pipeline",
      platform: "Infraxis Pipeline Engine",
      runtime: "User Defined (infraxis.yml)",
      osRequirement: "Agent Capability Matched",
      summary:
        "Executes stages and commands configured in the repository infraxis.yml specification. PR checks is default for all builds.",
    };
  }
  return (
    getAutoDetectedTarget(detection) || {
      name: "Universal Software Target",
      platform: "Cross-Platform",
      runtime: "Standard Toolchain",
      osRequirement: "Universal",
      summary:
        "Executes automated PR validation, lint checks, test suites, and build verification. PR checks is default for all builds.",
    }
  );
}

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
  const [kind, setKind] = useState<BuildKind>("pr-checks");
  const [packageManager, setPackageManager] = useState<PackageManager>("auto");
  const [projectCategory, setProjectCategory] =
    useState<ProjectCategory>("auto");

  // Switch category and enforce PR Checks as default for all
  const handleCategoryChange = (cat: ProjectCategory) => {
    setProjectCategory(cat);
    setKind("pr-checks");
  };

  // Detection & Monorepo State
  const [detection, setDetection] = useState<InspectLocalResponse | null>(null);
  const [targetSubApp, setTargetSubApp] = useState<string>("");

  // Custom Pipeline Stages State
  const [customCommand, setCustomCommand] = useState<string>("");

  // Dynamic iOS Code Signing & Export State
  const [iosIdentities, setIosIdentities] = useState<IosSigningIdentity[]>([]);
  const [selectedIosIdentity, setSelectedIosIdentity] =
    useState<string>("auto");
  const [iosExportMethod, setIosExportMethod] = useState<string>("development");
  const [iosTeamId, setIosTeamId] = useState<string>("");
  const [isLoadingIdentities, setIsLoadingIdentities] =
    useState<boolean>(false);
  const [strictLint, setStrictLint] = useState<boolean>(false);

  // Profile and pipeline target section visibility: hidden initially, hidden when queued, updated and shown when URL changes
  const [showProfileSection, setShowProfileSection] = useState<boolean>(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectHint, setInspectHint] = useState<string>("");
  const [message, setMessage] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  // Manual & auto project type detection
  const handleDetectProjectType = async (customPath?: string) => {
    const targetPath = (
      customPath !== undefined ? customPath : cloneUrl
    ).trim();
    if (!targetPath) {
      setInspectHint("Enter a local directory path or repository first");
      setShowProfileSection(false);
      return;
    }

    const activeToken = token || getStoredToken();
    if (!activeToken) {
      setInspectHint(
        "Connect with admin token in header to detect project type",
      );
      return;
    }

    setIsInspecting(true);
    setInspectHint("Detecting project type, runtimes & toolchains...");

    try {
      const data: InspectLocalResponse = await apiFetch(
        `/api/inspect-local?path=${encodeURIComponent(targetPath)}`,
        {},
        activeToken,
      );
      if (data && !data.error) {
        setDetection(data);
        setShowProfileSection(true);
        if (data.appName) setRepo(data.appName);
        if (data.branch) setBranch(data.branch);
        if (data.commitHash) setCommit(data.commitHash);
        if (data.packageManager && data.packageManager !== "auto") {
          setPackageManager(data.packageManager as PackageManager);
        }
        if (
          data.isMonorepo &&
          data.subApps &&
          data.subApps.length > 0 &&
          !targetSubApp
        ) {
          setTargetSubApp(data.subApps[0].path);
        }
        // Sync category dropdown if project detected
        if (
          data.category &&
          ["mobile", "web", "backend", "containers", "desktop"].includes(
            data.category,
          )
        ) {
          setProjectCategory(data.category as ProjectCategory);
        } else if (data.hasInfraxisConfig) {
          setProjectCategory("custom");
        } else {
          setProjectCategory("auto");
        }

        // PR Checks is the universal default for all projects
        setKind("pr-checks");

        const primary = data.primaryType
          ? data.primaryType.toUpperCase()
          : "UNIVERSAL";
        const targetTitle =
          data.pipelineTarget?.name ||
          (data.category ? data.category.toUpperCase() : "UNIVERSAL");
        setInspectHint(
          `Detected: ${primary} · Target: ${targetTitle} · Profile: PR Checks`,
        );
      } else {
        setInspectHint(data?.error || "Could not detect project at this path");
      }
    } catch (err: any) {
      setInspectHint(err.message || "Failed to inspect project");
    } finally {
      setIsInspecting(false);
    }
  };

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
  }, [kind, token, iosTeamId]);

  // Auto-inspect and update when cloneUrl changes with debounce
  useEffect(() => {
    const trimmed = cloneUrl.trim();
    if (!trimmed) {
      setInspectHint("");
      setDetection(null);
      setShowProfileSection(false);
      return;
    }

    const timer = setTimeout(() => {
      handleDetectProjectType(trimmed);
    }, 500);

    return () => clearTimeout(timer);
  }, [cloneUrl, token]);

  const handleReset = () => {
    setMessage(null);
    setCloneUrl("");
    setRepo("");
    setCommit("");
    setBranch("");
    setKind("pr-checks");
    setPackageManager("auto");
    setProjectCategory("auto");
    setInspectHint("");
    setDetection(null);
    setShowProfileSection(false);
    setTargetSubApp("");
    setCustomCommand("");
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

    const metadata: Record<string, any> = {
      strictLint,
      targetApp: targetSubApp || undefined,
    };

    if (kind === "ios-release") {
      metadata.iosSigningMode =
        selectedIosIdentity === "disabled"
          ? "disabled"
          : selectedIosIdentity === "auto"
            ? "auto"
            : "manual";
      metadata.iosCodeSignIdentity =
        selectedIosIdentity !== "auto" && selectedIosIdentity !== "disabled"
          ? selectedIosIdentity
          : undefined;
      metadata.iosTeamId = iosTeamId.trim() || undefined;
      metadata.iosExportMethod = iosExportMethod;
    } else if (kind === "custom-pipeline" && customCommand.trim()) {
      metadata.pipeline = {
        name: "Custom User Pipeline",
        stages: [
          {
            name: "Custom Execution Stage",
            category: "custom",
            command: customCommand.trim(),
            dir: targetSubApp || ".",
            allowFailure: false,
          },
        ],
      };
    }

    body.metadata = metadata;

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
      // Hide profile and pipeline target section when queued
      setShowProfileSection(false);
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

  const getCategoryIcon = (cat?: string) => {
    switch (cat) {
      case "mobile":
        return <Smartphone className="w-3.5 h-3.5 text-sky-400" />;
      case "backend":
        return <Server className="w-3.5 h-3.5 text-purple-400" />;
      case "desktop":
        return <Monitor className="w-3.5 h-3.5 text-amber-400" />;
      case "containers":
        return <Container className="w-3.5 h-3.5 text-blue-400" />;
      default:
        return <Globe className="w-3.5 h-3.5 text-emerald-400" />;
    }
  };

  const renderTargetIcon = (cat?: string, pt?: string) => {
    if (
      cat === "mobile" ||
      pt === "ios" ||
      pt === "android" ||
      pt === "flutter" ||
      pt === "react-native"
    ) {
      return <Smartphone className="w-4 h-4 text-purple-400" />;
    }
    if (cat === "containers" || pt === "docker") {
      return <Container className="w-4 h-4 text-blue-400" />;
    }
    if (cat === "desktop" || pt === "tauri" || pt === "electron") {
      return <Monitor className="w-4 h-4 text-indigo-400" />;
    }
    if (
      cat === "backend" ||
      ["go", "rust", "python", "java"].includes(pt || "")
    ) {
      return <Server className="w-4 h-4 text-emerald-400" />;
    }
    if (pt === "custom-pipeline" || cat === "custom") {
      return <Wrench className="w-4 h-4 text-amber-400" />;
    }
    return <Globe className="w-4 h-4 text-cyan-400" />;
  };

  const effectiveCategory: ProjectCategory =
    projectCategory === "auto"
      ? (detection?.category as ProjectCategory) || "web"
      : projectCategory;

  const currentProfiles = getProfilesForCategory(effectiveCategory);
  const currentTargetInfo = getCategoryTargetInfo(effectiveCategory, detection);
  const autoDetectedProfile = getAutoDetectedProfile(detection);
  const activeStages = detection?.suggestedPipelines?.[kind]?.stages;

  const profileTitles: Record<string, string> = {
    "pr-checks": "PR Checks",
    "dev-build": "Development Build",
    "release-build": "Release Build",
    "custom-pipeline": "Custom Pipeline",
    "android-release": "Android Release",
    "android-debug": "Android Debug",
    "ios-release": "iOS Release",
    "ios-simulator": "iOS Simulator",
  };
  const selectedProfileTitle = profileTitles[kind] || kind;

  return (
    <div className="glass-panel-elevated rounded-2xl p-6 transition-all border border-slate-200/90 dark:border-slate-800/80 bg-white dark:bg-slate-900/70 shadow-xs">
      {/* Header & Preset Shortcuts */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-5 mb-5 border-b border-slate-200 dark:border-slate-800 gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-500 dark:text-blue-400" />
            Queue Build & Pipeline
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Universal CI/CD pipelines across Mobile, Web, Backend, Desktop, and
            Containers
          </p>
        </div>

        {/* Clear Action */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="px-2.5 py-1 text-[11px] font-medium bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 border border-slate-200 dark:border-slate-700/80 rounded-lg transition-all cursor-pointer"
          >
            Clear Form
          </button>
        </div>
      </div>

      {/* Main Form */}
      <form onSubmit={handleQueueBuild} className="space-y-4">
        {/* Source Mode Toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("local");
              setCloneUrl("");
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              mode === "local"
                ? "bg-blue-600 text-white shadow-xs"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <FolderGit2 className="w-3.5 h-3.5" />
            Local Workspace
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("remote");
              setCloneUrl("");
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              mode === "remote"
                ? "bg-blue-600 text-white shadow-xs"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            Remote Repository
          </button>
        </div>

        {/* Clone URL / Directory */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {mode === "local" ? "Local Directory Path" : "Git Clone URL"}
            </label>
            {isInspecting && (
              <span className="text-[11px] text-blue-500 dark:text-blue-400 flex items-center gap-1 font-mono">
                <Loader2 className="w-3 h-3 animate-spin" />
                Inspecting tech stack...
              </span>
            )}
            {!isInspecting && inspectHint && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                {inspectHint}
              </span>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={cloneUrl}
              onChange={(e) => {
                const val = e.target.value;
                setCloneUrl(val);
                if (!val.trim()) {
                  setShowProfileSection(false);
                  setDetection(null);
                  setInspectHint("");
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleDetectProjectType();
                }
              }}
              placeholder={
                mode === "local"
                  ? "/Users/.../my-app or ~/projects/my-app"
                  : "https://github.com/org/repo.git"
              }
              className="flex-1 px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
              required
            />
            <button
              type="button"
              onClick={() => handleDetectProjectType()}
              disabled={isInspecting || !cloneUrl.trim()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer whitespace-nowrap"
              title="Inspect repository to detect project type and build requirements"
            >
              {isInspecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              Detect Project Type
            </button>
          </div>

          {/* Quick path presets for local mode */}
          {mode === "local" && (
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-medium">Quick inspect:</span>
              <button
                type="button"
                onClick={() => {
                  setCloneUrl(".");
                  handleDetectProjectType(".");
                }}
                className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-mono cursor-pointer transition-colors"
              >
                . (Workspace)
              </button>
              <button
                type="button"
                onClick={() => {
                  setCloneUrl("./web");
                  handleDetectProjectType("./web");
                }}
                className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-mono cursor-pointer transition-colors"
              >
                ./web (Next.js)
              </button>
              <button
                type="button"
                onClick={() => {
                  setCloneUrl("./worker");
                  handleDetectProjectType("./worker");
                }}
                className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-mono cursor-pointer transition-colors"
              >
                ./worker (Agent)
              </button>
            </div>
          )}
        </div>

        {/* Universal Project Intelligence Overview Card */}
        {detection && (
          <div className="p-4 rounded-xl bg-gradient-to-r from-blue-50/70 via-indigo-50/40 to-slate-50/50 dark:from-blue-950/30 dark:via-indigo-950/20 dark:to-slate-900/60 border border-blue-200/80 dark:border-blue-900/50 space-y-3 animate-fadeIn">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  {getCategoryIcon(detection.category)}
                </span>
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide">
                  {detection.primaryType} Project ({detection.category || "web"}
                  )
                </span>
                {detection.isMonorepo && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                    Monorepo ({detection.monorepoType || "multi-app"})
                  </span>
                )}
                {detection.hasInfraxisConfig && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    infraxis.yml
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                PM: {(detection.packageManager || "npm").toUpperCase()}
              </span>
            </div>

            {/* Technology tags */}
            {detection.technologies && detection.technologies.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-1">
                  Stack:
                </span>
                {detection.technologies.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-white/80 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* Required Worker Capabilities */}
            {detection.requiredCapabilities &&
              detection.requiredCapabilities.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-1 flex items-center gap-1">
                    <Cpu className="w-3 h-3 text-indigo-500" />
                    Agent Requirements:
                  </span>
                  {detection.requiredCapabilities.map((c) => (
                    <span
                      key={c}
                      className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20 font-medium"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}

            {/* Monorepo Sub-app selector if present */}
            {detection.isMonorepo &&
              detection.subApps &&
              detection.subApps.length > 0 && (
                <div className="flex items-center gap-2 pt-1 text-xs">
                  <span className="text-slate-600 dark:text-slate-400 font-medium">
                    Target Application:
                  </span>
                  <select
                    value={targetSubApp}
                    onChange={(e) => setTargetSubApp(e.target.value)}
                    className="px-2.5 py-1 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
                  >
                    <option value="">Full Repository / Root</option>
                    {detection.subApps.map((a) => (
                      <option key={a.name} value={a.path}>
                        {a.name} ({a.primaryType})
                      </option>
                    ))}
                  </select>
                </div>
              )}
          </div>
        )}

        {/* Repository Name & Branch / Commit */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Repository Identifier */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Repository Name
            </label>
            <input
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repo or app-name"
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
              required
            />
          </div>

          {/* Branch */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-slate-400" />
              Branch
            </label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>

          {/* Commit Hash */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <GitCommit className="w-3.5 h-3.5 text-slate-400" />
              Commit Hash
            </label>
            <input
              type="text"
              value={commit}
              onChange={(e) => setCommit(e.target.value)}
              placeholder="HEAD"
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
            />
          </div>

          {/* Package Manager */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5 text-indigo-400" />
              Package Manager
            </label>
            <select
              value={packageManager}
              onChange={(e) =>
                setPackageManager(e.target.value as PackageManager)
              }
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all cursor-pointer"
            >
              <option value="auto">⚡ Auto-detect</option>
              <option value="pnpm">📦 pnpm</option>
              <option value="npm">📦 npm</option>
              <option value="yarn">📦 yarn</option>
            </select>
          </div>
        </div>

        {/* Pipeline Profile / Target Selection with Intelligent Auto-Detection & Project Type Dropdown */}
        {showProfileSection && (
          <>
            <div className="space-y-3 pt-1 animate-fadeIn">
              {/* Section Header with Project Type Dropdown */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pb-1">
                <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                  Build Profile & Pipeline Target
                </label>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Project Type Category Dropdown */}
                  <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-xl px-2.5 py-1 shadow-2xs">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                      Project:
                    </span>
                    <select
                      value={projectCategory}
                      onChange={(e) =>
                        handleCategoryChange(e.target.value as ProjectCategory)
                      }
                      className="text-xs font-semibold bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none cursor-pointer pr-1"
                    >
                      <option value="auto">
                        ⚡ Auto-Detect{" "}
                        {detection
                          ? `(${detection.category || detection.primaryType})`
                          : ""}
                      </option>
                      <option value="mobile">📱 Mobile (Android & iOS)</option>
                      <option value="web">🌐 Web Application</option>
                      <option value="backend">
                        🖥️ Backend Service (Go, Python, Java, Rust)
                      </option>
                      <option value="containers">🐳 Containers & Docker</option>
                      <option value="desktop">💻 Desktop Application</option>
                      <option value="custom">
                        ⚙️ Custom Pipeline (infraxis.yml)
                      </option>
                    </select>
                  </div>

                  {detection && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5" />
                        Detected: {detection.primaryType?.toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Pipeline Target Platform Banner */}
              {currentTargetInfo && (
                <div className="p-3.5 rounded-xl bg-gradient-to-r from-blue-950/20 via-indigo-950/20 to-purple-950/20 border border-blue-500/20 dark:border-blue-500/30 shadow-xs space-y-2.5 transition-all animate-fadeIn">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 shrink-0">
                        {renderTargetIcon(
                          effectiveCategory,
                          detection?.primaryType,
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                            {currentTargetInfo.name}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center gap-1">
                            <Target className="w-2.5 h-2.5" />
                            Target: {effectiveCategory.toUpperCase()}
                          </span>
                          {kind === "pr-checks" && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              ● PR Checks (Default Active)
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {currentTargetInfo.summary}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Target Specifications Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/60 text-[11px]">
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <span className="text-slate-400 font-mono text-[10px]">
                        Target Platform:
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {currentTargetInfo.platform}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <span className="text-slate-400 font-mono text-[10px]">
                        Runtime / Toolchain:
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {currentTargetInfo.runtime}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <span className="text-slate-400 font-mono text-[10px]">
                        Agent OS Requirement:
                      </span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {currentTargetInfo.osRequirement}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Build Profiles Grid (Mobile shows only Android & iOS; PR Checks default for all) */}
              <div
                className={`grid gap-2.5 ${
                  effectiveCategory === "mobile"
                    ? "grid-cols-1 sm:grid-cols-3"
                    : "grid-cols-2 sm:grid-cols-4"
                }`}
              >
                {currentProfiles.map((p) => {
                  const active = kind === p.id;
                  const isDefaultProfile = p.id === "pr-checks";
                  const isDetectedMatch = Boolean(
                    detection &&
                    autoDetectedProfile === p.id &&
                    !isDefaultProfile,
                  );
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setKind(p.id as BuildKind)}
                      className={`p-3 rounded-xl text-left border transition-all relative ${
                        active
                          ? "border-blue-500 bg-blue-500/10 shadow-xs ring-1 ring-blue-500/30"
                          : isDetectedMatch
                            ? "border-purple-500/40 bg-purple-500/5 hover:border-purple-500/60"
                            : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                          {p.title}
                        </span>
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold ${
                            active
                              ? "bg-blue-500 text-white"
                              : isDefaultProfile
                                ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                                : "bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          {p.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mb-1">
                        {p.desc}
                      </p>
                      {isDefaultProfile && (
                        <div className="pt-1 flex items-center">
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 flex items-center gap-1">
                            <CheckCircle className="w-2.5 h-2.5 text-emerald-500" />
                            Default for all
                          </span>
                        </div>
                      )}
                      {isDetectedMatch && (
                        <div className="pt-1 flex items-center">
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/25 flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5 text-purple-500" />
                            Detected Target
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Live Planned Pipeline Stages Preview */}
              {activeStages && activeStages.length > 0 && (
                <div className="p-3 bg-slate-50/80 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2 animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-blue-500" />
                      Planned Pipeline Execution Stages ({
                        activeStages.length
                      }{" "}
                      Stages)
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {selectedProfileTitle}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {activeStages.map((st: any, idx: number) => (
                      <React.Fragment key={st.id || idx}>
                        <div className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shrink-0 text-left min-w-[130px] shadow-2xs">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <span className="text-[10px] font-mono text-blue-500 font-bold">
                              Stage {idx + 1}
                            </span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded font-mono uppercase bg-slate-100 dark:bg-slate-800 text-slate-500">
                              {st.category || "step"}
                            </span>
                          </div>
                          <span className="text-xs font-medium text-slate-800 dark:text-slate-200 block truncate">
                            {st.name}
                          </span>
                          {st.command && (
                            <p className="text-[10px] font-mono text-slate-400 truncate max-w-[160px] mt-0.5">
                              {st.command}
                            </p>
                          )}
                        </div>
                        {idx < activeStages.length - 1 && (
                          <ArrowRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0" />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Custom Pipeline Command Input */}
            {kind === "custom-pipeline" && (
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2 animate-fadeIn">
                <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-amber-500" />
                  Custom Pipeline Shell Commands
                </label>
                <input
                  type="text"
                  value={customCommand}
                  onChange={(e) => setCustomCommand(e.target.value)}
                  placeholder="e.g. npm run lint && npm test && npm run build"
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                  required
                />
                <p className="text-[11px] text-slate-500">
                  Run custom commands in isolated agent environment.
                  Administrative credentials are never exposed.
                </p>
              </div>
            )}

            {/* Dynamic iOS Code Signing & Export Panel */}
            {kind === "ios-release" && (
              <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3.5 transition-all animate-fadeIn">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-500 dark:text-emerald-400 shrink-0" />
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Apple Code Signing & Packaging (macOS Agent Required)
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    {isLoadingIdentities ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                        Scanning Keychain...
                      </>
                    ) : iosIdentities.length > 0 ? (
                      <span className="text-emerald-500">
                        ● {iosIdentities.length} Identity(ies) Detected
                      </span>
                    ) : (
                      <span className="text-amber-500">
                        ● Automatic Xcode Signing
                      </span>
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      Signing Identity
                    </label>
                    <select
                      value={selectedIosIdentity}
                      onChange={(e) => setSelectedIosIdentity(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200"
                    >
                      <option value="auto">⚡ Automatic Xcode Identity</option>
                      <option value="disabled">
                        🚫 Unsigned (CI Artifact only)
                      </option>
                      {iosIdentities.map((id) => (
                        <option key={id.hash} value={id.title}>
                          {id.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      Export Method
                    </label>
                    <select
                      value={iosExportMethod}
                      onChange={(e) => setIosExportMethod(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200"
                    >
                      <option value="development">
                        Development (Testing on devices)
                      </option>
                      <option value="ad-hoc">
                        Ad-Hoc (Pre-registered devices)
                      </option>
                      <option value="app-store">
                        App Store Connect / TestFlight
                      </option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                      Apple Team ID
                    </label>
                    <input
                      type="text"
                      value={iosTeamId}
                      onChange={(e) => setIosTeamId(e.target.value)}
                      placeholder="e.g. 9ABCDEF012"
                      className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200 font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* PR Strict Lint Checkbox */}
            {kind === "pr-checks" && (
              <div className="flex items-center gap-2 pt-1 text-xs text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  id="strictLint"
                  checked={strictLint}
                  onChange={(e) => setStrictLint(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="strictLint">
                  Strict Lint Mode (Fail PR check immediately on any lint
                  errors)
                </label>
              </div>
            )}
          </>
        )}

        {/* Message notification */}
        {message && (
          <div
            className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
              message.isError
                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
            }`}
          >
            {message.isError ? (
              <AlertCircle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        {/* Action Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isSubmitting || !cloneUrl || !repo}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xs transition-all"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Scheduling Build Pipeline...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                <span>Queue Build Pipeline</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
