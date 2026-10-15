"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GitHubAdapter } = require("../server/services/git-providers/github-adapter");
const { BitbucketAdapter } = require("../server/services/git-providers/bitbucket-adapter");
const { getAdapter, resolveAccountAndToken } = require("../server/services/git-providers");

test("Git Providers: Registry resolves known adapters and rejects unknown", () => {
  const gh = getAdapter("github");
  assert.ok(gh instanceof GitHubAdapter);
  assert.equal(gh.provider, "github");

  const bb = getAdapter("bitbucket");
  assert.ok(bb instanceof BitbucketAdapter);
  assert.equal(bb.provider, "bitbucket");

  assert.throws(() => {
    getAdapter("gitlab");
  }, /Unsupported git provider/);
});

test("GitHub Adapter: Generates OAuth URL with scopes and state", () => {
  const prevId = process.env.GITHUB_CLIENT_ID;
  process.env.GITHUB_CLIENT_ID = "gh-test-client-id";

  try {
    const adapter = new GitHubAdapter();
    const url = adapter.getAuthUrl({
      state: "test-state-123",
      redirectUri: "http://localhost:8787/callback",
      scopes: ["repo", "read:user"],
    });

    assert.ok(url.startsWith("https://github.com/login/oauth/authorize?"));
    assert.ok(url.includes("client_id=gh-test-client-id"));
    assert.ok(url.includes("state=test-state-123"));
    assert.ok(url.includes("scope=repo%2Cread%3Auser"));
  } finally {
    process.env.GITHUB_CLIENT_ID = prevId;
  }
});

test("Bitbucket Adapter: Generates OAuth URL with scopes and state", () => {
  const prevId = process.env.BITBUCKET_CLIENT_ID;
  process.env.BITBUCKET_CLIENT_ID = "bb-test-client-id";

  try {
    const adapter = new BitbucketAdapter();
    const url = adapter.getAuthUrl({
      state: "bb-state-456",
      redirectUri: "http://localhost:8787/bb-callback",
      scopes: ["account", "repository"],
    });

    assert.ok(url.startsWith("https://bitbucket.org/site/oauth2/authorize?"));
    assert.ok(url.includes("client_id=bb-test-client-id"));
    assert.ok(url.includes("state=bb-state-456"));
    assert.ok(url.includes("response_type=code"));
  } finally {
    process.env.BITBUCKET_CLIENT_ID = prevId;
  }
});

test("GitHub Adapter: Parses repositories with pagination and normalized attributes", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.ok(url.includes("api.github.com"));
    return {
      ok: true,
      headers: new Headers({
        "content-type": "application/json",
        link: '<https://api.github.com/user/repos?page=2>; rel="next"',
      }),
      json: async () => [
        {
          id: 12345,
          name: "infraxis-mobile",
          full_name: "acme/infraxis-mobile",
          private: true,
          owner: { login: "acme" },
          description: "Infraxis React Native App",
          default_branch: "develop",
          clone_url: "https://github.com/acme/infraxis-mobile.git",
          html_url: "https://github.com/acme/infraxis-mobile",
          updated_at: "2026-10-14T10:00:00Z",
          topics: ["react-native", "mobile"],
          stargazers_count: 42,
          forks_count: 5,
        },
      ],
    };
  };

  try {
    const adapter = new GitHubAdapter();
    const res = await adapter.listRepositories({ token: "test-token", page: 1 });

    assert.equal(res.page, 1);
    assert.equal(res.hasNext, true);
    assert.equal(res.repositories.length, 1);
    const repo = res.repositories[0];
    assert.equal(repo.fullName, "acme/infraxis-mobile");
    assert.equal(repo.isPrivate, true);
    assert.equal(repo.defaultBranch, "develop");
    assert.deepEqual(repo.topics, ["react-native", "mobile"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Bitbucket Adapter: Parses repositories with pagination and normalized attributes", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.ok(url.includes("api.bitbucket.org"));
    return {
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        size: 25,
        next: "https://api.bitbucket.org/2.0/repositories?page=2",
        values: [
          {
            uuid: "{bb-repo-uuid-1}",
            name: "payment-service",
            full_name: "acme-corp/payment-service",
            is_private: true,
            workspace: { slug: "acme-corp" },
            description: "Go payment microservice",
            mainbranch: { name: "main" },
            links: {
              html: { href: "https://bitbucket.org/acme-corp/payment-service" },
              clone: [
                { name: "https", href: "https://user@bitbucket.org/acme-corp/payment-service.git" },
              ],
            },
            updated_on: "2026-10-14T11:00:00Z",
          },
        ],
      }),
    };
  };

  try {
    const adapter = new BitbucketAdapter();
    const res = await adapter.listRepositories({ token: "bb-test-token", page: 1 });

    assert.equal(res.page, 1);
    assert.equal(res.hasNext, true);
    assert.equal(res.totalCount, 25);
    const repo = res.repositories[0];
    assert.equal(repo.fullName, "acme-corp/payment-service");
    assert.equal(repo.isPrivate, true);
    assert.equal(repo.cloneUrl, "https://bitbucket.org/acme-corp/payment-service.git");
  } finally {
    global.fetch = originalFetch;
  }
});

test("GitHub Adapter: Rate limit handling throws typed GitProviderError", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 403,
    headers: new Headers({
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": "1760450000",
      "content-type": "application/json",
    }),
    json: async () => ({ message: "API rate limit exceeded" }),
  });

  try {
    const adapter = new GitHubAdapter();
    await assert.rejects(
      async () => {
        await adapter.listRepositories({ token: "expired-token" });
      },
      (err) => {
        return err.code === "RATE_LIMITED" && err.statusCode === 429;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});
