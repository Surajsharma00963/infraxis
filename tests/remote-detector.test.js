"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { detectRemoteRepository } = require("../server/services/remote-detector");

test("Remote Detector: Detects Next.js web application and commands from manifests", async () => {
  const mockAdapter = {
    async getTree() {
      return [
        { path: "package.json", type: "file" },
        { path: "pages/index.tsx", type: "file" },
        { path: "next.config.js", type: "file" },
      ];
    },
    async getFileContent({ path }) {
      if (path === "package.json") {
        return JSON.stringify({
          name: "infraxis-web",
          dependencies: { next: "14.2.0", react: "18.3.0" },
          scripts: { test: "jest", build: "next build", lint: "next lint" },
        });
      }
      return null;
    },
  };

  const res = await detectRemoteRepository({
    adapter: mockAdapter,
    token: "test",
    owner: "org",
    repo: "infraxis-web",
  });

  assert.equal(res.primaryType, "nextjs");
  assert.equal(res.category, "web");
  assert.ok(res.technologies.includes("nextjs"));
  assert.ok(res.technologies.includes("react"));
  assert.ok(res.technologies.includes("node"));
  assert.equal(res.commands.test, "npm test");
  assert.equal(res.commands.build, "npm run build");
  assert.equal(res.recommendedProfile, "pr-checks");
});

test("Remote Detector: Detects Flutter Mobile application and sets recommended profile", async () => {
  const mockAdapter = {
    async getTree() {
      return [
        { path: "pubspec.yaml", type: "file" },
        { path: "lib/main.dart", type: "file" },
      ];
    },
    async getFileContent({ path }) {
      if (path === "pubspec.yaml") {
        return "name: my_flutter_app\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\ndependencies:\n  flutter:\n    sdk: flutter";
      }
      return null;
    },
  };

  const res = await detectRemoteRepository({
    adapter: mockAdapter,
    token: "test",
    owner: "org",
    repo: "flutter-app",
  });

  assert.equal(res.primaryType, "flutter");
  assert.equal(res.category, "mobile");
  assert.ok(res.technologies.includes("flutter"));
  assert.ok(res.technologies.includes("dart"));
  assert.equal(res.commands.test, "flutter test");
});

test("Remote Detector: Detects Custom infraxis.yml Pipeline override", async () => {
  const mockAdapter = {
    async getTree() {
      return [
        { path: "package.json", type: "file" },
        { path: "infraxis.yml", type: "file" },
      ];
    },
    async getFileContent({ path }) {
      if (path === "infraxis.yml") {
        return "version: '1.0'\npipeline:\n  stages:\n    - name: test\n      run: npm test";
      }
      if (path === "package.json") {
        return JSON.stringify({ name: "app" });
      }
      return null;
    },
  };

  const res = await detectRemoteRepository({
    adapter: mockAdapter,
    token: "test",
    owner: "org",
    repo: "custom-pipeline-repo",
  });

  assert.equal(res.hasInfraxisConfig, true);
  assert.equal(res.recommendedProfile, "custom-pipeline");
  assert.ok(res.pipelineTarget.name.includes("infraxis.yml"));
});
