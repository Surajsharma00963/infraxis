"use strict";

const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const db = require("../db");
const {
  getAdapter,
  resolveAccountAndToken,
  GitProviderError,
} = require("../services/git-providers");
const { detectRemoteRepository } = require("../services/remote-detector");
const { reportCommitStatus } = require("../services/status-reporter");

/**
 * Helper to get clean base URL for OAuth callbacks
 */
function getBaseUrl(req) {
  const host = req.get("host") || "127.0.0.1:8787";
  const protocol =
    req.protocol ||
    (req.get("x-forwarded-proto") === "https" ? "https" : "http");
  return (
    process.env.INFRAXIS_BASE_URL ||
    process.env.CI_BASE_URL ||
    `${protocol}://${host}`
  );
}

/**
 * 1. Integration Status & Provider Configuration
 */
router.get("/status", async (_req, res) => {
  const githubAdapter = getAdapter("github");
  const bitbucketAdapter = getAdapter("bitbucket");

  const accounts = await db.gitAccounts.listGitAccounts();

  res.json({
    github: {
      oauthConfigured: githubAdapter.isOAuthConfigured(),
      clientId: githubAdapter.getClientId()
        ? `${githubAdapter.getClientId().slice(0, 6)}...`
        : null,
      webhookConfigured: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
      connectedAccountsCount: accounts.filter(
        (a) => a.provider === "github" && a.status === "active",
      ).length,
    },
    bitbucket: {
      oauthConfigured: bitbucketAdapter.isOAuthConfigured(),
      clientId: bitbucketAdapter.getClientId()
        ? `${bitbucketAdapter.getClientId().slice(0, 6)}...`
        : null,
      webhookConfigured: Boolean(process.env.BITBUCKET_WEBHOOK_TOKEN),
      connectedAccountsCount: accounts.filter(
        (a) => a.provider === "bitbucket" && a.status === "active",
      ).length,
    },
  });
});

/**
 * 2. List Connected Accounts (No secrets exposed)
 */
router.get("/accounts", async (req, res) => {
  const accounts = await db.gitAccounts.listGitAccounts({
    userId: req.user?.id || null,
  });
  res.json({ accounts });
});

/**
 * 3. Connect Account via Scoped Access Token (PAT)
 */
router.post("/accounts/connect-token", async (req, res) => {
  const { provider, token, username: providedUsername } = req.body || {};
  if (!provider || !token) {
    return res.status(400).json({ error: "Provider and token are required" });
  }

  const prov = provider.toLowerCase().trim();
  if (!["github", "bitbucket"].includes(prov)) {
    return res
      .status(400)
      .json({ error: "Invalid provider. Supported: github, bitbucket" });
  }

  try {
    const adapter = getAdapter(prov);
    const profile = await adapter.getUserProfile(token.trim());

    const account = await db.gitAccounts.upsertGitAccount({
      userId: req.user?.id || null,
      provider: prov,
      accountId: profile.accountId,
      username: profile.username || providedUsername || "user",
      displayName: profile.displayName,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      authType: "pat",
      accessToken: token.trim(),
      scopes: ["repo", "read:user"],
    });

    res.status(201).json({
      success: true,
      account: {
        id: account.id,
        provider: account.provider,
        accountId: account.account_id,
        username: account.username,
        displayName: account.display_name,
        email: account.email,
        avatarUrl: account.avatar_url,
        authType: account.auth_type,
        status: account.status,
      },
    });
  } catch (err) {
    console.error(
      `[Git Integrations] Failed to connect ${prov} account:`,
      err.message,
    );
    res.status(err.statusCode || 400).json({
      error: `Failed to authenticate with ${prov}: ${err.message}`,
      code: err.code || "AUTH_FAILED",
    });
  }
});

/**
 * 4. Refresh Connected Account Access
 */
router.post("/accounts/:id/refresh", async (req, res) => {
  const account = await db.gitAccounts.getGitAccountById(req.params.id);
  if (!account) {
    return res.status(404).json({ error: "Account not found" });
  }

  try {
    const adapter = getAdapter(account.provider);
    let newAccessToken = db.gitAccounts.getDecryptedAccessToken(account);

    if (
      account.auth_type === "oauth" &&
      account.provider === "bitbucket" &&
      account.encrypted_refresh_token
    ) {
      const refreshToken = db.gitAccounts.getDecryptedRefreshToken(account);
      const refreshed = await adapter.refreshToken({ refreshToken });
      await db.gitAccounts.updateGitAccountTokens(account.id, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        scopes: refreshed.scope,
      });
      newAccessToken = refreshed.accessToken;
    }

    // Re-verify profile
    const profile = await adapter.getUserProfile(newAccessToken);
    await db.gitAccounts.updateGitAccountStatus(account.id, "active", null);

    res.json({
      success: true,
      account: {
        id: account.id,
        provider: account.provider,
        username: profile.username || account.username,
        displayName: profile.displayName || account.display_name,
        avatarUrl: profile.avatarUrl || account.avatar_url,
        status: "active",
      },
    });
  } catch (err) {
    await db.gitAccounts.updateGitAccountStatus(
      account.id,
      "error",
      err.message,
    );
    res.status(err.statusCode || 400).json({
      error: `Failed to refresh account: ${err.message}`,
      code: err.code || "REFRESH_FAILED",
    });
  }
});

