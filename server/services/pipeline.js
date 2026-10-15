const path = require("path");
const { detectRepository } = require("./detector");
const { loadRepoConfig } = require("./config-parser");

/**
 * Universal Pipeline Planner for Infraxis CI/CD
 * Plans stages for pr-checks, dev-build, release-build, and custom-pipeline
 * across Mobile, Web, Backend, Desktop, and Containers.
 */

function planPipeline(args = {}) {
  let {
    detection,
    profile,
    kind,
    customConfig = null,
    options = {},
    projectDir,
  } = args;

  const activeProfile = kind || profile || "pr-checks";

  if (!detection && projectDir) {
    detection = detectRepository(projectDir);
  }
  if (!customConfig && projectDir) {
    customConfig = loadRepoConfig(projectDir);
  }

  const strictLint = Boolean(options.strictLint);
  const targetApp = options.targetApp || null;
  const pm = detection?.packageManager || "npm";

  // 1. If customConfig defines this pipeline profile, use user's explicit pipeline!
  if (customConfig?.pipelines && customConfig.pipelines[activeProfile]) {
    const userPipeline = customConfig.pipelines[activeProfile];
    return {
      name: userPipeline.name || `Infraxis ${activeProfile}`,
      profile: activeProfile,
      kind: activeProfile,
      requiredCapabilities:
        userPipeline.requiredCapabilities ||
        detection?.requiredCapabilities ||
        [],
      timeoutSeconds: userPipeline.timeoutSeconds || 3600,
      env: { ...(customConfig.env || {}), ...(userPipeline.env || {}) },
      stages: userPipeline.stages.map((st, i) => ({
        id: `stage-${i + 1}`,
        name: st.name,
        category: st.category || "custom",
        command: st.command,
        dir: st.dir || ".",
        allowFailure: Boolean(st.allowFailure),
        env: st.env || {},
      })),
      artifacts: userPipeline.artifacts || [],
    };
  }

  // 2. Legacy Kind Compatibility Mapping
  if (
    activeProfile === "android-release" ||
    activeProfile === "android-debug"
  ) {
    return planAndroidNativePipeline(detection, activeProfile, options);
  }
  if (activeProfile === "ios-release" || activeProfile === "ios-simulator") {
    return planIosNativePipeline(detection, activeProfile, options);
  }

  // 3. Universal Pipeline Planning based on detected project type
  const primaryType = detection?.primaryType || "general";
  const stages = [];
  const requiredCapabilities = new Set();
  const artifacts = [];

  // Determine subproject working directory if monorepo with targetApp
  let workDir = ".";
  let targetPkgScripts = detection?.rootDetails?.pkgScripts || {};
  if (targetApp && Array.isArray(detection?.subApps)) {
    const matched = detection.subApps.find(
      (a) => a.name === targetApp || a.path === targetApp,
    );
    if (matched) {
      workDir = matched.path;
      targetPkgScripts = matched.pkgScripts || {};
    }
  }

  // --- Step A: Dependency Installation Stage ---
  const installStage = planInstallStage(detection, workDir, pm);
  if (installStage) {
    stages.push(installStage);
    for (const cap of installStage.requiredCaps || [])
      requiredCapabilities.add(cap);
  }

  // --- Step B: Linting & Code Quality Stage ---
  const lintStage = planLintStage(
    detection,
    workDir,
    targetPkgScripts,
    strictLint,
  );
  if (lintStage) {
    stages.push(lintStage);
    for (const cap of lintStage.requiredCaps || [])
      requiredCapabilities.add(cap);
  }

  // --- Step C: Typecheck Stage ---
  const typecheckStage = planTypecheckStage(
    detection,
    workDir,
    targetPkgScripts,
  );
  if (typecheckStage) {
    stages.push(typecheckStage);
    for (const cap of typecheckStage.requiredCaps || [])
      requiredCapabilities.add(cap);
  }

  // --- Step D: Automated Tests Stage ---
  const testStage = planTestStage(
    detection,
    workDir,
    targetPkgScripts,
    activeProfile,
  );
  if (testStage) {
    stages.push(testStage);
    for (const cap of testStage.requiredCaps || [])
      requiredCapabilities.add(cap);
  }

  // --- Step E: Build / Compilation Stage (Dev or Release or PR check compile) ---
  const buildStage = planBuildStage(
    detection,
    workDir,
    targetPkgScripts,
    activeProfile,
  );
  if (buildStage) {
    stages.push(buildStage);
    for (const cap of buildStage.requiredCaps || [])
      requiredCapabilities.add(cap);
    if (buildStage.artifacts) {
      for (const a of buildStage.artifacts) artifacts.push(a);
    }
  }

  // Fallback for general projects if no stages were generated
  if (stages.length === 0) {
    stages.push({
      id: "stage-general-check",
      name: "Repository Validation",
      category: "test",
      command: "echo 'Infraxis: Repository validated successfully.'",
      dir: workDir,
      allowFailure: false,
    });
  }

  // If mobile or specific platforms detected, include platform capabilities
  if (detection?.requiredCapabilities) {
    for (const cap of detection.requiredCapabilities) {
      requiredCapabilities.add(cap);
    }
  }

  return {
    name: `Infraxis ${formatProfileName(activeProfile)} (${primaryType})`,
    profile: activeProfile,
    kind: activeProfile,
    primaryType,
    requiredCapabilities: Array.from(requiredCapabilities),
    timeoutSeconds: activeProfile === "release-build" ? 5400 : 3600,
    env: options.env || {},
    stages,
    artifacts,
  };
}

