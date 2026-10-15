"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { detectProjectType, parseProjectIntelligence } = require("../server/services/detector");

function createTempDir(prefix = "infraxis-detect-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

test("Detector: Detect Next.js web application", async () => {
  const dir = createTempDir();
  try {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "my-next-app",
        dependencies: { next: "^14.0.0", react: "^18.0.0", "react-dom": "^18.0.0" },
        scripts: { build: "next build", test: "jest", lint: "next lint" },
      })
    );
    fs.writeFileSync(path.join(dir, "next.config.js"), "module.exports = {};");

    const result = await detectProjectType(dir);
    assert.strictEqual(result.category, "web");
    assert.strictEqual(result.primaryType, "nextjs");
    assert.ok(result.technologies.includes("nextjs"));
    assert.ok(result.technologies.includes("react"));
    assert.ok(result.technologies.includes("node"));
    assert.ok(result.commands.build.includes("build"));
    assert.ok(result.commands.test.includes("test"));
    assert.ok(result.commands.lint.includes("lint"));
  } finally {
    cleanupTempDir(dir);
  }
});

test("Detector: Detect Mobile applications (Flutter and React Native)", async () => {
  // Flutter project
  const flutterDir = createTempDir("flutter-");
  try {
    fs.writeFileSync(
      path.join(flutterDir, "pubspec.yaml"),
      "name: flutter_sample\ndescription: A sample Flutter project.\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\ndependencies:\n  flutter:\n    sdk: flutter\n"
    );
    const flutterResult = await detectProjectType(flutterDir);
    assert.strictEqual(flutterResult.category, "mobile");
    assert.strictEqual(flutterResult.primaryType, "flutter");
    assert.ok(flutterResult.technologies.includes("flutter"));
    assert.ok(flutterResult.requiredCapabilities.includes("flutter"));
    assert.ok(flutterResult.commands.build.includes("flutter build"));
  } finally {
    cleanupTempDir(flutterDir);
  }

  // React Native project
  const rnDir = createTempDir("rn-");
  try {
    fs.writeFileSync(
      path.join(rnDir, "package.json"),
      JSON.stringify({
        name: "rn-app",
        dependencies: { "react-native": "^0.73.0", react: "^18.2.0" },
      })
    );
    fs.writeFileSync(path.join(rnDir, "app.json"), JSON.stringify({ name: "rn-app", displayName: "RN App" }));
    fs.writeFileSync(path.join(rnDir, "Podfile"), "platform :ios, '13.0'\n");

    const rnResult = await detectProjectType(rnDir);
    assert.strictEqual(rnResult.category, "mobile");
    assert.strictEqual(rnResult.primaryType, "react-native");
    assert.ok(rnResult.technologies.includes("react-native"));
    assert.ok(rnResult.technologies.includes("ios"));
  } finally {
    cleanupTempDir(rnDir);
  }
});

test("Detector: Detect Backend services (Go, Python, Java, Rust)", async () => {
  // Go
  const goDir = createTempDir("go-");
  try {
    fs.writeFileSync(path.join(goDir, "go.mod"), "module example.com/myservice\n\ngo 1.21\n");
    const goResult = await detectProjectType(goDir);
    assert.strictEqual(goResult.category, "backend");
    assert.strictEqual(goResult.primaryType, "go");
    assert.ok(goResult.technologies.includes("go"));
    assert.ok(goResult.requiredCapabilities.includes("go"));
    assert.ok(goResult.commands.build.includes("go build"));
    assert.ok(goResult.commands.test.includes("go test"));
  } finally {
    cleanupTempDir(goDir);
  }

  // Python
  const pyDir = createTempDir("py-");
  try {
    fs.writeFileSync(path.join(pyDir, "requirements.txt"), "fastapi>=0.100.0\nuvicorn>=0.23.0\npytest>=7.0.0\n");
    const pyResult = await detectProjectType(pyDir);
    assert.strictEqual(pyResult.category, "backend");
    assert.strictEqual(pyResult.primaryType, "python");
    assert.ok(pyResult.technologies.includes("python"));
    assert.ok(pyResult.requiredCapabilities.includes("python"));
    assert.ok(pyResult.commands.test.includes("pytest"));
  } finally {
    cleanupTempDir(pyDir);
  }

  // Java Maven
  const javaDir = createTempDir("java-");
  try {
    fs.writeFileSync(
      path.join(javaDir, "pom.xml"),
      "<project><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>api</artifactId><version>1.0.0</version></project>"
    );
    const javaResult = await detectProjectType(javaDir);
    assert.strictEqual(javaResult.category, "backend");
    assert.strictEqual(javaResult.primaryType, "java");
    assert.ok(javaResult.technologies.includes("java"));
    assert.ok(javaResult.requiredCapabilities.includes("java"));
    assert.ok(javaResult.commands.build.includes("mvn package"));
  } finally {
    cleanupTempDir(javaDir);
  }

  // Rust
  const rustDir = createTempDir("rust-");
  try {
    fs.writeFileSync(
      path.join(rustDir, "Cargo.toml"),
      "[package]\nname = \"my_rust_service\"\nversion = \"0.1.0\"\nedition = \"2021\"\n"
    );
    const rustResult = await detectProjectType(rustDir);
    assert.strictEqual(rustResult.category, "backend");
    assert.strictEqual(rustResult.primaryType, "rust");
    assert.ok(rustResult.technologies.includes("rust"));
    assert.ok(rustResult.requiredCapabilities.includes("rust"));
    assert.ok(rustResult.commands.build.includes("cargo build"));
  } finally {
    cleanupTempDir(rustDir);
  }
});

