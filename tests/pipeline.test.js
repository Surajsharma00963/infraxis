"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  planPipeline,
  detectBuildKind,
  getRecommendedProfileAndTarget,
} = require("../server/services/pipeline");
const { parseInfraxisConfig } = require("../server/services/config-parser");

function createTempDir(prefix = "infraxis-pipe-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

test("Pipeline Planner: Fast PR Checks profile", async () => {
  const dir = createTempDir();
  try {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "test-web",
        scripts: {
          test: "npm run test:unit",
          lint: "eslint .",
          build: "vite build",
        },
      })
    );

    const plan = await planPipeline({
      projectDir: dir,
      kind: "pr-checks",
      isPrCheck: true,
      prNumber: 42,
    });

    assert.strictEqual(plan.kind, "pr-checks");
    assert.strictEqual(plan.profile, "pr-checks");
    assert.ok(plan.stages.length >= 3);

    const categories = plan.stages.map((s) => s.category);
    assert.ok(categories.includes("dependencies"));
    assert.ok(categories.includes("lint"));
    assert.ok(categories.includes("test"));

    // PR checks should have validation and tests
    const testStage = plan.stages.find((s) => s.category === "test");
    assert.ok(testStage.command.includes("test"));
  } finally {
    cleanupTempDir(dir);
  }
});

test("Pipeline Planner: Release Build with artifacts", async () => {
  const dir = createTempDir();
  try {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "test-release-app",
        scripts: {
          build: "npm run build:prod",
          test: "jest",
        },
      })
    );

    const plan = await planPipeline({
      projectDir: dir,
      kind: "release-build",
      env: { NODE_ENV: "production" },
    });

    assert.strictEqual(plan.kind, "release-build");
    assert.strictEqual(plan.profile, "release-build");

    const categories = plan.stages.map((s) => s.category);
    assert.ok(categories.includes("build"));
    assert.ok(plan.stages.length >= 2);
  } finally {
    cleanupTempDir(dir);
  }
});

test("Pipeline Planner: Mobile iOS builds enforce macOS and Xcode requirement", async () => {
  const dir = createTempDir();
  try {
    fs.writeFileSync(path.join(dir, "Podfile"), "platform :ios, '14.0'\n");

    const plan = await planPipeline({
      projectDir: dir,
      kind: "ios-release",
    });

    assert.strictEqual(plan.kind, "ios-release");
    assert.strictEqual(plan.requiredPlatform, "darwin");
    assert.ok(plan.requiredCapabilities.includes("darwin"));
    assert.ok(plan.requiredCapabilities.includes("xcode"));
  } finally {
    cleanupTempDir(dir);
  }
});

test("Pipeline Planner: Mobile Android builds enforce Android SDK capability", async () => {
  const dir = createTempDir();
  try {
    fs.writeFileSync(
      path.join(dir, "build.gradle"),
      "apply plugin: 'com.android.application'\nandroid {\n  compileSdkVersion 34\n}\n"
    );

    const plan = await planPipeline({
      projectDir: dir,
      kind: "android-debug",
    });

    assert.strictEqual(plan.kind, "android-debug");
    assert.ok(plan.requiredCapabilities.includes("android-sdk") || plan.requiredCapabilities.includes("android"));
  } finally {
    cleanupTempDir(dir);
  }
});

test("Pipeline Planner: infraxis.yml custom configuration override", async () => {
  const dir = createTempDir();
  try {
    const infraxisYaml = `
version: 1
pipelines:
  custom-pipeline:
    stages:
      - name: custom-security-audit
        category: security
        command: npm audit --audit-level=high
      - name: compile-microservice
        category: build
        command: npm run build
`;
    fs.writeFileSync(path.join(dir, "infraxis.yml"), infraxisYaml);
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "custom-pipeline-app", scripts: { build: "tsc" } })
    );

    const config = parseInfraxisConfig(infraxisYaml);
    assert.strictEqual(config.version, 1);
    assert.ok(config.pipelines["custom-pipeline"]);
    assert.strictEqual(config.pipelines["custom-pipeline"].stages.length, 2);

    const plan = await planPipeline({
      projectDir: dir,
      kind: "custom-pipeline",
    });

    const stageNames = plan.stages.map((s) => s.name);
    assert.ok(stageNames.includes("custom-security-audit"));
    assert.ok(stageNames.includes("compile-microservice"));
  } finally {
    cleanupTempDir(dir);
  }
});

