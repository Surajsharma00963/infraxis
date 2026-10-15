"use strict";

/**
 * Custom Error Class for Git Provider operations
 */
class GitProviderError extends Error {
  constructor(message, { provider, statusCode, code, retryAfter = null, originalError = null } = {}) {
    super(message);
    this.name = "GitProviderError";
    this.provider = provider;
    this.statusCode = statusCode;
    this.code = code || "GIT_PROVIDER_ERROR";
    this.retryAfter = retryAfter;
    this.originalError = originalError;
  }
}

/**
 * Base Git Provider Adapter Interface
 */
class BaseGitAdapter {
  constructor(providerName) {
    this.provider = providerName;
  }

  getAuthUrl(_options) {
    throw new Error(`getAuthUrl not implemented for ${this.provider}`);
  }

  async exchangeCode(_options) {
    throw new Error(`exchangeCode not implemented for ${this.provider}`);
  }

  async refreshToken(_options) {
    throw new Error(`refreshToken not implemented for ${this.provider}`);
  }

  async getUserProfile(_token) {
    throw new Error(`getUserProfile not implemented for ${this.provider}`);
  }

  async listRepositories(_options) {
    throw new Error(`listRepositories not implemented for ${this.provider}`);
  }

  async getRepository(_options) {
    throw new Error(`getRepository not implemented for ${this.provider}`);
  }

  async listBranches(_options) {
    throw new Error(`listBranches not implemented for ${this.provider}`);
  }

  async listCommits(_options) {
    throw new Error(`listCommits not implemented for ${this.provider}`);
  }

  async getFileContent(_options) {
    throw new Error(`getFileContent not implemented for ${this.provider}`);
  }

  async getTree(_options) {
    throw new Error(`getTree not implemented for ${this.provider}`);
  }

  async reportStatus(_options) {
    throw new Error(`reportStatus not implemented for ${this.provider}`);
  }
}

module.exports = {
  BaseGitAdapter,
  GitProviderError,
};
