"use strict";

/**
 * Universal PR and Commit Status Reporter for Infraxis
 * Publishes check status back to GitHub and Bitbucket commits/PRs.
 */

async function reportCommitStatus({
  provider = "github",
  repo,
  commitHash,
  state, // "pending" | "success" | "failure" | "error"
  targetUrl = "",
  description = "",
  context = "infraxis/pr-checks",
  token = null,
}) {
  if (!repo || !commitHash) {
    return { success: false, reason: "Missing repository or commit hash" };
  }

  const cleanRepo = repo
    .replace(/^https:\/\/[^/]+\//, "")
    .replace(/\.git$/, "");
  let authToken =
    token ||
    (provider === "github"
      ? process.env.GITHUB_TOKEN
      : process.env.BITBUCKET_TOKEN);

  if (!authToken) {
    try {
      const gitAccounts = require("../db/git-accounts");
      let account = null;
      if (connectedAccountId) {
        account = await gitAccounts.getGitAccountById(connectedAccountId);
      } else if (provider) {
        const repoOwner = cleanRepo.split("/")[0]?.toLowerCase();
        const cand = await gitAccounts.getFirstActiveGitAccount(provider);
        if (cand && (!repoOwner || cand.username?.toLowerCase() === repoOwner)) {
          account = cand;
        }
      }
      if (account) {
        authToken = gitAccounts.getDecryptedAccessToken(account);
      }
    } catch {}
  }

  const payload = {
    provider,
    repo: cleanRepo,
    commitHash,
    state,
    context,
    description: description || `Infraxis check: ${state}`,
    targetUrl,
  };

  if (!authToken) {
    // If no token configured in self-hosted mode, record status locally and log
    console.log(
      `[Status Reporter] (No external token) Status '${state}' recorded for ${provider} ${cleanRepo}@${commitHash.slice(0, 7)}`,
    );
    return { success: true, localOnly: true, payload };
  }

  try {
    if (provider === "github") {
      const url = `https://api.github.com/repos/${cleanRepo}/statuses/${commitHash}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `token ${authToken}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "Infraxis-CI",
        },
        body: JSON.stringify({
          state, // pending, success, failure, error
          target_url: targetUrl,
          description: payload.description.slice(0, 140),
          context,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.warn(
          `[Status Reporter] GitHub status update failed (${res.status}): ${text}`,
        );
        return { success: false, status: res.status, error: text };
      }
      return { success: true, remoteReported: true };
    } else if (provider === "bitbucket") {
      // Map state to Bitbucket commit status states: INPROGRESS, SUCCESSFUL, FAILED, STOPPED
      const bbStateMap = {
        pending: "INPROGRESS",
        running: "INPROGRESS",
        success: "SUCCESSFUL",
        failure: "FAILED",
        error: "FAILED",
        cancelled: "STOPPED",
      };
      const bbState = bbStateMap[state] || "FAILED";
      const url = `https://api.bitbucket.org/2.0/repositories/${cleanRepo}/commit/${commitHash}/statuses/build`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          state: bbState,
          key: context,
          name: "Infraxis Build & Checks",
          url: targetUrl,
          description: payload.description,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.warn(
          `[Status Reporter] Bitbucket status update failed (${res.status}): ${text}`,
        );
        return { success: false, status: res.status, error: text };
      }
      return { success: true, remoteReported: true };
    }
  } catch (err) {
    console.warn(
      `[Status Reporter] Failed to report commit status: ${err.message}`,
    );
    return { success: false, error: err.message };
  }

  return { success: false, reason: "Unsupported provider" };
}

module.exports = {
  reportCommitStatus,
  reportPRStatus: reportCommitStatus,
};