/**
 * 5. Disconnect Account
 */
router.delete("/accounts/:id", async (req, res) => {
  const account = await db.gitAccounts.getGitAccountById(req.params.id);
  if (!account) {
    return res.status(404).json({ error: "Account not found" });
  }

  await db.gitAccounts.deleteGitAccount(account.id);
  res.json({
    success: true,
    message: `Disconnected ${account.provider} account ${account.username}`,
  });
});

/**
 * 6. Start OAuth Flow
 */
router.get("/oauth/:provider/authorize", async (req, res) => {
  const prov = req.params.provider.toLowerCase().trim();
  if (!["github", "bitbucket"].includes(prov)) {
    return res.status(400).json({ error: "Invalid provider" });
  }

  try {
    const adapter = getAdapter(prov);
    if (!adapter.isOAuthConfigured()) {
      return res.status(503).json({
        error: `${prov.toUpperCase()} OAuth is not configured. Set ${prov.toUpperCase()}_CLIENT_ID and ${prov.toUpperCase()}_CLIENT_SECRET in .env.`,
      });
    }

    const state = crypto.randomBytes(32).toString("hex");
    const baseUrl = getBaseUrl(req);
    const redirectUri = `${baseUrl}/api/integrations/oauth/${prov}/callback`;

    await db.gitAccounts.createOAuthState({
      state,
      provider: prov,
      userId: req.user?.id || null,
      redirectUrl: redirectUri,
      ttlSeconds: 600,
    });

    const authUrl = adapter.getAuthUrl({ state, redirectUri });
    res.json({ url: authUrl, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 7. OAuth Callback Handler
 */
router.get("/oauth/:provider/callback", async (req, res) => {
  const prov = req.params.provider.toLowerCase().trim();
  const { code, state, error, error_description } = req.query;

  const baseUrl = getBaseUrl(req);
  const frontendUrl = `${baseUrl}/?tab=integrations`;

  if (error) {
    return res.redirect(
      `${frontendUrl}&error=${encodeURIComponent(error_description || error)}`,
    );
  }

  if (!code || !state) {
    return res.redirect(`${frontendUrl}&error=missing_code_or_state`);
  }

  try {
    const validState = await db.gitAccounts.verifyAndConsumeOAuthState(
      state,
      prov,
    );
    if (!validState) {
      return res.redirect(
        `${frontendUrl}&error=invalid_or_expired_oauth_state`,
      );
    }

    const adapter = getAdapter(prov);
    const redirectUri = `${baseUrl}/api/integrations/oauth/${prov}/callback`;
    const tokenData = await adapter.exchangeCode({ code, redirectUri });

    const profile = await adapter.getUserProfile(tokenData.accessToken);

    await db.gitAccounts.upsertGitAccount({
      userId: validState.user_id,
      provider: prov,
      accountId: profile.accountId,
      username: profile.username,
      displayName: profile.displayName,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken || null,
      expiresAt: tokenData.expiresAt || null,
      scopes: tokenData.scope || [],
    });

    res.redirect(`${frontendUrl}&success=${prov}`);
  } catch (err) {
    console.error(`[OAuth Callback Error] ${prov}:`, err);
    res.redirect(`${frontendUrl}&error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * 8. List & Discover Repositories (search, pagination, refresh)
 */
router.get("/repositories", async (req, res) => {
  const provider = req.query.provider
    ? String(req.query.provider).toLowerCase()
    : null;
  const search = req.query.q ? String(req.query.q).trim() : "";
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(
    100,
    Math.max(1, parseInt(req.query.per_page, 10) || 30),
  );
  const refresh = req.query.refresh === "true";

  // Check connected accounts
  const isAdmin = !req.user || req.user.role === "admin";
  const accounts = await db.gitAccounts.listGitAccounts({
    userId: isAdmin ? null : req.user.id,
    provider: provider || null,
  });

  const activeAccounts = accounts.filter((a) => a.status === "active");

  if (
    activeAccounts.length === 0 &&
    !process.env.GITHUB_TOKEN &&
    !process.env.BITBUCKET_TOKEN
  ) {
    // If no connected accounts, check if we have cached repositories in database
    const cached = await db.repositories.listRepositories({
      provider: provider || null,
      search: search || null,
      limit: perPage,
      offset: (page - 1) * perPage,
    });

    return res.json({
      repositories: cached.map((r) => ({
        id: r.id,
        provider: r.provider,
        owner: r.owner,
        name: r.name,
        fullName: r.full_name,
        description: r.description || "",
        isPrivate: Boolean(r.is_private),
        defaultBranch: r.default_branch || "main",
        cloneUrl: r.clone_url,
        htmlUrl: r.html_url,
        detectedTech: r.detected_tech,
        updatedAt: r.updated_at,
      })),
      page,
      perPage,
      totalCount: cached.length,
      hasNext: false,
      hasPrev: page > 1,
      noAccountsConnected: true,
    });
  }

  // Fetch live repositories from active accounts
  let allRepos = [];
  let hasNextOverall = false;

  for (const acct of activeAccounts) {
    try {
      const fullAcct = await db.gitAccounts.getGitAccountById(acct.id);
      if (!fullAcct) continue;
      const adapter = getAdapter(fullAcct.provider);
      const token = db.gitAccounts.getDecryptedAccessToken(fullAcct);
      if (!token) continue;

      const result = await adapter.listRepositories({
        token,
        page,
        perPage,
        query: search,
      });

      for (const repo of result.repositories) {
        repo.connectedAccountId = acct.id;
        allRepos.push(repo);

        // Async sync into repositories table in DB
        db.repositories
          .upsertRepository({
            provider: repo.provider,
            owner: repo.owner,
            name: repo.name,
            fullName: repo.fullName,
            cloneUrl: repo.cloneUrl,
            defaultBranch: repo.defaultBranch,
            description: repo.description,
            isPrivate: repo.isPrivate,
            htmlUrl: repo.htmlUrl,
            connectedAccountId: acct.id,
            topics: repo.topics || [],
          })
          .catch(() => {});
      }

      if (result.hasNext) hasNextOverall = true;
    } catch (err) {
      console.warn(
        `[Git Integrations] Failed to fetch repos for ${acct.provider}/${acct.username}:`,
        err.message,
      );
    }
  }

  // Sort by updatedAt descending
  allRepos.sort(
    (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0),
  );

  res.json({
    repositories: allRepos,
    page,
    perPage,
    totalCount: allRepos.length,
    hasNext: hasNextOverall,
    hasPrev: page > 1,
    noAccountsConnected: false,
  });
});

/**
 * 9. Get Repository Detail
 */
router.get("/repositories/:provider/:owner/:repo", async (req, res) => {
  const { provider, owner, repo } = req.params;
  const prov = provider.toLowerCase();

  try {
    const { token, adapter, account } = await resolveAccountAndToken({
      provider: prov,
    });
    if (!token) {
      return res.status(401).json({
        error: `No active credentials found for ${prov}. Please connect your account first.`,
      });
    }

    const detail = await adapter.getRepository({ token, owner, repo });

    const saved = await db.repositories.upsertRepository({
      provider: prov,
      owner: detail.owner,
      name: detail.name,
      fullName: detail.fullName,
      cloneUrl: detail.cloneUrl,
      defaultBranch: detail.defaultBranch,
      description: detail.description,
      isPrivate: detail.isPrivate,
      htmlUrl: detail.htmlUrl,
      connectedAccountId: account?.id || null,
      topics: detail.topics || [],
    });

    res.json({
      repository: {
        ...detail,
        id: saved.id,
        detectedTech: saved.detected_tech,
      },
    });
  } catch (err) {
    res
      .status(err.statusCode || 500)
      .json({ error: err.message, code: err.code });
  }
});

/**
 * 10. List Repository Branches
 */
router.get(
  "/repositories/:provider/:owner/:repo/branches",
  async (req, res) => {
    const { provider, owner, repo } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const perPage = parseInt(req.query.per_page, 10) || 50;

    try {
      const { token, adapter } = await resolveAccountAndToken({ provider });
      if (!token) {
        return res
          .status(401)
          .json({ error: `No active credentials for ${provider}` });
      }

      const result = await adapter.listBranches({
        token,
        owner,
        repo,
        page,
        perPage,
      });
      res.json(result);
    } catch (err) {
      res
        .status(err.statusCode || 500)
        .json({ error: err.message, code: err.code });
    }
  },
);

/**
 * 11. List Repository Commits
 */
router.get("/repositories/:provider/:owner/:repo/commits", async (req, res) => {
  const { provider, owner, repo } = req.params;
  const branch = req.query.branch ? String(req.query.branch) : "";
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(req.query.per_page, 10) || 30;

  try {
    const { token, adapter } = await resolveAccountAndToken({ provider });
    if (!token) {
      return res
        .status(401)
        .json({ error: `No active credentials for ${provider}` });
    }

    const result = await adapter.listCommits({
      token,
      owner,
      repo,
      branch,
      page,
      perPage,
    });
    res.json(result);
  } catch (err) {
    res
      .status(err.statusCode || 500)
      .json({ error: err.message, code: err.code });
  }
});

/**
 * 12. Remote Inspection and Project Detection
 */
router.get("/repositories/:provider/:owner/:repo/detect", async (req, res) => {
  const { provider, owner, repo } = req.params;
  const ref = req.query.ref ? String(req.query.ref) : "HEAD";

  try {
    const { token, adapter } = await resolveAccountAndToken({ provider });
    if (!token) {
      return res
        .status(401)
        .json({ error: `No active credentials for ${provider}` });
    }

    const detection = await detectRemoteRepository({
      adapter,
      token,
      owner,
      repo,
      ref,
    });

    // Update detected tech in repositories table
    db.repositories
      .updateRepositoryDetectedTech(`${owner}/${repo}`, {
        primaryType: detection.primaryType,
        category: detection.category,
        technologies: detection.technologies,
        requiredCapabilities: detection.requiredCapabilities,
        recommendedProfile: detection.recommendedProfile,
      })
      .catch(() => {});

    res.json(detection);
  } catch (err) {
    console.error(
      `[Remote Detect Error] ${provider}/${owner}/${repo}:`,
      err.message,
    );
    res
      .status(err.statusCode || 500)
      .json({ error: err.message, code: err.code });
  }
});

let callbacks = {
  triggerWorkerOnJobQueued: () => {},
  broadcastJobs: async () => {},
  broadcastPullRequests: async () => {},
};

function setCallbacks(cbs) {
  callbacks = { ...callbacks, ...cbs };
}

/**
 * 13. Trigger Build or PR Checks for a Connected Repository
 */
router.post("/repositories/:provider/:owner/:repo/build", async (req, res) => {
  const { provider, owner, repo } = req.params;
  const prov = provider.toLowerCase();
  const body = req.body || {};

  try {
    const { token, adapter, account } = await resolveAccountAndToken({
      provider: prov,
    });
    if (!token) {
      return res
        .status(401)
        .json({ error: `No active credentials for ${prov}` });
    }

    // Get repository details
    let repoDetail;
    try {
      repoDetail = await adapter.getRepository({ token, owner, repo });
    } catch {
      repoDetail = {
        name: repo,
        owner,
        fullName: `${owner}/${repo}`,
        cloneUrl: `https://${prov === "github" ? "github.com" : "bitbucket.org"}/${owner}/${repo}.git`,
        defaultBranch: "main",
        isPrivate: false,
      };
    }

    const branch = body.branch || repoDetail.defaultBranch || "main";
    let commitHash = body.commitHash || null;
    let commitMsg = body.commitMessage || null;

    if (!commitHash) {
      try {
        const commitRes = await adapter.listCommits({
          token,
          owner,
          repo,
          branch,
          perPage: 1,
        });
        if (commitRes.commits && commitRes.commits.length > 0) {
          commitHash = commitRes.commits[0].hash;
          commitMsg = commitRes.commits[0].message;
        }
      } catch {}
    }

    if (!commitHash) {
      commitHash = "HEAD";
    }

    let kind = body.kind;
    if (!kind) {
      try {
        const detection = await detectRemoteRepository({
          adapter,
          token,
          owner,
          repo,
          ref: commitHash,
        });
        kind = detection.recommendedProfile || "pr-checks";
      } catch {
        kind = "pr-checks";
      }
    }

    const packageManager = body.packageManager || "auto";

    const { job } = await db.jobs.createJob({
      repo: `${owner}/${repo}`,
      cloneUrl: repoDetail.cloneUrl,
      commitHash,
      branch,
      kind,
      packageManager,
      requestedBy: req.user?.username || "console-user",
      metadata: {
        provider: prov,
        connectedAccountId: account?.id || null,
        isPrivate: repoDetail.isPrivate,
        targetApp: body.targetApp || null,
        commitMessage: commitMsg || undefined,
        triggeredFrom: "git-integrations-console",
      },
    });

    if (kind === "pr-checks" && commitHash !== "HEAD") {
      reportCommitStatus({
        provider: prov,
        repo: `${owner}/${repo}`,
        commitHash,
        state: "pending",
        description: "Infraxis: Checks queued from console",
        context: "infraxis/pr-checks",
        token,
      }).catch(() => {});
    }

    callbacks.triggerWorkerOnJobQueued();
    await callbacks.broadcastJobs();

    res.status(202).json({
      queued: true,
      id: job.id,
      kind: job.kind,
      repo: job.repo,
      branch: job.branch,
      commitHash: job.commit_hash,
    });
  } catch (err) {
    console.error(`[Trigger Build Error] ${provider}/${owner}/${repo}:`, err);
    res
      .status(err.statusCode || 500)
      .json({ error: err.message, code: err.code });
  }
});

router.setCallbacks = setCallbacks;

module.exports = router;
