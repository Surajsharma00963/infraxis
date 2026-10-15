"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Universal Project Type Detector for Infraxis CI/CD
 * Supports Mobile (React Native, Expo, Flutter, Android, iOS),
 * Web (Next.js, React, Vue, Angular, Vite),
 * Backend (Node.js, Python, Java, Go, Rust, PHP, .NET),
 * Desktop (Electron, Tauri),
 * Containers (Docker),
 * and Monorepos (pnpm, yarn, npm, Turborepo, Nx, Lerna).
 */

function safeReadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {}
  return null;
}

function safeReadText(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8");
    }
  } catch {}
  return null;
}

function dirHasFilesMatching(dirPath, regex) {
  try {
    if (!fs.existsSync(dirPath)) return false;
    const entries = fs.readdirSync(dirPath);
    return entries.some((e) => regex.test(e));
  } catch {
    return false;
  }
}

/**
 * Detect project types for a single directory (root or subproject)
 */
function detectSingleDirectory(targetDir) {
  const pkgPath = path.join(targetDir, "package.json");
  const pkg = safeReadJson(pkgPath);
  const pkgDeps = {
    ...(pkg?.dependencies || {}),
    ...(pkg?.devDependencies || {}),
    ...(pkg?.peerDependencies || {}),
  };
  const pkgScripts = pkg?.scripts || {};

  const detectedTech = new Set();
  const projectTypes = [];
  let category = "general";
  let primaryType = "general";
  const requiredCapabilities = new Set();

  if (pkg) {
    detectedTech.add("node");
    requiredCapabilities.add("node");
  }

  // 1. Mobile Detection
  const hasPubspec = fs.existsSync(path.join(targetDir, "pubspec.yaml"));
  const pubspecContent = hasPubspec ? safeReadText(path.join(targetDir, "pubspec.yaml")) : "";
  const isFlutter = hasPubspec && (pubspecContent?.includes("flutter:") || pubspecContent?.includes("sdk: flutter"));

  const hasAndroidDir = fs.existsSync(path.join(targetDir, "android"));
  const hasIosDir = fs.existsSync(path.join(targetDir, "ios"));
  const hasAppJson = fs.existsSync(path.join(targetDir, "app.json"));
  const appJson = hasAppJson ? safeReadJson(path.join(targetDir, "app.json")) : null;

  const isReactNative = Boolean(pkgDeps["react-native"]);
  const isExpo = Boolean(pkgDeps["expo"] || appJson?.expo);

  const hasGradle =
    fs.existsSync(path.join(targetDir, "build.gradle")) ||
    fs.existsSync(path.join(targetDir, "build.gradle.kts")) ||
    fs.existsSync(path.join(targetDir, "settings.gradle")) ||
    fs.existsSync(path.join(targetDir, "gradlew"));

  const isNativeAndroid =
    (hasGradle &&
      (safeReadText(path.join(targetDir, "build.gradle"))?.includes("com.android") ||
        safeReadText(path.join(targetDir, "build.gradle.kts"))?.includes("com.android") ||
        fs.existsSync(path.join(targetDir, "app/build.gradle")) ||
        fs.existsSync(path.join(targetDir, "app/src/main/AndroidManifest.xml")))) ||
    (hasAndroidDir &&
      (fs.existsSync(path.join(targetDir, "android/build.gradle")) ||
        fs.existsSync(path.join(targetDir, "android/app/build.gradle")) ||
        fs.existsSync(path.join(targetDir, "android/settings.gradle"))));

  const isNativeIos =
    fs.existsSync(path.join(targetDir, "Podfile")) ||
    dirHasFilesMatching(targetDir, /\.xcodeproj$/i) ||
    dirHasFilesMatching(targetDir, /\.xcworkspace$/i) ||
    fs.existsSync(path.join(targetDir, "Package.swift")) ||
    (hasIosDir &&
      (fs.existsSync(path.join(targetDir, "ios/Podfile")) ||
        dirHasFilesMatching(path.join(targetDir, "ios"), /\.xcodeproj$/i) ||
        dirHasFilesMatching(path.join(targetDir, "ios"), /\.xcworkspace$/i)));

  if (isFlutter) {
    detectedTech.add("flutter");
    detectedTech.add("dart");
    projectTypes.push("flutter");
    category = "mobile";
    primaryType = "flutter";
    requiredCapabilities.add("flutter");
  } else if (isExpo) {
    detectedTech.add("expo");
    detectedTech.add("react-native");
    detectedTech.add("react");
    projectTypes.push("expo");
    category = "mobile";
    primaryType = "expo";
    requiredCapabilities.add("node");
  } else if (isReactNative) {
    detectedTech.add("react-native");
    detectedTech.add("react");
    projectTypes.push("react-native");
    category = "mobile";
    primaryType = "react-native";
    requiredCapabilities.add("node");
    if (hasAndroidDir) requiredCapabilities.add("android");
    if (hasIosDir || isNativeIos) {
      detectedTech.add("ios");
      requiredCapabilities.add("ios");
    }
  } else if (isNativeAndroid) {
    detectedTech.add("android");
    detectedTech.add("gradle");
    projectTypes.push("android");
    category = "mobile";
    primaryType = "android";
    requiredCapabilities.add("android");
  } else if (isNativeIos) {
    detectedTech.add("ios");
    detectedTech.add("xcode");
    projectTypes.push("ios");
    category = "mobile";
    primaryType = "ios";
    requiredCapabilities.add("ios");
    requiredCapabilities.add("darwin");
  }

  // 2. Desktop Detection
  const isElectron = Boolean(pkgDeps["electron"]);
  const isTauri =
    fs.existsSync(path.join(targetDir, "src-tauri/Cargo.toml")) ||
    fs.existsSync(path.join(targetDir, "tauri.conf.json")) ||
    Boolean(pkgDeps["@tauri-apps/api"]);

  if (isTauri) {
    detectedTech.add("tauri");
    detectedTech.add("rust");
    projectTypes.push("tauri");
    if (category === "general") category = "desktop";
    if (primaryType === "general") primaryType = "tauri";
    requiredCapabilities.add("rust");
  } else if (isElectron) {
    detectedTech.add("electron");
    projectTypes.push("electron");
    if (category === "general") category = "desktop";
    if (primaryType === "general") primaryType = "electron";
    requiredCapabilities.add("node");
  }

  // 3. Web Frameworks Detection
  const isNext = Boolean(
    pkgDeps["next"] ||
      fs.existsSync(path.join(targetDir, "next.config.js")) ||
      fs.existsSync(path.join(targetDir, "next.config.ts")) ||
      fs.existsSync(path.join(targetDir, "next.config.mjs"))
  );
  const isNuxt = Boolean(
    pkgDeps["nuxt"] ||
      fs.existsSync(path.join(targetDir, "nuxt.config.js")) ||
      fs.existsSync(path.join(targetDir, "nuxt.config.ts"))
  );
  const isVue = Boolean(pkgDeps["vue"] || isNuxt);
  const isAngular = Boolean(
    pkgDeps["@angular/core"] || fs.existsSync(path.join(targetDir, "angular.json"))
  );
  const isSvelte = Boolean(
    pkgDeps["svelte"] ||
      pkgDeps["@sveltejs/kit"] ||
      fs.existsSync(path.join(targetDir, "svelte.config.js"))
  );
  const isVite = Boolean(
    pkgDeps["vite"] ||
      dirHasFilesMatching(targetDir, /^vite\.config\.(js|ts|mjs|cjs)$/)
  );
  const isReact = Boolean(pkgDeps["react"]) && !isReactNative && !isExpo;

  if (isNext) {
    detectedTech.add("nextjs");
    detectedTech.add("react");
    projectTypes.push("nextjs");
    if (category === "general") category = "web";
    if (primaryType === "general") primaryType = "nextjs";
    requiredCapabilities.add("node");
  } else if (isNuxt) {
    detectedTech.add("nuxt");
    detectedTech.add("vue");
    projectTypes.push("nuxt");
    if (category === "general") category = "web";
    if (primaryType === "general") primaryType = "nuxt";
    requiredCapabilities.add("node");
  } else if (isVue) {
    detectedTech.add("vue");
    projectTypes.push("vue");
    if (category === "general") category = "web";
    if (primaryType === "general") primaryType = "vue";
    requiredCapabilities.add("node");
  } else if (isAngular) {
    detectedTech.add("angular");
    projectTypes.push("angular");
    if (category === "general") category = "web";
    if (primaryType === "general") primaryType = "angular";
    requiredCapabilities.add("node");
  } else if (isSvelte) {
    detectedTech.add("svelte");
    projectTypes.push("svelte");
    if (category === "general") category = "web";
    if (primaryType === "general") primaryType = "svelte";
    requiredCapabilities.add("node");
  } else if (isVite) {
    detectedTech.add("vite");
    projectTypes.push("vite");
    if (category === "general") category = "web";
    if (primaryType === "general") primaryType = "vite";
    requiredCapabilities.add("node");
  } else if (isReact) {
    detectedTech.add("react");
    projectTypes.push("react");
    if (category === "general") category = "web";
    if (primaryType === "general") primaryType = "react";
    requiredCapabilities.add("node");
  }

  // 4. Backend & Language Detection
  const hasGoMod = fs.existsSync(path.join(targetDir, "go.mod"));
  const hasCargo = fs.existsSync(path.join(targetDir, "Cargo.toml")) && !isTauri;
  const hasPython =
    fs.existsSync(path.join(targetDir, "requirements.txt")) ||
    fs.existsSync(path.join(targetDir, "pyproject.toml")) ||
    fs.existsSync(path.join(targetDir, "Pipfile")) ||
    fs.existsSync(path.join(targetDir, "setup.py"));
  const hasMaven =
    fs.existsSync(path.join(targetDir, "pom.xml")) ||
    fs.existsSync(path.join(targetDir, "mvnw"));
  const hasJavaGradle = hasGradle && !isNativeAndroid && !isReactNative;
  const hasComposer = fs.existsSync(path.join(targetDir, "composer.json"));
  const hasDotnet =
    dirHasFilesMatching(targetDir, /\.(csproj|sln|fsproj)$/i);

  if (hasGoMod) {
    detectedTech.add("go");
    projectTypes.push("go");
    if (category === "general") category = "backend";
    if (primaryType === "general") primaryType = "go";
    requiredCapabilities.add("go");
  }
  if (hasCargo) {
    detectedTech.add("rust");
    projectTypes.push("rust");
    if (category === "general") category = "backend";
    if (primaryType === "general") primaryType = "rust";
    requiredCapabilities.add("rust");
  }
  if (hasPython) {
    detectedTech.add("python");
    projectTypes.push("python");
    if (category === "general") category = "backend";
    if (primaryType === "general") primaryType = "python";
    requiredCapabilities.add("python");
  }
  if (hasMaven || hasJavaGradle) {
    detectedTech.add("java");
    if (hasMaven) detectedTech.add("maven");
    if (hasJavaGradle) detectedTech.add("gradle");
    projectTypes.push("java");
    if (category === "general") category = "backend";
    if (primaryType === "general") primaryType = "java";
    requiredCapabilities.add("java");
  }
  if (hasComposer) {
    detectedTech.add("php");
    projectTypes.push("php");
    if (category === "general") category = "backend";
    if (primaryType === "general") primaryType = "php";
    requiredCapabilities.add("php");
  }
  if (hasDotnet) {
    detectedTech.add("dotnet");
    projectTypes.push("dotnet");
    if (category === "general") category = "backend";
    if (primaryType === "general") primaryType = "dotnet";
    requiredCapabilities.add("dotnet");
  }

  // Pure Node backend if not web or mobile
  if (pkg && category === "general" && !isNext && !isReact && !isVue && !isAngular) {
    detectedTech.add("nodejs");
    projectTypes.push("nodejs");
    category = "backend";
    primaryType = "nodejs";
    requiredCapabilities.add("node");
  }

  // 5. Container Detection
  const hasDockerfile =
    fs.existsSync(path.join(targetDir, "Dockerfile")) ||
    fs.existsSync(path.join(targetDir, "Containerfile")) ||
    dirHasFilesMatching(targetDir, /^Dockerfile\./i);
  const hasCompose =
    fs.existsSync(path.join(targetDir, "docker-compose.yml")) ||
    fs.existsSync(path.join(targetDir, "docker-compose.yaml")) ||
    fs.existsSync(path.join(targetDir, "compose.yml")) ||
    fs.existsSync(path.join(targetDir, "compose.yaml"));

  if (hasDockerfile || hasCompose) {
    detectedTech.add("docker");
    projectTypes.push("docker");
    if (primaryType === "general") {
      category = "containers";
      primaryType = "docker";
      requiredCapabilities.add("docker");
    }
  }

  // 6. Generic or Custom Build Configuration Detection
  const hasInfraxisYml =
    fs.existsSync(path.join(targetDir, "infraxis.yml")) ||
    fs.existsSync(path.join(targetDir, ".infraxis.yml"));
  const hasMakefile = fs.existsSync(path.join(targetDir, "Makefile"));

  if (hasInfraxisYml) {
    detectedTech.add("infraxis-config");
  }
  if (hasMakefile) {
    detectedTech.add("makefile");
  }

  // TypeScript check
  if (
    Boolean(pkgDeps["typescript"]) ||
    fs.existsSync(path.join(targetDir, "tsconfig.json"))
  ) {
    detectedTech.add("typescript");
  }

  // Default script commands
  const commands = {
    install: pkg ? "npm install" : null,
    build: pkgScripts.build ? "npm run build" : null,
    test: pkgScripts.test ? "npm test" : null,
    lint: pkgScripts.lint ? "npm run lint" : null,
  };

  if (primaryType === "flutter") {
    commands.install = "flutter pub get";
    commands.build = "flutter build apk";
    commands.test = "flutter test";
  } else if (primaryType === "go") {
    commands.install = "go mod download";
    commands.build = "go build ./...";
    commands.test = "go test ./...";
  } else if (primaryType === "python") {
    commands.install = "pip install -r requirements.txt";
    commands.test = "pytest";
  } else if (primaryType === "java") {
    commands.build = "mvn package";
    commands.test = "mvn test";
  } else if (primaryType === "rust" || primaryType === "tauri") {
    commands.install = "cargo fetch";
    commands.build = "cargo build";
    commands.test = "cargo test";
  } else if (primaryType === "docker") {
    commands.build = "docker build .";
  }

  return {
    primaryType,
    category,
    projectTypes: Array.from(new Set(projectTypes)),
    technologies: Array.from(detectedTech),
    requiredCapabilities: Array.from(requiredCapabilities),
    commands,
    hasPackageJson: Boolean(pkg),
    pkgScripts,
    pkgName: pkg?.name || path.basename(targetDir),
    hasInfraxisConfig: hasInfraxisYml,
    hasDockerfile,
  };
}