test("Auto-Detect Build Profile & Pipeline Target: iOS Release", () => {
  const dir = createTempDir("infraxis-ios-target-");
  try {
    fs.mkdirSync(path.join(dir, "ios"));
    fs.writeFileSync(path.join(dir, "ios", "Podfile"), "platform :ios, '15.0'\n");
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "my-ios-app" })
    );

    const kind = detectBuildKind(dir);
    assert.strictEqual(kind, "ios-release");

    const { recommendedProfile, pipelineTarget, availableProfiles } =
      getRecommendedProfileAndTarget(
        { primaryType: "ios", category: "mobile", technologies: ["ios", "xcode"] },
        null
      );
    assert.strictEqual(recommendedProfile, "ios-release");
    assert.strictEqual(pipelineTarget.platform, "Apple iOS");
    assert.ok(pipelineTarget.osRequirement.includes("macOS"));
    assert.ok(availableProfiles.includes("ios-release"));
    assert.strictEqual(availableProfiles.includes("ios-simulator"), false);
  } finally {
    cleanupTempDir(dir);
  }
});

test("Auto-Detect Build Profile & Pipeline Target: Android Release", () => {
  const dir = createTempDir("infraxis-android-target-");
  try {
    fs.writeFileSync(
      path.join(dir, "build.gradle"),
      "apply plugin: 'com.android.application'\n"
    );

    const kind = detectBuildKind(dir);
    assert.strictEqual(kind, "android-release");

    const { recommendedProfile, pipelineTarget, availableProfiles } =
      getRecommendedProfileAndTarget(
        { primaryType: "android", category: "mobile", technologies: ["android", "gradle"] },
        null
      );
    assert.strictEqual(recommendedProfile, "android-release");
    assert.strictEqual(pipelineTarget.platform, "Android OS");
    assert.ok(availableProfiles.includes("android-release"));
    assert.strictEqual(availableProfiles.includes("android-debug"), false);
  } finally {
    cleanupTempDir(dir);
  }
});

test("Auto-Detect Build Profile & Pipeline Target: Container / Dockerfile", () => {
  const dir = createTempDir("infraxis-docker-target-");
  try {
    fs.writeFileSync(
      path.join(dir, "Dockerfile"),
      "FROM node:20-alpine\nWORKDIR /app\n"
    );

    const kind = detectBuildKind(dir);
    assert.strictEqual(kind, "release-build");

    const { recommendedProfile, pipelineTarget } =
      getRecommendedProfileAndTarget(
        { primaryType: "docker", category: "containers", hasDockerfile: true },
        null
      );
    assert.strictEqual(recommendedProfile, "release-build");
    assert.strictEqual(pipelineTarget.platform, "Docker / Container Engine");
    assert.ok(pipelineTarget.osRequirement.includes("Docker"));
  } finally {
    cleanupTempDir(dir);
  }
});

test("Auto-Detect Build Profile & Pipeline Target: Custom infraxis.yml Pipeline", () => {
  const dir = createTempDir("infraxis-yml-target-");
  try {
    fs.writeFileSync(
      path.join(dir, "infraxis.yml"),
      "version: 1\npipelines:\n  custom-pipeline:\n    stages:\n      - name: verify\n        command: make check\n"
    );

    const kind = detectBuildKind(dir);
    assert.strictEqual(kind, "custom-pipeline");

    const { recommendedProfile, pipelineTarget } =
      getRecommendedProfileAndTarget(
        { primaryType: "general", hasInfraxisConfig: true },
        { pipelines: { "custom-pipeline": { stages: [] } } }
      );
    assert.strictEqual(recommendedProfile, "custom-pipeline");
    assert.strictEqual(pipelineTarget.name, "Custom infraxis.yml Pipeline");
  } finally {
    cleanupTempDir(dir);
  }
});

test("Auto-Detect Build Profile & Pipeline Target: Web Application & Backend", () => {
  const webTarget = getRecommendedProfileAndTarget(
    { primaryType: "nextjs", category: "web", packageManager: "pnpm" },
    null
  );
  assert.strictEqual(webTarget.recommendedProfile, "pr-checks");
  assert.strictEqual(webTarget.pipelineTarget.platform, "Web Browser / Node.js Engine");
  assert.ok(webTarget.pipelineTarget.runtime.includes("pnpm"));

  const goTarget = getRecommendedProfileAndTarget(
    { primaryType: "go", category: "backend" },
    null
  );
  assert.strictEqual(goTarget.recommendedProfile, "pr-checks");
  assert.strictEqual(goTarget.pipelineTarget.platform, "Cloud Native / Linux / macOS");
  assert.ok(goTarget.pipelineTarget.runtime.includes("Go"));
});

