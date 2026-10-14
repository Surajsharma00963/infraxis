"use strict";

const crypto = require("crypto");
const { query, withTransaction } = require("./pool");

async function getUserById(id) {
  const res = await query("SELECT * FROM users WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function getUserByEmailOrUsername(identifier) {
  const clean = (identifier || "").toLowerCase().trim();
  const res = await query(
    "SELECT * FROM users WHERE email = $1 OR username = $2",
    [clean, clean]
  );
  return res.rows[0] || null;
}

async function findUserByToken(token) {
  if (!token) return null;
  const res = await query(
    `SELECT u.id, u.username, u.email, u.full_name as "fullName",
            u.organization, u.role_title as "roleTitle", u.role
     FROM user_tokens ut
     JOIN users u ON ut.user_id = u.id
     WHERE ut.token = $1`,
    [token]
  );
  return res.rows[0] || null;
}

async function createToken(token, userId, name = "Token") {
  const now = new Date().toISOString();
  await query(
    "INSERT INTO user_tokens (token, user_id, name, created_at) VALUES ($1, $2, $3, $4)",
    [token, userId, name, now]
  );
}

async function createPendingRegistration({
  id = crypto.randomUUID(),
  email,
  username,
  fullName,
  phone,
  organization,
  roleTitle,
  passwordHash,
  salt,
}) {
  const cleanEmail = email.toLowerCase().trim();
  const cleanUsername = username.toLowerCase().trim();
  const now = new Date().toISOString();

  await withTransaction(async (client) => {
    await client.query(
      "DELETE FROM pending_registrations WHERE email = $1 OR username = $2",
      [cleanEmail, cleanUsername]
    );

    await client.query(
      `INSERT INTO pending_registrations (
        id, email, username, full_name, phone, organization, role_title,
        password_hash, salt, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        cleanEmail,
        cleanUsername,
        fullName || null,
        phone || null,
        organization || null,
        roleTitle || null,
        passwordHash,
        salt,
        now,
      ]
    );
  });
}

async function getPendingRegistration(email) {
  const cleanEmail = email.toLowerCase().trim();
  const res = await query(
    "SELECT * FROM pending_registrations WHERE email = $1",
    [cleanEmail]
  );
  return res.rows[0] || null;
}

async function activateUserFromPending({ pending, userId = crypto.randomUUID(), token }) {
  const now = new Date().toISOString();

  return await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO users (
        id, username, email, password_hash, salt, full_name, phone,
        organization, role_title, role, is_verified, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'admin', 1, $10)`,
      [
        userId,
        pending.username,
        pending.email,
        pending.password_hash,
        pending.salt,
        pending.full_name,
        pending.phone,
        pending.organization,
        pending.role_title,
        now,
      ]
    );

    await client.query(
      "INSERT INTO user_tokens (token, user_id, name, created_at) VALUES ($1, $2, 'Primary Admin Token', $3)",
      [token, userId, now]
    );

    await client.query(
      "DELETE FROM pending_registrations WHERE email = $1",
      [pending.email]
    );

    return {
      id: userId,
      username: pending.username,
      email: pending.email,
      fullName: pending.full_name,
      organization: pending.organization,
      roleTitle: pending.role_title,
      role: "admin",
    };
  });
}

async function createDirectUser({
  id = crypto.randomUUID(),
  username,
  email,
  passwordHash,
  salt,
  fullName,
  phone,
  organization,
  roleTitle,
  token,
}) {
  const cleanEmail = email.toLowerCase().trim();
  const cleanUsername = username.toLowerCase().trim();
  const now = new Date().toISOString();

  return await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO users (
        id, username, email, password_hash, salt, full_name, phone,
        organization, role_title, role, is_verified, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'admin', 1, $10)`,
      [
        id,
        cleanUsername,
        cleanEmail,
        passwordHash,
        salt,
        fullName || null,
        phone || null,
        organization || null,
        roleTitle || null,
        now,
      ]
    );

    await client.query(
      "INSERT INTO user_tokens (token, user_id, name, created_at) VALUES ($1, $2, 'Primary Admin Token', $3)",
      [token, id, now]
    );

    return {
      id,
      username: cleanUsername,
      email: cleanEmail,
      fullName,
      organization,
      roleTitle,
      role: "admin",
    };
  });
}

async function recordOtp({ id = crypto.randomUUID(), email, otpCode, purpose, expiresAt }) {
  const cleanEmail = email.toLowerCase().trim();
  const now = new Date().toISOString();

  await query(
    `INSERT INTO otps (id, email, otp_code, purpose, expires_at, used, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6)`,
    [id, cleanEmail, otpCode, purpose, expiresAt, now]
  );
}

async function verifyOtp({ email, otpCode, purpose }) {
  const cleanEmail = email.toLowerCase().trim();
  const cleanCode = otpCode.trim();
  const now = new Date().toISOString();

  return await withTransaction(async (client) => {
    const res = await client.query(
      `SELECT * FROM otps
       WHERE email = $1 AND otp_code = $2 AND purpose = $3 AND used = 0
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [cleanEmail, cleanCode, purpose]
    );

    if (res.rows.length === 0) return false;
    const record = res.rows[0];

    if (new Date(record.expires_at).getTime() < Date.now()) {
      return false;
    }

    await client.query("UPDATE otps SET used = 1 WHERE id = $1", [record.id]);
    return true;
  });
}

module.exports = {
  getUserById,
  getUserByEmailOrUsername,
  findUserByToken,
  createToken,
  createPendingRegistration,
  getPendingRegistration,
  activateUserFromPending,
  createDirectUser,
  recordOtp,
  verifyOtp,
};