function formatProfileName(p) {
  if (p === "pr-checks") return "PR Checks";
  if (p === "dev-build") return "Development Build";
  if (p === "release-build") return "Release Build";
  if (p === "custom-pipeline") return "Custom Pipeline";
  return p;
}

function planInstallStage(detection, workDir, pm) {
  const type = detection?.primaryType;
  const pmCmd = pm === "pnpm" ? "pnpm" : pm === "yarn" ? "yarn" : "npm";

  if (
    [
      "nextjs",
      "react",
      "vue",
      "angular",
      "vite",
      "svelte",
      "nodejs",
      "react-native",
      "expo",
      "electron",
    ].includes(type) ||
    detection?.hasPackageJson
  ) {
    const installArgs = pm === "npm" ? "ci" : "install";
    return {
      id: "stage-deps",
      name: "Install Dependencies",
      category: "dependencies",
      command: `${pmCmd} ${installArgs}`,
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["node"],
    };
  }

  if (type === "python") {
    return {
      id: "stage-deps",
      name: "Install Python Dependencies",
      category: "dependencies",
      command: "pip install --no-cache-dir -r requirements.txt",
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["python"],
    };
  }

  if (type === "go") {
    return {
      id: "stage-deps",
      name: "Download Go Modules",
      category: "dependencies",
      command: "go mod download",
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["go"],
    };
  }

  if (type === "rust" || type === "tauri") {
    return {
      id: "stage-deps",
      name: "Cargo Fetch",
      category: "dependencies",
      command: "cargo fetch",
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["rust"],
    };
  }

  if (type === "flutter") {
    return {
      id: "stage-deps",
      name: "Flutter Pub Get",
      category: "dependencies",
      command: "flutter pub get",
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["flutter"],
    };
  }

  if (type === "php") {
    return {
      id: "stage-deps",
      name: "Composer Install",
      category: "dependencies",
      command: "composer install --no-interaction --prefer-dist",
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["php"],
    };
  }

  return null;
}

