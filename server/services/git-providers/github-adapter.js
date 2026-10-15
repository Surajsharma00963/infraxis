"use strict";

const { BaseGitAdapter, GitProviderError } = require("./base-adapter");

class GitHubAdapter extends BaseGitAdapter {
  constructor() {
    super("github");
    this.apiBase = "https://api.github.com";
    this.authBase = "https://github.com/login/oauth";
  }

  getClientId() {
    return process.env.GITHUB_CLIENT_ID || "";
  }

  getClientSecret() {
    return process.env.GITHUB_CLIENT_SECRET || "";
  }

  isOAuthConfigured() {
    return Boolean(this.getClientId() && this.getClientSecret());
  }

  getAuthUrl({
    state,
    redirectUri,
    scopes = ["repo", "read:user", "user:email"],
  }) {
    const clientId = this.getClientId();
    if (!clientId) {
      throw new GitProviderError("GITHUB_CLIENT_ID is not configured", {
        provider: "github",
        code: "CONFIG_MISSING",
      });
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes.join(","),
      state,
      allow_signup: "true",
    });

    return `${this.authBase}/authorize?${params.toString()}`;
  }

  async exchangeCode({ code, redirectUri }) {
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();

    if (!clientId || !clientSecret) {
      throw new GitProviderError("GitHub OAuth credentials not configured", {
        provider: "github",
        code: "CONFIG_MISSING",
      });
    }

    const res = await fetch(`${this.authBase}/access_token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Infraxis-CI",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await res.json();
    if (data.error) {
      throw new GitProviderError(data.error_description || data.error, {
        provider: "github",
        statusCode: 400,
        code: "OAUTH_EXCHANGE_FAILED",
      });
    }

    return {
      accessToken: data.access_token,
      tokenType: data.token_type || "bearer",
      scope: data.scope ? data.scope.split(",") : [],
    };
  }

  async refreshToken() {
    // GitHub user tokens typically do not expire unless using GitHub App expiring user tokens
    return null;
  }

  async _request(url, token, options = {}) {
    const headers = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Infraxis-CI",
      ...(options.headers || {}),
    };

    if (token) {
      headers.Authorization = `token ${token}`;
    }

    let res;
    try {
      res = await fetch(url, { ...options, headers });
    } catch (netErr) {
      throw new GitProviderError(
        `Network error communicating with GitHub: ${netErr.message}`,
        {
          provider: "github",
          code: "NETWORK_ERROR",
          originalError: netErr,
        },
      );
    }

    const rateRemaining = res.headers.get("x-ratelimit-remaining");
    const rateReset = res.headers.get("x-ratelimit-reset");

    if (!res.ok) {
      let errorBody = {};
      try {
        errorBody = await res.json();
      } catch {
        errorBody = { message: await res.text() };
      }

      if (res.status === 401) {
        throw new GitProviderError(
          "GitHub authentication failed or token has expired / been revoked",
          {
            provider: "github",
            statusCode: 401,
            code: "AUTH_EXPIRED",
          },
        );
      }

      if (res.status === 403 && rateRemaining === "0") {
        const resetDate = rateReset
          ? new Date(parseInt(rateReset, 10) * 1000).toISOString()
          : null;
        throw new GitProviderError(
          `GitHub API rate limit exceeded. Resets at ${resetDate}`,
          {
            provider: "github",
            statusCode: 429,
            code: "RATE_LIMITED",
            retryAfter: rateReset,
          },
        );
      }

      if (res.status === 404) {
        throw new GitProviderError(
          `GitHub resource not found: ${errorBody.message || "404 Not Found"}`,
          {
            provider: "github",
            statusCode: 404,
            code: "NOT_FOUND",
          },
        );
      }

      throw new GitProviderError(
        `GitHub API error (${res.status}): ${errorBody.message || "Unknown error"}`,
        {
          provider: "github",
          statusCode: res.status,
          code: "API_ERROR",
        },
      );
    }

    // Check if json or text
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await res.json();
      return {
        data: json,
        headers: res.headers,
        link: res.headers.get("link"),
      };
    }

    return {
      data: await res.text(),
      headers: res.headers,
    };
  }

  async getUserProfile(token) {
    const { data: user } = await this._request(`${this.apiBase}/user`, token);

    let email = user.email || null;
    if (!email) {
      try {
        const { data: emails } = await this._request(
          `${this.apiBase}/user/emails`,
          token,
        );
        if (Array.isArray(emails)) {
          const primary =
            emails.find((e) => e.primary && e.verified) ||
            emails.find((e) => e.verified) ||
            emails[0];
          if (primary) email = primary.email;
        }
      } catch {}
    }

    return {
      accountId: String(user.id),
      username: user.login,
      displayName: user.name || user.login,
      email,
      avatarUrl: user.avatar_url,
      profileUrl: user.html_url,
      publicRepos: user.public_repos,
      totalPrivateRepos: user.total_private_repos || 0,
    };
  }

  async listRepositories({ token, page = 1, perPage = 30, query = "" }) {
    let url;
    if (query && query.trim()) {
      const q = encodeURIComponent(`${query.trim()} in:name`);
      url = `${this.apiBase}/search/repositories?q=${q}&per_page=${perPage}&page=${page}&sort=updated`;
    } else {
      url = `${this.apiBase}/user/repos?per_page=${perPage}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`;
    }

    const { data, link } = await this._request(url, token);
    const rawList = Array.isArray(data) ? data : data.items || [];

    const repos = rawList.map((r) => ({
      id: String(r.id),
      provider: "github",
      owner: r.owner?.login || "",
      name: r.name,
      fullName: r.full_name,
      description: r.description || "",
      isPrivate: Boolean(r.private),
      defaultBranch: r.default_branch || "main",
      cloneUrl: r.clone_url || `https://github.com/${r.full_name}.git`,
      htmlUrl: r.html_url,
      updatedAt: r.updated_at,
      pushedAt: r.pushed_at,
      topics: r.topics || [],
      starsCount: r.stargazers_count || 0,
      forksCount: r.forks_count || 0,
      language: r.language || null,
    }));

    const hasNext = Boolean(link && link.includes('rel="next"'));
    const hasPrev = Boolean(link && link.includes('rel="prev"'));

    return {
      repositories: repos,
      page,
      perPage,
      totalCount:
        data.total_count !== undefined ? data.total_count : repos.length,
      hasNext,
      hasPrev,
    };
  }

  async getRepository({ token, owner, repo }) {
    const { data: r } = await this._request(
      `${this.apiBase}/repos/${owner}/${repo}`,
      token,
    );
    return {
      id: String(r.id),
      provider: "github",
      owner: r.owner?.login || owner,
      name: r.name,
      fullName: r.full_name,
      description: r.description || "",
      isPrivate: Boolean(r.private),
      defaultBranch: r.default_branch || "main",
      cloneUrl: r.clone_url,
      htmlUrl: r.html_url,
      updatedAt: r.updated_at,
      pushedAt: r.pushed_at,
      topics: r.topics || [],
      starsCount: r.stargazers_count || 0,
      forksCount: r.forks_count || 0,
      language: r.language || null,
    };
  }

  async listBranches({ token, owner, repo, page = 1, perPage = 50 }) {
    const url = `${this.apiBase}/repos/${owner}/${repo}/branches?per_page=${perPage}&page=${page}`;
    const { data: branches, link } = await this._request(url, token);

    return {
      branches: (branches || []).map((b) => ({
        name: b.name,
        commitHash: b.commit?.sha,
        isProtected: Boolean(b.protected),
      })),
      page,
      hasNext: Boolean(link && link.includes('rel="next"')),
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
    let url = `${this.apiBase}/repos/${owner}/${repo}/commits?per_page=${perPage}&page=${page}`;
    if (branch) url += `&sha=${encodeURIComponent(branch)}`;

    const { data: commits, link } = await this._request(url, token);

    return {
      commits: (commits || []).map((c) => ({
        hash: c.sha,
        shortHash: c.sha ? c.sha.slice(0, 7) : "",
        message: c.commit?.message?.split("\n")[0] || "",
        fullMessage: c.commit?.message || "",
        author: c.commit?.author?.name || c.author?.login || "Unknown",
        authorEmail: c.commit?.author?.email || null,
        authorAvatar: c.author?.avatar_url || null,
        date: c.commit?.author?.date || null,
        url: c.html_url,
      })),
      page,
      hasNext: Boolean(link && link.includes('rel="next"')),
    };
  }

  async getFileContent({ token, owner, repo, path, ref = "HEAD" }) {
    const cleanPath = path.replace(/^\//, "");
    const url = `${this.apiBase}/repos/${owner}/${repo}/contents/${cleanPath}?ref=${encodeURIComponent(ref)}`;
    try {
      const { data } = await this._request(url, token);
      if (data && data.content && data.encoding === "base64") {
        return Buffer.from(data.content, "base64").toString("utf8");
      }
      return null;
    } catch (err) {
      if (err.statusCode === 404) return null;
      throw err;
    }
  }

  async getTree({ token, owner, repo, ref = "HEAD", recursive = true }) {
    const url = `${this.apiBase}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}${recursive ? "?recursive=1" : ""}`;
    try {
      const { data } = await this._request(url, token);
      if (!data || !Array.isArray(data.tree)) return [];
      return data.tree.map((item) => ({
        path: item.path,
        type: item.type === "blob" ? "file" : "dir",
        size: item.size || 0,
        sha: item.sha,
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
    const url = `${this.apiBase}/repos/${cleanRepo}/statuses/${commitHash}`;

    // GitHub states: pending, success, failure, error
    const ghState = ["pending", "success", "failure", "error"].includes(state)
      ? state
      : "error";

    const { data } = await this._request(url, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: ghState,
        description: (description || `Infraxis: ${ghState}`).slice(0, 140),
        target_url: targetUrl || "",
        context,
      }),
    });

    return data;
  }
}

module.exports = {
  GitHubAdapter,
};