/**
 * Detect monorepo structure and all contained apps
 */
function detectRepository(repoDir) {
  if (!fs.existsSync(repoDir) || !fs.statSync(repoDir).isDirectory()) {
    throw new Error(`Target path is not a directory: ${repoDir}`);
  }

  // 1. Detect root characteristics
  const rootDetection = detectSingleDirectory(repoDir);

  // 2. Monorepo detection
  let hasPnpmWorkspace = false;
  const pnpmWorkspacePath = path.join(repoDir, "pnpm-workspace.yaml");
  if (fs.existsSync(pnpmWorkspacePath)) {
    try {
      const pnpmWsContent = fs.readFileSync(pnpmWorkspacePath, "utf8");
      // Only treat as monorepo if it defines packages: pattern
      hasPnpmWorkspace = /^\s*packages\s*:/m.test(pnpmWsContent);
    } catch {
      hasPnpmWorkspace = false;
    }
  }
  const hasLerna = fs.existsSync(path.join(repoDir, "lerna.json"));
  const hasTurbo = fs.existsSync(path.join(repoDir, "turbo.json"));
  const hasNx = fs.existsSync(path.join(repoDir, "nx.json"));
  const rootPkg = safeReadJson(path.join(repoDir, "package.json"));
  const hasNpmWorkspaces = Array.isArray(rootPkg?.workspaces) || Array.isArray(rootPkg?.workspaces?.packages);

  let monorepoType = null;
  if (hasPnpmWorkspace) monorepoType = "pnpm";
  else if (hasTurbo) monorepoType = "turbo";
  else if (hasNx) monorepoType = "nx";
  else if (hasLerna) monorepoType = "lerna";
  else if (hasNpmWorkspaces) {
    monorepoType = fs.existsSync(path.join(repoDir, "yarn.lock")) ? "yarn" : "npm";
  }

  // 3. Scan for sub-projects in common workspace patterns
  const candidateSubDirs = ["apps", "packages", "services", "projects", "modules", "client", "server", "frontend", "backend", "web", "api"];
  const subApps = [];

  for (const cand of candidateSubDirs) {
    const candPath = path.join(repoDir, cand);
    if (!fs.existsSync(candPath) || !fs.statSync(candPath).isDirectory()) continue;

    // Check if cand itself is an app (e.g. client/ or server/ or frontend/)
    const directApp = detectSingleDirectory(candPath);
    if (directApp.primaryType !== "general" || directApp.hasPackageJson) {
      subApps.push({
        name: cand,
        path: cand,
        ...directApp,
      });
    }

    // Check subdirectories within apps/, packages/, etc.
    try {
      const children = fs.readdirSync(candPath);
      for (const child of children) {
        if (child.startsWith(".")) continue;
        const childPath = path.join(candPath, child);
        if (!fs.statSync(childPath).isDirectory()) continue;

        const subDetection = detectSingleDirectory(childPath);
        if (subDetection.primaryType !== "general" || subDetection.hasPackageJson) {
          subApps.push({
            name: subDetection.pkgName || `${cand}/${child}`,
            path: `${cand}/${child}`,
            ...subDetection,
          });
        }
      }
    } catch {}
  }

  const isMonorepo = (Boolean(monorepoType) && subApps.length > 0) || subApps.length > 1;

  // Aggregate all technologies across root and sub-apps
  const allTech = new Set(rootDetection.technologies);
  const allReqCaps = new Set(rootDetection.requiredCapabilities);
  for (const app of subApps) {
    for (const t of app.technologies) allTech.add(t);
    for (const c of app.requiredCapabilities) allReqCaps.add(c);
  }

  // Package manager detection
  let packageManager = "npm";
  if (fs.existsSync(path.join(repoDir, "pnpm-lock.yaml")) || hasPnpmWorkspace) {
    packageManager = "pnpm";
  } else if (fs.existsSync(path.join(repoDir, "yarn.lock"))) {
    packageManager = "yarn";
  }

  // Primary project determination
  let primaryType = rootDetection.primaryType;
  let category = rootDetection.category;

  if (primaryType === "general" && subApps.length > 0) {
    primaryType = subApps[0].primaryType;
    category = subApps[0].category;
  }

  return {
    path: repoDir,
    name: rootDetection.pkgName || path.basename(repoDir),
    primaryType,
    category,
    isMonorepo,
    monorepoType,
    packageManager,
    technologies: Array.from(allTech),
    requiredCapabilities: Array.from(allReqCaps),
    subApps,
    commands: rootDetection.commands || {},
    hasInfraxisConfig: rootDetection.hasInfraxisConfig,
    hasDockerfile: rootDetection.hasDockerfile,
    rootDetails: rootDetection,
  };
}

module.exports = {
  detectRepository,
  detectSingleDirectory,
  detectProjectType: detectRepository,
};