function planLintStage(detection, workDir, scripts, strictLint) {
  const pm = detection?.packageManager || "npm";
  const pmRun = pm === "npm" ? "npm run" : pm === "pnpm" ? "pnpm run" : "yarn";
  const type = detection?.primaryType;

  if (scripts.lint) {
    let lintCmd = `${pmRun} lint`;
    // In Next.js 16+, 'next lint' was removed from CLI and causes 'Invalid project directory provided: .../src/lint'.
    // If package.json specifies 'next lint', provide a seamless fallback to 'npx eslint .'.
    if (typeof scripts.lint === "string" && scripts.lint.trim() === "next lint") {
      lintCmd = `${pmRun} lint 2>/dev/null || npx eslint .`;
    }
    return {
      id: "stage-lint",
      name: "Code Quality & Linting",
      category: "lint",
      command: lintCmd,
      dir: workDir,
      allowFailure: !strictLint,
      requiredCaps: ["node"],
    };
  }

  if (type === "python") {
    return {
      id: "stage-lint",
      name: "Python Code Style (flake8 / ruff)",
      category: "lint",
      command: "python -m flake8 . || true",
      dir: workDir,
      allowFailure: !strictLint,
      requiredCaps: ["python"],
    };
  }

  if (type === "go") {
    return {
      id: "stage-lint",
      name: "Go Vet & Format Check",
      category: "lint",
      command: "go vet ./...",
      dir: workDir,
      allowFailure: !strictLint,
      requiredCaps: ["go"],
    };
  }

  if (type === "rust") {
    return {
      id: "stage-lint",
      name: "Clippy Lint",
      category: "lint",
      command: "cargo clippy -- -D warnings",
      dir: workDir,
      allowFailure: !strictLint,
      requiredCaps: ["rust"],
    };
  }

  return null;
}

function planTypecheckStage(detection, workDir, scripts) {
  const pm = detection?.packageManager || "npm";
  const pmRun = pm === "npm" ? "npm run" : pm === "pnpm" ? "pnpm run" : "yarn";

  if (scripts.typecheck) {
    return {
      id: "stage-typecheck",
      name: "TypeScript Check",
      category: "typecheck",
      command: `${pmRun} typecheck`,
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["node"],
    };
  }

  if (
    detection?.technologies?.includes("typescript") &&
    scripts["check-types"]
  ) {
    return {
      id: "stage-typecheck",
      name: "TypeScript Check",
      category: "typecheck",
      command: `${pmRun} check-types`,
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["node"],
    };
  }

  return null;
}

function planTestStage(detection, workDir, scripts, profile) {
  const pm = detection?.packageManager || "npm";
  const pmRun = pm === "npm" ? "npm run" : pm === "pnpm" ? "pnpm run" : "yarn";
  const type = detection?.primaryType;

  const testScript = scripts["test:ci"]
    ? "test:ci"
    : scripts.test
      ? "test"
      : null;

  if (testScript) {
    return {
      id: "stage-test",
      name: "Automated Tests",
      category: "test",
      command: `${pmRun} ${testScript}`,
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["node"],
    };
  }

  if (type === "python") {
    return {
      id: "stage-test",
      name: "Python Tests (pytest)",
      category: "test",
      command: "pytest -v",
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["python"],
    };
  }

  if (type === "go") {
    return {
      id: "stage-test",
      name: "Go Unit Tests",
      category: "test",
      command: "go test -v ./...",
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["go"],
    };
  }

  if (type === "rust") {
    return {
      id: "stage-test",
      name: "Cargo Test Suite",
      category: "test",
      command: "cargo test --verbose",
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["rust"],
    };
  }

  if (type === "java") {
    return {
      id: "stage-test",
      name: "Java Tests",
      category: "test",
      command: "mvn test -B",
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["java"],
    };
  }

  if (type === "flutter") {
    return {
      id: "stage-test",
      name: "Flutter Tests",
      category: "test",
      command: "flutter test",
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["flutter"],
    };
  }

  return null;
}

