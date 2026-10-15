"use strict";

const { BaseGitAdapter, GitProviderError } = require("./base-adapter");

class BitbucketAdapter extends BaseGitAdapter {
  constructor() {
    super("bitbucket");
    this.apiBase = "https://api.bitbucket.org/2.0";
    this.authBase = "https://bitbucket.org/site/oauth2";
  }

  getClientId() {
    return process.env.BITBUCKET_CLIENT_ID || "";
  }

  getClientSecret() {
    return process.env.BITBUCKET_CLIENT_SECRET || "";
  }

  isOAuthConfigured() {
    return Boolean(this.getClientId() && this.getClientSecret());
  }

  getAuthUrl({
    state,
    redirectUri,
    scopes = ["account", "repository", "pullrequest"],
  }) {
    const clientId = this.getClientId();
    if (!clientId) {
      throw new GitProviderError("BITBUCKET_CLIENT_ID is not configured", {
        provider: "bitbucket",
        code: "CONFIG_MISSING",
      });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      state,
      scope: scopes.join(" "),
    });

    return `${this.authBase}/authorize?${params.toString()}`;
  }

  async exchangeCode({ code, redirectUri }) {
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();

    if (!clientId || !clientSecret) {
      throw new GitProviderError("Bitbucket OAuth credentials not configured", {
        provider: "bitbucket",
        code: "CONFIG_MISSING",
      });
    }

    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const bodyParams = new URLSearchParams({
      grant_type: "authorization_code",
      code,
    });
    if (redirectUri) bodyParams.set("redirect_uri", redirectUri);

    const res = await fetch(`${this.authBase}/access_token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: bodyParams.toString(),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new GitProviderError(
        data.error_description || data.error || "OAuth exchange failed",
        {
          provider: "bitbucket",
          statusCode: res.status,
          code: "OAUTH_EXCHANGE_FAILED",
        },
      );
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt,
      tokenType: data.token_type || "bearer",
      scope: data.scopes ? data.scopes.split(" ") : [],
    };
  }

  async refreshToken({ refreshToken }) {
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();

    if (!clientId || !clientSecret) {
      throw new GitProviderError(
        "Bitbucket OAuth credentials not configured for token refresh",
        {
          provider: "bitbucket",
          code: "CONFIG_MISSING",
        },
      );
    }

    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const bodyParams = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const res = await fetch(`${this.authBase}/access_token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: bodyParams.toString(),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new GitProviderError(
        data.error_description || data.error || "Token refresh failed",
        {
          provider: "bitbucket",
          statusCode: res.status,
          code: "REFRESH_TOKEN_FAILED",
        },
      );
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt,
      tokenType: data.token_type || "bearer",
      scope: data.scopes ? data.scopes.split(" ") : [],
    };
  }

  async _request(url, token, options = {}) {
    const headers = {
      Accept: "application/json",
      ...(options.headers || {}),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let res;
    try {
      res = await fetch(url, { ...options, headers });
    } catch (netErr) {
      throw new GitProviderError(
        `Network error communicating with Bitbucket: ${netErr.message}`,
        {
          provider: "bitbucket",
          code: "NETWORK_ERROR",
          originalError: netErr,
        },
      );
    }

    if (!res.ok) {
      let errorBody = {};
      try {
        errorBody = await res.json();
      } catch {
        errorBody = { message: await res.text() };
      }

      const msg =
        errorBody.error?.message || errorBody.message || "Bitbucket API error";

      if (res.status === 401) {
        throw new GitProviderError(
          "Bitbucket authentication failed or token has expired",
          {
            provider: "bitbucket",
            statusCode: 401,
            code: "AUTH_EXPIRED",
          },
        );
      }

      if (res.status === 403) {
        throw new GitProviderError(`Access forbidden by Bitbucket: ${msg}`, {
          provider: "bitbucket",
          statusCode: 403,
          code: "FORBIDDEN",
        });
      }

      if (res.status === 404) {
        throw new GitProviderError(`Bitbucket resource not found: ${msg}`, {
          provider: "bitbucket",
          statusCode: 404,
          code: "NOT_FOUND",
        });
      }

      if (res.status === 429) {
        throw new GitProviderError("Bitbucket rate limit exceeded", {
          provider: "bitbucket",
          statusCode: 429,
          code: "RATE_LIMITED",
        });
      }

      throw new GitProviderError(
        `Bitbucket API error (${res.status}): ${msg}`,
        {
          provider: "bitbucket",
          statusCode: res.status,
          code: "API_ERROR",
        },
      );
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return await res.json();
    }
    return await res.text();
  }

  async getUserProfile(token) {
    const user = await this._request(`${this.apiBase}/user`, token);

    let email = null;
    try {
      const emailData = await this._request(
        `${this.apiBase}/user/emails`,
        token,
      );
      if (emailData && Array.isArray(emailData.values)) {
        const primary =
          emailData.values.find((e) => e.is_primary && e.is_confirmed) ||
          emailData.values[0];
        if (primary) email = primary.email;
      }
    } catch {}

    return {
      accountId: user.uuid || user.account_id || user.username,
      username:
        user.username ||
        user.nickname ||
        (email ? email.split("@")[0] : "bitbucket_user"),
      displayName: user.display_name || user.username,
      email,
      avatarUrl: user.links?.avatar?.href || null,
      profileUrl: user.links?.html?.href || null,
    };
  }

  async listRepositories({ token, page = 1, perPage = 30, query = "" }) {
    // Bitbucket Cloud API 2.0 requires workspace context for repository discovery
    let workspaceSlugs = [];
    try {
      const wsData = await this._request(`${this.apiBase}/user/workspaces?pagelen=50`, token);
      if (Array.isArray(wsData.values)) {
        workspaceSlugs = wsData.values
          .map((v) => v.workspace?.slug)
          .filter(Boolean);
      }
    } catch (wsErr) {
      console.warn("[Bitbucket Adapter] Could not list user workspaces:", wsErr.message);
    }

    // Fallback: try /user endpoint to get username/account as fallback workspace
    if (workspaceSlugs.length === 0) {
      try {
        const u = await this._request(`${this.apiBase}/user`, token);
        if (u.username) workspaceSlugs.push(u.username);
      } catch {}
    }

    let allRepos = [];
    let hasNext = false;
    let hasPrev = page > 1;
    let totalCount = 0;

    for (const ws of workspaceSlugs) {
      try {
        let url = `${this.apiBase}/repositories/${encodeURIComponent(ws)}?pagelen=${perPage}&page=${page}&sort=-updated_on`;
        if (query && query.trim()) {
          url += `&q=${encodeURIComponent(`name ~ "${query.trim()}"`)}`;
        }

        const data = await this._request(url, token);
        const rawList = Array.isArray(data.values) ? data.values : [];
        totalCount += data.size !== undefined ? data.size : rawList.length;
        if (data.next) hasNext = true;

        for (const r of rawList) {
          const cloneLinks = r.links?.clone || [];
          const httpsLink = cloneLinks.find((c) => c.name === "https")?.href || "";
          const cleanClone = httpsLink
            ? httpsLink.replace(/^https:\/\/[^@/]+@/i, "https://")
            : `https://bitbucket.org/${r.full_name}.git`;

          allRepos.push({
            id: r.uuid || r.full_name,
            provider: "bitbucket",
            owner: r.workspace?.slug || ws,
            name: r.name || r.slug,
            fullName: r.full_name,
            description: r.description || "",
            isPrivate: Boolean(r.is_private),
            defaultBranch: r.mainbranch?.name || "main",
            cloneUrl: cleanClone,
            htmlUrl: r.links?.html?.href || `https://bitbucket.org/${r.full_name}`,
            updatedAt: r.updated_on,
            topics: [],
            starsCount: 0,
            forksCount: 0,
            language: r.language || null,
          });
        }
      } catch (repoErr) {
        console.warn(`[Bitbucket Adapter] Failed to list repos for workspace ${ws}:`, repoErr.message);
      }
    }

    return {
      repositories: allRepos,
      page,
      perPage,
      totalCount: totalCount || allRepos.length,
      hasNext,
      hasPrev,
    };
  }

  async getRepository({ token, owner, repo }) {
    const r = await this._request(
      `${this.apiBase}/repositories/${owner}/${repo}`,
      token,
    );
    const cloneLinks = r.links?.clone || [];
    const httpsLink = cloneLinks.find((c) => c.name === "https")?.href || "";
    const cleanClone = httpsLink
      ? httpsLink.replace(/^https:\/\/[^@/]+@/i, "https://")
      : `https://bitbucket.org/${r.full_name}.git`;

    return {
      id: r.uuid || r.full_name,
      provider: "bitbucket",
      owner: r.workspace?.slug || owner,
      name: r.name || r.slug,
      fullName: r.full_name,
      description: r.description || "",
      isPrivate: Boolean(r.is_private),
      defaultBranch: r.mainbranch?.name || "main",
      cloneUrl: cleanClone,
      htmlUrl: r.links?.html?.href || `https://bitbucket.org/${r.full_name}`,
      updatedAt: r.updated_on,
      topics: [],
      starsCount: 0,
      forksCount: 0,
      language: r.language || null,
    };
  }

  async listBranches({ token, owner, repo, page = 1, perPage = 50 }) {
    const url = `${this.apiBase}/repositories/${owner}/${repo}/refs/branches?pagelen=${perPage}&page=${page}`;
    const data = await this._request(url, token);
    const rawList = Array.isArray(data.values) ? data.values : [];

    return {
      branches: rawList.map((b) => ({
        name: b.name,
        commitHash: b.target?.hash,
        isProtected: false,
      })),
      page,
      hasNext: Boolean(data.next),
    };
  }

  async listCommits({
    token,
    owner,
    repo,
    branch = "",
    page = 1,
    perPage = 30,
  }) {
    let url = `${this.apiBase}/repositories/${owner}/${repo}/commits?pagelen=${perPage}&page=${page}`;
    if (branch) url += `&include=${encodeURIComponent(branch)}`;

    const data = await this._request(url, token);
    const rawList = Array.isArray(data.values) ? data.values : [];

    return {
      commits: rawList.map((c) => ({
        hash: c.hash,
        shortHash: c.hash ? c.hash.slice(0, 7) : "",
        message: c.message?.split("\n")[0] || "",
        fullMessage: c.message || "",
        author: c.author?.raw || c.author?.user?.display_name || "Unknown",
        authorEmail: null,
        authorAvatar: c.author?.user?.links?.avatar?.href || null,
        date: c.date,
        url: c.links?.html?.href || null,
      })),
      page,
      hasNext: Boolean(data.next),
    };
  }

  async getFileContent({ token, owner, repo, path, ref = "HEAD" }) {
    const cleanPath = path.replace(/^\//, "");
    const url = `${this.apiBase}/repositories/${owner}/${repo}/src/${encodeURIComponent(ref)}/${cleanPath}`;
    try {
      const res = await this._request(url, token);
      if (typeof res === "string") return res;
      if (typeof res === "object") return JSON.stringify(res, null, 2);
      return null;
    } catch (err) {
      if (err.statusCode === 404) return null;
      throw err;
    }
  }

  async getTree({ token, owner, repo, ref = "HEAD", maxDepth = 3 }) {
    const url = `${this.apiBase}/repositories/${owner}/${repo}/src/${encodeURIComponent(ref)}/?pagelen=100&max_depth=${maxDepth}`;
    try {
      const data = await this._request(url, token);
      if (!data || !Array.isArray(data.values)) return [];
      return data.values.map((v) => ({
        path: v.path,
        type: v.type === "commit_file" ? "file" : "dir",
        size: v.size || 0,
      }));
    } catch (err) {
      if (err.statusCode === 404) return [];
      throw err;
    }
  }

  async reportStatus({
    token,
    repo,
    commitHash,
    state,
    description,
    targetUrl,
    context = "infraxis/pr-checks",
  }) {
    const cleanRepo = repo
      .replace(/^https:\/\/[^/]+\//, "")
      .replace(/\.git$/, "");
    const url = `${this.apiBase}/repositories/${cleanRepo}/commit/${commitHash}/statuses/build`;

    const bbStateMap = {
      pending: "INPROGRESS",
      running: "INPROGRESS",
      success: "SUCCESSFUL",
      failure: "FAILED",
      error: "FAILED",
      cancelled: "STOPPED",
    };
    const bbState = bbStateMap[state] || "FAILED";

    const data = await this._request(url, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: bbState,
        key: context,
        name: "Infraxis Build & Checks",
        url: targetUrl || "",
        description: (description || `Infraxis check: ${state}`).slice(0, 255),
      }),
    });

    return data;
  }
}

module.exports = {
  BitbucketAdapter,
};
