"use strict";

const { loadRepoConfig } = require("./config-parser");
const { getRecommendedProfileAndTarget } = require("./pipeline");

/**
 * Universal Remote Repository Detector for GitHub and Bitbucket
 * Inspects trees and manifests via provider APIs without executing untrusted code.
 */

async function detectRemoteRepository({
  adapter,
  token,
  owner,
  repo,
  ref = "HEAD",
}) {
  // 1. Fetch file tree
  let tree = [];
  try {
    tree = await adapter.getTree({ token, owner, repo, ref, recursive: true });
  } catch (err) {
    console.warn(
      `[Remote Detector] Tree fetch failed (${err.message}), falling back to direct file probes`,
    );
  }

  const filePaths = new Set(tree.map((t) => t.path));

  // Helper to check if file exists in tree or probe via API if tree is empty
  async function fileExists(path) {
    if (filePaths.size > 0) return filePaths.has(path);
    try {
      const content = await adapter.getFileContent({
        token,
        owner,
        repo,
        path,
        ref,
      });
      return content !== null;
    } catch {
      return false;
    }
  }

  // Helper to read file content safely
  async function readFile(path) {
    try {
      return await adapter.getFileContent({ token, owner, repo, path, ref });
    } catch {
      return null;
    }
  }

  // Helper to safe JSON parse
  function safeJson(str) {
    try {
      return str ? JSON.parse(str) : null;
    } catch {
      return null;
    }
  }

  // 2. Read manifests
  const [
    pkgContent,
    pubspecContent,
    infraxisYaml,
    dotInfraxisYaml,
    gradleRootFile,
    gradleKtsFile,
    appGradle,
    podfileContent,
    goModContent,
    reqsTxtContent,
    pyprojectContent,
    pomXmlContent,
    dockerfileContent,
  ] = await Promise.all([
    readFile("package.json"),
    readFile("pubspec.yaml"),
    readFile("infraxis.yml"),
    readFile(".infraxis.yml"),
    readFile("build.gradle"),
    readFile("build.gradle.kts"),
    readFile("app/build.gradle"),
    readFile("Podfile"),
    readFile("go.mod"),
    readFile("requirements.txt"),
    readFile("pyproject.toml"),
    readFile("pom.xml"),
    readFile("Dockerfile"),
  ]);

  const gradleRoot = gradleRootFile || gradleKtsFile;

  const pkg = safeJson(pkgContent);
  const pkgDeps = {
    ...(pkg?.dependencies || {}),
    ...(pkg?.devDependencies || {}),
    ...(pkg?.peerDependencies || {}),
  };
  const pkgScripts = pkg?.scripts || {};

  const detectedTech = new Set();
  const requiredCapabilities = new Set();
  let primaryType = "general";
  let category = "general";

  // Monorepo detection
  const hasPnpmWorkspace = await fileExists("pnpm-workspace.yaml");
  const hasLerna = await fileExists("lerna.json");
  const hasTurbo = await fileExists("turbo.json");
  const hasNx = await fileExists("nx.json");

  let monorepoType = null;
  if (hasTurbo) monorepoType = "turborepo";
  else if (hasNx) monorepoType = "nx";
  else if (hasPnpmWorkspace) monorepoType = "pnpm-workspaces";
  else if (hasLerna) monorepoType = "lerna";
  else if (pkg?.workspaces) monorepoType = "npm/yarn-workspaces";

  // Package manager detection
  let packageManager = "npm";
  if ((await fileExists("pnpm-lock.yaml")) || hasPnpmWorkspace) {
    packageManager = "pnpm";
  } else if (await fileExists("yarn.lock")) {
    packageManager = "yarn";
  }

  // TypeScript & Tailwind detection
  const hasTs =
    Array.from(filePaths).some((p) =>
      p.endsWith("tsconfig.json") || p.endsWith(".ts") || p.endsWith(".tsx")
    ) || Boolean(pkgDeps["typescript"]);
  if (hasTs) {
    detectedTech.add("typescript");
  }

  const hasTailwind =
    Array.from(filePaths).some((p) =>
      p.includes("tailwind.config") || p.includes("postcss.config")
    ) || Boolean(pkgDeps["tailwindcss"]);
  if (hasTailwind) {
    detectedTech.add("tailwindcss");
  }

  if (pkg) {
    detectedTech.add("node");
    requiredCapabilities.add("node");
  }

  // 1. Mobile Detection (Flutter, React Native, Expo, Native Android, Native iOS)
  const isFlutter = Boolean(
    pubspecContent &&
    (pubspecContent.includes("flutter:") ||
      pubspecContent.includes("sdk: flutter")),
  );
  if (isFlutter) {
    detectedTech.add("flutter");
    detectedTech.add("dart");
    requiredCapabilities.add("flutter");
    primaryType = "flutter";
    category = "mobile";
  }

  const isReactNative = Boolean(pkgDeps["react-native"]);
  const isExpo = Boolean(pkgDeps["expo"]);
  if (isExpo) {
    detectedTech.add("expo");
    detectedTech.add("react-native");
    requiredCapabilities.add("node");
    primaryType = "expo";
    category = "mobile";
  } else if (isReactNative) {
    detectedTech.add("react-native");
    requiredCapabilities.add("node");
    primaryType = "react-native";
    category = "mobile";
  }

  const hasAndroidDir =
    Array.from(filePaths).some((p) => p.startsWith("android/")) ||
    (await fileExists("android/build.gradle"));
  const hasIosDir =
    Array.from(filePaths).some((p) => p.startsWith("ios/")) ||
    (await fileExists("ios/Podfile"));

  const isNativeAndroid = Boolean(
    (gradleRoot && gradleRoot.includes("com.android")) ||
    appGradle ||
    (await fileExists("app/src/main/AndroidManifest.xml")) ||
    hasAndroidDir,
  );
  if (isNativeAndroid && !isFlutter && !isReactNative && !isExpo) {
    detectedTech.add("android");
    detectedTech.add("java");
    requiredCapabilities.add("android");
    requiredCapabilities.add("java");
    primaryType = "android";
    category = "mobile";
  }

  const isNativeIos = Boolean(
    podfileContent ||
    Array.from(filePaths).some(
      (p) => p.endsWith(".xcodeproj") || p.endsWith(".xcworkspace"),
    ) ||
    hasIosDir,
  );
  if (isNativeIos && !isFlutter && !isReactNative && !isExpo) {
    detectedTech.add("ios");
    detectedTech.add("xcode");
    requiredCapabilities.add("ios");
    requiredCapabilities.add("xcode");
    requiredCapabilities.add("macos");
    primaryType = "ios";
    category = "mobile";
  }

  // 2. Web Application Frameworks
  if (category === "general") {
    if (pkgDeps["next"]) {
      detectedTech.add("nextjs");
      detectedTech.add("react");
      primaryType = "nextjs";
      category = "web";
    } else if (pkgDeps["react"]) {
      detectedTech.add("react");
      primaryType = "react";
      category = "web";
    } else if (pkgDeps["vue"]) {
      detectedTech.add("vue");
      primaryType = "vue";
      category = "web";
    } else if (pkgDeps["@angular/core"]) {
      detectedTech.add("angular");
      primaryType = "angular";
      category = "web";
    } else if (pkgDeps["vite"]) {
      detectedTech.add("vite");
      primaryType = "vite";
      category = "web";
    }
  }

  // 3. Backend Technologies
  if (goModContent || (await fileExists("main.go"))) {
    detectedTech.add("go");
    requiredCapabilities.add("go");
    if (category === "general") {
      primaryType = "go";
      category = "backend";
    }
  }

  if (reqsTxtContent || pyprojectContent || (await fileExists("setup.py"))) {
    detectedTech.add("python");
    requiredCapabilities.add("python");
    if (category === "general") {
      primaryType = "python";
      category = "backend";
    }
  }

  if (pomXmlContent || (gradleRoot && !isNativeAndroid)) {
    detectedTech.add("java");
    requiredCapabilities.add("java");
    if (category === "general") {
      primaryType = "java";
      category = "backend";
    }
  }

  if (await fileExists("Cargo.toml")) {
    detectedTech.add("rust");
    requiredCapabilities.add("rust");
    if (category === "general") {
      primaryType = "rust";
      category = "backend";
    }
  }

  // 4. Containers
  const hasDockerfile = Boolean(
    dockerfileContent || (await fileExists("Dockerfile")),
  );
  const hasDockerCompose =
    (await fileExists("docker-compose.yml")) ||
    (await fileExists("compose.yaml")) ||
    (await fileExists("docker-compose.yaml"));

  if (hasDockerfile) {
    detectedTech.add("docker");
    requiredCapabilities.add("docker");
    if (category === "general") {
      primaryType = "docker";
      category = "containers";
    }
  }
  if (hasDockerCompose) {
    detectedTech.add("docker-compose");
    requiredCapabilities.add("docker");
  }

  // Pure Node backend if not web or mobile
  if (pkg && category === "general") {
    detectedTech.add("nodejs");
    requiredCapabilities.add("node");
    category = "backend";
    primaryType = "nodejs";
  }

  // 5. Custom infraxis.yml
  const customConfigRaw = infraxisYaml || dotInfraxisYaml;
  const hasInfraxisConfig = Boolean(customConfigRaw);

  // Sub-apps discovery across workspaces and multi-project directories
  const candidatePrefixes = [
    "apps",
    "packages",
    "modules",
    "services",
    "projects",
    "client",
    "server",
    "frontend",
    "backend",
    "web",
    "api",
    "ui",
    "mobile",
  ];
  const foundDirs = new Set();

  for (const p of filePaths) {
    const parts = p.split("/");
    if (parts.length >= 2) {
      const top = parts[0];
      if (candidatePrefixes.includes(top)) {
        if (parts.length === 2 && parts[1] === "package.json") {
          foundDirs.add(top);
        } else if (
          parts.length >= 3 &&
          ["apps", "packages", "modules", "services", "projects"].includes(top) &&
          parts[2] === "package.json"
        ) {
          foundDirs.add(`${top}/${parts[1]}`);
        }
      }
    }
  }

  const subApps = [];
  for (const subDir of Array.from(foundDirs).slice(0, 12)) {
    const subPkgContent = await readFile(`${subDir}/package.json`);
    if (subPkgContent) {
      const subPkg = safeJson(subPkgContent);
      const subName = subPkg?.name || subDir;
      const subDeps = {
        ...(subPkg?.dependencies || {}),
        ...(subPkg?.devDependencies || {}),
        ...(subPkg?.peerDependencies || {}),
      };
      const subScripts = subPkg?.scripts || {};

      let subType = "node";
      let subCat = "general";
      const subTech = ["node"];
      const subCaps = ["node"];

      if (subDeps["next"]) {
        subType = "nextjs";
        subCat = "web";
        subTech.push("nextjs", "react");
      } else if (subDeps["react-native"]) {
        subType = "react-native";
        subCat = "mobile";
        subTech.push("react-native");
      } else if (subDeps["expo"]) {
        subType = "expo";
        subCat = "mobile";
        subTech.push("expo", "react-native");
      } else if (subDeps["react"]) {
        subType = "react";
        subCat = "web";
        subTech.push("react");
      } else if (subDeps["vue"]) {
        subType = "vue";
        subCat = "web";
        subTech.push("vue");
      } else if (subDeps["@angular/core"]) {
        subType = "angular";
        subCat = "web";
        subTech.push("angular");
      } else if (subDeps["vite"]) {
        subType = "vite";
        subCat = "web";
        subTech.push("vite");
      }

      if (
        subDeps["typescript"] ||
        Array.from(filePaths).some((p) => p.startsWith(`${subDir}/`) && (p.endsWith(".ts") || p.endsWith(".tsx")))
      ) {
        subTech.push("typescript");
      }

      const subCommands = {
        install: `${packageManager} install`,
        build: subScripts.build ? `${packageManager} run build` : null,
        test: subScripts.test ? `${packageManager} test` : null,
        lint: subScripts.lint ? `${packageManager} run lint` : null,
      };

      subApps.push({
        name: subName,
        path: subDir,
        primaryType: subType,
        category: subCat,
        technologies: Array.from(new Set(subTech)),
        requiredCapabilities: Array.from(new Set(subCaps)),
        commands: subCommands,
        hasPackageJson: true,
        pkgScripts: subScripts,
        pkgName: subPkg?.name || subDir,
        hasInfraxisConfig: false,
        hasDockerfile: false,
      });

      // Merge technologies & capabilities into root detection
      for (const t of subTech) detectedTech.add(t);
      for (const c of subCaps) requiredCapabilities.add(c);
    }
  }

  const isMonorepo = Boolean(monorepoType) || subApps.length > 0;

  // Build commands extracted from package.json or manifests
  const commands = {};
  if (pkgScripts.test) commands.test = `${packageManager} test`;
  if (pkgScripts.build) commands.build = `${packageManager} run build`;
  if (pkgScripts.lint) commands.lint = `${packageManager} run lint`;
  if (isFlutter) {
    commands.test = `flutter test`;
    commands.build = `flutter build apk`;
  }
  if (isNativeAndroid) {
    commands.test = `./gradlew test`;
    commands.build = `./gradlew assembleDebug`;
  }

  // If root is generic backend/node but there is a clear primary web or mobile subapp,
  // ensure recommended target accurately reflects the project ecosystem
  let effectivePrimaryType = primaryType;
  let effectiveCategory = category;
  if ((primaryType === "general" || primaryType === "nodejs") && subApps.length > 0) {
    const prominentApp = subApps.find((a) => a.category === "web" || a.category === "mobile") || subApps[0];
    if (prominentApp) {
      effectivePrimaryType = prominentApp.primaryType;
      effectiveCategory = prominentApp.category;
    }
  }

  // Compute recommended profile and pipeline target
  const detectionResult = {
    primaryType: effectivePrimaryType,
    category: effectiveCategory,
    technologies: Array.from(detectedTech),
    requiredCapabilities: Array.from(requiredCapabilities),
    isMonorepo,
    monorepoType,
    packageManager,
    subApps,
    commands,
    hasInfraxisConfig,
    hasDockerfile,
  };

  const customConfig = customConfigRaw ? loadRepoConfig(customConfigRaw) || { hasConfig: true } : null;
  const rec = getRecommendedProfileAndTarget(detectionResult, customConfig);

  return {
    repo: `${owner}/${repo}`,
    name: pkg?.name || repo,
    ref,
    ...detectionResult,
    recommendedProfile: hasInfraxisConfig ? "custom-pipeline" : rec.recommendedProfile,
    pipelineTarget: rec.pipelineTarget,
    availableProfiles: rec.availableProfiles,
  };
}

module.exports = {
  detectRemoteRepository,
};