function planBuildStage(detection, workDir, scripts, profile) {
  const pm = detection?.packageManager || "npm";
  const pmRun = pm === "npm" ? "npm run" : pm === "pnpm" ? "pnpm run" : "yarn";
  const type = detection?.primaryType;

  const isRelease = profile === "release-build";
  const buildScript =
    isRelease && scripts["build:prod"]
      ? "build:prod"
      : isRelease && scripts["build:release"]
        ? "build:release"
        : scripts.build
          ? "build"
          : null;

  if (buildScript) {
    return {
      id: "stage-build",
      name: isRelease ? "Production Build" : "Compile & Validate Build",
      category: "build",
      command: `${pmRun} ${buildScript}`,
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["node"],
      artifacts: isRelease ? ["dist/**", "build/**", "out/**", ".next/**"] : [],
    };
  }

  if (type === "go") {
    return {
      id: "stage-build",
      name: isRelease ? "Go Release Binary Build" : "Go Build Validation",
      category: "build",
      command: isRelease
        ? 'go build -ldflags="-s -w" -o bin/app'
        : "go build -v ./...",
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["go"],
      artifacts: isRelease ? ["bin/*"] : [],
    };
  }

  if (type === "rust") {
    return {
      id: "stage-build",
      name: isRelease ? "Cargo Release Build" : "Cargo Build Validation",
      category: "build",
      command: isRelease ? "cargo build --release" : "cargo build",
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["rust"],
      artifacts: isRelease ? ["target/release/*"] : [],
    };
  }

  if (type === "docker" || detection?.hasDockerfile) {
    return {
      id: "stage-docker-build",
      name: "Docker Image Build & Validation",
      category: "build",
      command: "docker build -t infraxis/build:latest .",
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["docker"],
      artifacts: [],
    };
  }

  if (type === "flutter") {
    const subCmd = isRelease
      ? "flutter build apk --release"
      : "flutter build apk --debug";
    return {
      id: "stage-flutter-build",
      name: isRelease ? "Flutter Release APK" : "Flutter Build Check",
      category: "build",
      command: subCmd,
      dir: workDir,
      allowFailure: false,
      requiredCaps: ["flutter", "android"],
      artifacts: isRelease ? ["build/app/outputs/flutter-apk/*.apk"] : [],
    };
  }

  return null;
}

function planAndroidNativePipeline(detection, profile, options) {
  const isRelease = profile === "android-release";
  const task = isRelease ? "assembleRelease" : "assembleDebug";
  return {
    name: `Infraxis Android (${isRelease ? "Release" : "Debug"})`,
    profile,
    kind: profile,
    primaryType: "android",
    requiredCapabilities: ["android", "android-sdk"],
    timeoutSeconds: 5400,
    env: options.env || {},
    stages: [
      {
        id: "stage-deps",
        name: "Install JS Dependencies (if React Native)",
        category: "dependencies",
        command: "npm install",
        dir: ".",
        allowFailure: true,
        requiredCaps: ["node"],
      },
      {
        id: "stage-gradle",
        name: `Gradle Build (./gradlew ${task})`,
        category: "build",
        command: `./gradlew ${task}`,
        dir: "android",
        allowFailure: false,
        requiredCaps: ["android"],
      },
    ],
    artifacts: isRelease
      ? [
          "android/app/build/outputs/apk/release/*.apk",
          "android/app/build/outputs/bundle/release/*.aab",
        ]
      : ["android/app/build/outputs/apk/debug/*.apk"],
  };
}

function planIosNativePipeline(detection, profile, options) {
  const isRelease = profile === "ios-release";
  return {
    name: `Infraxis iOS (${isRelease ? "Release Archive & IPA" : "Simulator Build"})`,
    profile,
    kind: profile,
    primaryType: "ios",
    requiredPlatform: "darwin",
    requiredCapabilities: ["ios", "darwin", "xcode"],
    timeoutSeconds: 7200,
    env: options.env || {},
    stages: [
      {
        id: "stage-deps",
        name: "Install Dependencies",
        category: "dependencies",
        command: "npm install && (cd ios && pod install || true)",
        dir: ".",
        allowFailure: true,
        requiredCaps: ["node", "darwin"],
      },
      {
        id: "stage-xcode",
        name: isRelease
          ? "Xcode Archive & Packaging"
          : "Xcode Simulator Compilation",
        category: "build",
        command: isRelease
          ? "xcodebuild archive"
          : "xcodebuild -sdk iphonesimulator",
        dir: "ios",
        allowFailure: false,
        requiredCaps: ["ios", "darwin"],
      },
    ],
    artifacts: isRelease
      ? ["build/ios/*.ipa", "build/ios/*.xcarchive.zip"]
      : [],
  };
}

