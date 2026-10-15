"use strict";

const crypto = require("crypto");
const { query, withTransaction } = require("./pool");
const { encrypt, decrypt } = require("../services/encryption");

async function upsertGitAccount({
  id = crypto.randomUUID(),
  userId = null,
  provider,
  accountId,
  username,
  displayName = null,
  email = null,
  avatarUrl = null,
  authType = "oauth",
  accessToken,
  refreshToken = null,
  expiresAt = null,
  scopes = [],
  metadata = {},
}) {
  const encryptedAccess = encrypt(accessToken);
  const encryptedRefresh = refreshToken ? encrypt(refreshToken) : null;
  const scopesJson = Array.isArray(scopes)
    ? JSON.stringify(scopes)
    : JSON.stringify([]);
  const metaJson =
    typeof metadata === "string" ? metadata : JSON.stringify(metadata || {});
  const now = new Date().toISOString();

  const res = await query(
    `INSERT INTO git_accounts (
      id, user_id, provider, account_id, username, display_name, email, avatar_url,
      auth_type, encrypted_access_token, encrypted_refresh_token, token_expires_at,
      scopes, metadata, status, error_message, last_synced_at, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'active', NULL, $15, $15, $15
    )
    ON CONFLICT (provider, account_id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = COALESCE(EXCLUDED.display_name, git_accounts.display_name),
      email = COALESCE(EXCLUDED.email, git_accounts.email),
      avatar_url = COALESCE(EXCLUDED.avatar_url, git_accounts.avatar_url),
      auth_type = EXCLUDED.auth_type,
      encrypted_access_token = EXCLUDED.encrypted_access_token,
      encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, git_accounts.encrypted_refresh_token),
      token_expires_at = EXCLUDED.token_expires_at,
      scopes = EXCLUDED.scopes,
      metadata = EXCLUDED.metadata,
      status = 'active',
      error_message = NULL,
      last_synced_at = EXCLUDED.last_synced_at,
      updated_at = EXCLUDED.updated_at
    RETURNING *`,
    [
      id,
      userId,
      provider,
      String(accountId),
      username,
      displayName,
      email,
      avatarUrl,
      authType,
      encryptedAccess,
      encryptedRefresh,
      expiresAt,
      scopesJson,
      metaJson,
      now,
    ],
  );

  return res.rows[0];
}

async function listGitAccounts({ userId = null, provider = null } = {}) {
  let sql = `
    SELECT id, user_id as "userId", provider, account_id as "accountId",
           username, display_name as "displayName", email, avatar_url as "avatarUrl",
           auth_type as "authType", token_expires_at as "tokenExpiresAt",
           scopes, metadata, status, error_message as "errorMessage",
           last_synced_at as "lastSyncedAt", created_at as "createdAt", updated_at as "updatedAt"
    FROM git_accounts
    WHERE 1=1
  `;
  const params = [];

  if (userId) {
    params.push(userId);
    sql += ` AND (user_id = $${params.length} OR user_id IS NULL)`;
  }
  if (provider) {
    params.push(provider);
    sql += ` AND provider = $${params.length}`;
  }

  sql += " ORDER BY updated_at DESC";
  const res = await query(sql, params);
  return res.rows;
}

async function getGitAccountById(id) {
  const res = await query("SELECT * FROM git_accounts WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function getGitAccountByProviderAndAccount(provider, accountId) {
  const res = await query(
    "SELECT * FROM git_accounts WHERE provider = $1 AND account_id = $2",
    [provider, String(accountId)],
  );
  return res.rows[0] || null;
}

async function getFirstActiveGitAccount(provider) {
  const res = await query(
    "SELECT * FROM git_accounts WHERE provider = $1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1",
    [provider],
  );
  return res.rows[0] || null;
}

async function updateGitAccountTokens(
  id,
  { accessToken, refreshToken = null, expiresAt = null, scopes = null },
) {
  const encryptedAccess = encrypt(accessToken);
  const encryptedRefresh = refreshToken ? encrypt(refreshToken) : null;
  const now = new Date().toISOString();

  let sql = `
    UPDATE git_accounts
    SET encrypted_access_token = $2,
        status = 'active',
        error_message = NULL,
        last_synced_at = $3,
        updated_at = $3
  `;
  const params = [id, encryptedAccess, now];

  if (encryptedRefresh) {
    params.push(encryptedRefresh);
    sql += `, encrypted_refresh_token = $${params.length}`;
  }
  if (expiresAt !== undefined) {
    params.push(expiresAt);
    sql += `, token_expires_at = $${params.length}`;
  }
  if (scopes !== null && scopes !== undefined) {
    params.push(JSON.stringify(scopes));
    sql += `, scopes = $${params.length}`;
  }

  sql += ` WHERE id = $1 RETURNING *`;
  const res = await query(sql, params);
  return res.rows[0] || null;
}

async function updateGitAccountStatus(id, status, errorMessage = null) {
  const res = await query(
    `UPDATE git_accounts
     SET status = $2, error_message = $3, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, status, errorMessage],
  );
  return res.rows[0] || null;
}

async function deleteGitAccount(id) {
  return await withTransaction(async (client) => {
    await client.query(
      "UPDATE repositories SET connected_account_id = NULL WHERE connected_account_id = $1",
      [id],
    );
    const res = await client.query(
      "DELETE FROM git_accounts WHERE id = $1 RETURNING id, provider, username",
      [id],
    );
    return res.rows[0] || null;
  });
}

function getDecryptedAccessToken(account) {
  if (!account || !account.encrypted_access_token) return null;
  return decrypt(account.encrypted_access_token);
}

function getDecryptedRefreshToken(account) {
  if (!account || !account.encrypted_refresh_token) return null;
  return decrypt(account.encrypted_refresh_token);
}

// OAuth State Management
async function createOAuthState({
  state = crypto.randomBytes(32).toString("hex"),
  provider,
  userId = null,
  redirectUrl = null,
  ttlSeconds = 600,
}) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await query(
    `INSERT INTO oauth_states (state, provider, user_id, redirect_url, created_at, expires_at)
     VALUES ($1, $2, $3, $4, NOW(), $5)`,
    [state, provider, userId, redirectUrl, expiresAt],
  );
  return state;
}

async function verifyAndConsumeOAuthState(state, provider) {
  return await withTransaction(async (client) => {
    // Delete expired states
    await client.query("DELETE FROM oauth_states WHERE expires_at < NOW()");

    const res = await client.query(
      "SELECT * FROM oauth_states WHERE state = $1 AND provider = $2 FOR UPDATE",
      [state, provider],
    );
    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    await client.query("DELETE FROM oauth_states WHERE state = $1", [state]);

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return null;
    }

    return row;
  });
}

module.exports = {
  upsertGitAccount,
  listGitAccounts,
  getGitAccountById,
  getGitAccountByProviderAndAccount,
  getFirstActiveGitAccount,
  updateGitAccountTokens,
  updateGitAccountStatus,
  deleteGitAccount,
  getDecryptedAccessToken,
  getDecryptedRefreshToken,
  createOAuthState,
  verifyAndConsumeOAuthState,
};