test("Detector: Detect Desktop applications (Electron, Tauri)", async () => {
  // Electron
  const electronDir = createTempDir("electron-");
  try {
    fs.writeFileSync(
      path.join(electronDir, "package.json"),
      JSON.stringify({
        name: "desktop-electron",
        devDependencies: { electron: "^28.0.0" },
        scripts: { build: "electron-builder" },
      })
    );
    const electronResult = await detectProjectType(electronDir);
    assert.strictEqual(electronResult.category, "desktop");
    assert.strictEqual(electronResult.primaryType, "electron");
    assert.ok(electronResult.technologies.includes("electron"));
  } finally {
    cleanupTempDir(electronDir);
  }

  // Tauri
  const tauriDir = createTempDir("tauri-");
  try {
    fs.mkdirSync(path.join(tauriDir, "src-tauri"), { recursive: true });
    fs.writeFileSync(
      path.join(tauriDir, "src-tauri", "Cargo.toml"),
      "[package]\nname = \"tauri-app\"\n[dependencies]\ntauri = { version = \"1.5\" }\n"
    );
    const tauriResult = await detectProjectType(tauriDir);
    assert.strictEqual(tauriResult.category, "desktop");
    assert.strictEqual(tauriResult.primaryType, "tauri");
    assert.ok(tauriResult.technologies.includes("tauri"));
    assert.ok(tauriResult.requiredCapabilities.includes("rust"));
  } finally {
    cleanupTempDir(tauriDir);
  }
});

test("Detector: Detect Containers (Dockerfile, Docker Compose)", async () => {
  const dockerDir = createTempDir("docker-");
  try {
    fs.writeFileSync(
      path.join(dockerDir, "Dockerfile"),
      "FROM alpine:3.18\nRUN echo 'Building container'\nCMD [\"echo\", \"done\"]\n"
    );
    const dockerResult = await detectProjectType(dockerDir);
    assert.strictEqual(dockerResult.category, "containers");
    assert.strictEqual(dockerResult.primaryType, "docker");
    assert.ok(dockerResult.technologies.includes("docker"));
    assert.ok(dockerResult.requiredCapabilities.includes("docker"));
    assert.ok(dockerResult.commands.build.includes("docker build"));
  } finally {
    cleanupTempDir(dockerDir);
  }
});

test("Detector: Detect Monorepos and discover sub-applications", async () => {
  const monoDir = createTempDir("monorepo-");
  try {
    fs.writeFileSync(
      path.join(monoDir, "package.json"),
      JSON.stringify({
        name: "my-monorepo",
        workspaces: ["apps/*", "packages/*"],
      })
    );
    fs.writeFileSync(path.join(monoDir, "turbo.json"), JSON.stringify({ pipeline: {} }));

    // Create web sub-app
    fs.mkdirSync(path.join(monoDir, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(monoDir, "apps", "web", "package.json"),
      JSON.stringify({
        name: "@mono/web",
        dependencies: { next: "^14.0.0", react: "^18.0.0" },
      })
    );

    // Create backend sub-app
    fs.mkdirSync(path.join(monoDir, "apps", "api"), { recursive: true });
    fs.writeFileSync(
      path.join(monoDir, "apps", "api", "package.json"),
      JSON.stringify({
        name: "@mono/api",
        dependencies: { express: "^4.18.0" },
      })
    );

    const monoResult = await detectProjectType(monoDir);
    assert.strictEqual(monoResult.isMonorepo, true);
    assert.strictEqual(monoResult.monorepoType, "turbo");
    assert.strictEqual(monoResult.subApps.length, 2);

    const subAppNames = monoResult.subApps.map((a) => a.name);
    assert.ok(subAppNames.includes("@mono/web"));
    assert.ok(subAppNames.includes("@mono/api"));

    const webSubApp = monoResult.subApps.find((a) => a.name === "@mono/web");
    assert.strictEqual(webSubApp.primaryType, "nextjs");
    assert.strictEqual(webSubApp.category, "web");
  } finally {
    cleanupTempDir(monoDir);
  }
});