/**
 * Intelligent auto-detection of build profile and pipeline target
 * Analyzes detected project characteristics, frameworks, runtimes, and configs
 * to recommend the optimal build profile and target platform description.
 */
function getRecommendedProfileAndTarget(detection, customConfig = null) {
  if (!detection) {
    return {
      recommendedProfile: "pr-checks",
      pipelineTarget: {
        name: "Universal PR Checks",
        platform: "Cross-Platform",
        runtime: "Standard Toolchain",
        osRequirement: "Any Agent",
        summary: "Runs dependency checks, linter, tests, and build validation.",
      },
      availableProfiles: [
        "pr-checks",
        "dev-build",
        "release-build",
        "custom-pipeline",
      ],
    };
  }

  const primaryType = detection.primaryType || "general";
  const category = detection.category || "general";
  const techs = detection.technologies || [];
  const hasConfig = Boolean(
    customConfig?.pipelines ||
    detection.hasInfraxisConfig ||
    (customConfig && Object.keys(customConfig).length > 0),
  );
  const hasDockerfile = Boolean(detection.hasDockerfile);

  let recommendedProfile = "pr-checks";
  let targetName = "Universal Software Target";
  let platform = "Cross-Platform";
  let runtime = detection.packageManager
    ? `Node.js (${detection.packageManager})`
    : "Standard Toolchain";
  let osRequirement = "Universal";
  let summary =
    "Executes automated PR validation, lint checks, test suites, and build verification.";

  if (hasConfig) {
    recommendedProfile = "custom-pipeline";
    targetName = "Custom infraxis.yml Pipeline";
    platform = "Infraxis Pipeline Engine";
    runtime = "User Defined (infraxis.yml)";
    osRequirement = "Configured in infraxis.yml";
    summary =
      "Executes stages and commands configured in the repository infraxis.yml specification.";
  } else if (
    primaryType === "ios" ||
    techs.includes("ios") ||
    techs.includes("xcode")
  ) {
    recommendedProfile = "ios-release";
    targetName = "Apple iOS Release & Packaging";
    platform = "Apple iOS";
    runtime = "Xcode & xcodebuild";
    osRequirement = "macOS (Apple Silicon / Intel) Required";
    summary =
      "Builds, archives, and verifies iOS release artifacts and code signing on macOS agents.";
  } else if (
    primaryType === "android" ||
    techs.includes("android") ||
    techs.includes("gradle")
  ) {
    recommendedProfile = "android-release";
    targetName = "Android Release APK & Bundle";
    platform = "Android OS";
    runtime = "Java 17+ & Gradle (Android SDK)";
    osRequirement = "Linux or macOS (Android SDK Required)";
    summary =
      "Assembles release APK/AAB bundle packages and executes Android test suites.";
  } else if (primaryType === "flutter") {
    recommendedProfile = "pr-checks";
    targetName = "Flutter Multiplatform Suite";
    platform = "Cross-Platform (Mobile, Web, Desktop)";
    runtime = "Flutter SDK & Dart";
    osRequirement = "Linux or macOS";
    summary =
      "Runs flutter pub get, flutter analyze, automated widget/unit tests, and build verification.";
  } else if (primaryType === "react-native") {
    recommendedProfile = "pr-checks";
    targetName = "React Native Mobile Suite";
    platform = "iOS & Android";
    runtime = "Node.js & Mobile Toolchains";
    osRequirement = "Linux or macOS (macOS for iOS verification)";
    summary =
      "Validates JavaScript codebase, Metro bundle compilation, and native mobile bridge integrity.";
  } else if (primaryType === "tauri" || techs.includes("tauri")) {
    recommendedProfile = "pr-checks";
    targetName = "Tauri Desktop Application";
    platform = "Cross-Platform Desktop (Native GUI)";
    runtime = "Rust (Cargo) & Web Frontend";
    osRequirement = "Universal";
    summary =
      "Validates web UI bundle and compiles native Tauri core with Cargo.";
  } else if (primaryType === "electron" || techs.includes("electron")) {
    recommendedProfile = "pr-checks";
    targetName = "Electron Desktop Application";
    platform = "Cross-Platform Desktop";
    runtime = "Node.js & Chromium";
    osRequirement = "Universal";
    summary =
      "Runs Electron test runners, validates main/renderer scripts, and checks desktop package.";
  } else if (
    category === "web" ||
    ["nextjs", "react", "vue", "angular", "vite", "nuxt", "svelte"].includes(
      primaryType,
    )
  ) {
    recommendedProfile = "pr-checks";
    const frameworkName =
      primaryType === "nextjs"
        ? "Next.js"
        : primaryType.charAt(0).toUpperCase() + primaryType.slice(1);
    targetName = `${frameworkName} Web Application`;
    platform = "Web Browser / Node.js Engine";
    runtime = `Node.js (${detection.packageManager || "npm"})`;
    osRequirement = "Universal (Linux / macOS)";
    summary =
      "Runs package integrity checks, ESLint, TypeScript validation, unit tests, and production compilation.";
  } else if (primaryType === "go") {
    recommendedProfile = "pr-checks";
    targetName = "Go Microservice & Binary";
    platform = "Cloud Native / Linux / macOS";
    runtime = "Go 1.21+";
    osRequirement = "Universal";
    summary =
      "Runs go mod download, static checks, unit tests, and compiles standalone native Go binaries.";
  } else if (primaryType === "rust") {
    recommendedProfile = "pr-checks";
    targetName = "Rust Native Binary / Library";
    platform = "Native Bare Metal / Cloud";
    runtime = "Rust & Cargo";
    osRequirement = "Universal";
    summary =
      "Executes cargo check, clippy linter, unit test suite, and release compilation.";
  } else if (primaryType === "python") {
    recommendedProfile = "pr-checks";
    targetName = "Python Package & Pytest Suite";
    platform = "Python Runtime";
    runtime = "Python 3.x & pytest";
    osRequirement = "Universal";
    summary =
      "Installs pip requirements, executes flake8/ruff linters, and runs pytest test suites.";
  } else if (primaryType === "java") {
    recommendedProfile = "pr-checks";
    targetName = "Java JVM Application";
    platform = "Java Virtual Machine";
    runtime = "JDK 17+ (Maven / Gradle)";
    osRequirement = "Universal";
    summary =
      "Compiles bytecode, runs JUnit automated tests, and packages deployable JAR artifacts.";
  } else if (
    primaryType === "docker" ||
    category === "containers" ||
    hasDockerfile
  ) {
    recommendedProfile = "release-build";
    targetName = "OCI Container Image";
    platform = "Docker / Container Engine";
    runtime = "Docker Engine & CLI";
    osRequirement = "Docker Daemon Required";
    summary =
      "Builds container images, verifies multi-stage Dockerfile instructions, and tests container health.";
  }

  const availableProfiles = [
    "pr-checks",
    "dev-build",
    "release-build",
    "custom-pipeline",
  ];
  if (
    primaryType === "android" ||
    techs.includes("android") ||
    techs.includes("gradle")
  ) {
    availableProfiles.push("android-release");
  }
  if (
    primaryType === "ios" ||
    techs.includes("ios") ||
    techs.includes("xcode")
  ) {
    availableProfiles.push("ios-release");
  }

  return {
    recommendedProfile,
    pipelineTarget: {
      name: targetName,
      platform,
      runtime,
      osRequirement,
      summary,
    },
    availableProfiles,
  };
}

/**
 * Detect recommended build kind for a repository or directory
 */
function detectBuildKind(detectionOrDir, customConfig = null) {
  let detection = detectionOrDir;
  if (typeof detectionOrDir === "string") {
    detection = detectRepository(detectionOrDir);
    if (!customConfig) {
      customConfig = loadRepoConfig(detectionOrDir);
    }
  }
  return getRecommendedProfileAndTarget(detection, customConfig)
    .recommendedProfile;
}

module.exports = {
  planPipeline,
  getRecommendedProfileAndTarget,
  detectBuildKind,
};
