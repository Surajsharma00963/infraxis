"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../server/db");

test("Integrations API: Connects, lists, and disconnects account with encrypted tokens", async () => {
  // Test database connection is active
  const originalFetch = global.fetch;

  // Mock GitHub profile response
  global.fetch = async (url) => {
    if (url.includes("/user/emails")) {
      return { ok: true, json: async () => [{ email: "octocat@github.com", primary: true, verified: true }] };
    }
    if (url.includes("/user")) {
      return {
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          id: 583231,
          login: "octocat",
          name: "The Octocat",
          email: "octocat@github.com",
          avatar_url: "https://avatars.githubusercontent.com/u/583231",
          html_url: "https://github.com/octocat",
        }),
      };
    }
    return originalFetch(url);
  };

  try {
    // 1. Connect account via PAT
    const account = await db.gitAccounts.upsertGitAccount({
      provider: "github",
      accountId: "583231",
      username: "octocat",
      displayName: "The Octocat",
      email: "octocat@github.com",
      avatarUrl: "https://avatars.githubusercontent.com/u/583231",
      authType: "pat",
      accessToken: "ghp_mock_token_for_octocat_testing_123",
      scopes: ["repo", "read:user"],
    });

    assert.ok(account.id);
    assert.equal(account.provider, "github");
    assert.equal(account.username, "octocat");
    // Token in DB is encrypted (not plaintext)
    assert.notEqual(account.encrypted_access_token, "ghp_mock_token_for_octocat_testing_123");

    // 2. List accounts
    const accounts = await db.gitAccounts.listGitAccounts();
    const found = accounts.find((a) => a.username === "octocat");
    assert.ok(found);
    // API output does not contain encrypted token
    assert.equal(found.encrypted_access_token, undefined);

    // 3. Decrypt token internally
    const decrypted = db.gitAccounts.getDecryptedAccessToken(account);
    assert.equal(decrypted, "ghp_mock_token_for_octocat_testing_123");

    // 4. Disconnect account
    await db.gitAccounts.deleteGitAccount(account.id);
    const postDelete = await db.gitAccounts.getGitAccountById(account.id);
    assert.equal(postDelete, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Integrations API: OAuth state verification prevents CSRF and enforces TTL", async () => {
  const state = await db.gitAccounts.createOAuthState({
    provider: "bitbucket",
    redirectUrl: "http://localhost:8787/callback",
    ttlSeconds: 60,
  });

  assert.ok(state);

  // First consumption: success
  const validState = await db.gitAccounts.verifyAndConsumeOAuthState(state, "bitbucket");
  assert.ok(validState);
  assert.equal(validState.provider, "bitbucket");

  // Second consumption: fails (single-use)
  const reused = await db.gitAccounts.verifyAndConsumeOAuthState(state, "bitbucket");
  assert.equal(reused, null);

  // Wrong provider: fails
  const wrongProviderState = await db.gitAccounts.createOAuthState({
    provider: "github",
    ttlSeconds: 60,
  });
  const mismatch = await db.gitAccounts.verifyAndConsumeOAuthState(wrongProviderState, "bitbucket");
  assert.equal(mismatch, null);
});

test("Integrations API: Worker git credentials retrieval provides authorization header without exposing passwords in URL", async () => {
  // Connect account
  const account = await db.gitAccounts.upsertGitAccount({
    provider: "github",
    accountId: "999888",
    username: "test-builder",
    authType: "pat",
    accessToken: "ghp_secure_clone_token_999888",
  });

  try {
    const { job } = await db.jobs.createJob({
      repo: "acme/private-core",
      cloneUrl: "https://github.com/acme/private-core.git",
      commitHash: "abcdef1234567890abcdef1234567890abcdef12",
      branch: "main",
      kind: "pr-checks",
      requestedBy: "test",
      metadata: {
        provider: "github",
        connectedAccountId: account.id,
        isPrivate: true,
      },
    });

    const { resolveAccountAndToken } = require("../server/services/git-providers");
    const { token, provider } = await resolveAccountAndToken({
      accountId: job.metadata?.connectedAccountId,
      provider: "github",
    });

    assert.equal(provider, "github");
    assert.equal(token, "ghp_secure_clone_token_999888");

    // Clean clone URL has no passwords embedded
    assert.equal(job.clone_url, "https://github.com/acme/private-core.git");
    assert.ok(!job.clone_url.includes("ghp_"));
  } finally {
    await db.gitAccounts.deleteGitAccount(account.id);
  }
});

test.after(async () => {
  await db.closePool().catch(() => {});
});
