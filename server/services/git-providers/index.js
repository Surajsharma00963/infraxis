"use strict";

const { BaseGitAdapter, GitProviderError } = require("./base-adapter");
const { GitHubAdapter } = require("./github-adapter");
const { BitbucketAdapter } = require("./bitbucket-adapter");
const gitAccounts = require("../../db/git-accounts");

const adapters = {
  github: new GitHubAdapter(),
  bitbucket: new BitbucketAdapter(),
};

function getAdapter(provider) {
  const norm = (provider || "").toLowerCase().trim();
  const adapter = adapters[norm];
  if (!adapter) {
    throw new GitProviderError(`Unsupported git provider: ${provider}`, {
      provider,
      code: "UNSUPPORTED_PROVIDER",
    });
  }
  return adapter;
}

/**
 * Resolve an active access token for a given provider or accountId.
 * Automatically performs token refresh if Bitbucket token is expired or about to expire.
 */
async function resolveAccountAndToken({
  accountId = null,
  provider = null,
} = {}) {
  let account = null;

  if (accountId) {
    account = await gitAccounts.getGitAccountById(accountId);
  } else if (provider) {
    account = await gitAccounts.getFirstActiveGitAccount(provider);
  }

  if (account) {
    const prov = account.provider;
    const adapter = getAdapter(prov);
    let token = gitAccounts.getDecryptedAccessToken(account);

    // Check if token is expired or expiring within 2 minutes
    const expiresAt = account.token_expires_at
      ? new Date(account.token_expires_at).getTime()
      : null;
    const isExpiringSoon = expiresAt && expiresAt - Date.now() < 2 * 60 * 1000;

    if (
      isExpiringSoon &&
      account.encrypted_refresh_token &&
      prov === "bitbucket"
    ) {
      try {
        const refreshToken = gitAccounts.getDecryptedRefreshToken(account);
        const refreshed = await adapter.refreshToken({ refreshToken });
        await gitAccounts.updateGitAccountTokens(account.id, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
          scopes: refreshed.scope,
        });
        token = refreshed.accessToken;
      } catch (refErr) {
        console.warn(
          `[Git Provider] Failed to refresh token for account ${account.id}: ${refErr.message}`,
        );
        await gitAccounts.updateGitAccountStatus(
          account.id,
          "error",
          refErr.message,
        );
      }
    }

    return {
      account,
      token,
      provider: prov,
      adapter,
    };
  }

  // Fallback to environment tokens
  const envToken =
    provider === "github"
      ? process.env.GITHUB_TOKEN
      : provider === "bitbucket"
        ? process.env.BITBUCKET_TOKEN
        : null;

  if (envToken && provider) {
    return {
      account: null,
      token: envToken,
      provider,
      adapter: getAdapter(provider),
      isEnvFallback: true,
    };
  }

  return {
    account: null,
    token: null,
    provider,
    adapter: provider ? getAdapter(provider) : null,
  };
}

module.exports = {
  getAdapter,
  resolveAccountAndToken,
  adapters,
  GitProviderError,
  GitHubAdapter,
  BitbucketAdapter,
};
