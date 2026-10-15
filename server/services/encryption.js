"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Automatically load .env if environment variables are not already set
if (!process.env.ENCRYPTION_KEY && !process.env.CI_ADMIN_TOKEN) {
  const envPath = path.resolve(__dirname, "../../.env");
  if (fs.existsSync(envPath)) {
    try {
      if (typeof process.loadEnvFile === "function") {
        process.loadEnvFile(envPath);
      } else {
        const lines = fs.readFileSync(envPath, "utf8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const idx = trimmed.indexOf("=");
          if (idx !== -1) {
            const k = trimmed.slice(0, idx).trim();
            const v = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
            if (!process.env[k]) process.env[k] = v;
          }
        }
      }
    } catch {}
  }
}

/**
 * AES-256-GCM Credential Encryption Service
 * Encrypts sensitive OAuth and personal access tokens at rest.
 * Key is derived from ENCRYPTION_KEY or CI_ADMIN_TOKEN via SHA-256.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Standard for GCM
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey() {
  const secret =
    process.env.ENCRYPTION_KEY ||
    process.env.CI_ADMIN_TOKEN ||
    process.env.INFRAXIS_ADMIN_TOKEN ||
    "infraxis-secure-fallback-encryption-key-for-local-dev";

  return crypto.createHash("sha256").update(String(secret)).digest();
}

/**
 * Encrypt plaintext string
 * @param {string} plaintext
 * @returns {string} iv:authTag:ciphertext (base64 encoded)
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const str = String(plaintext);
  if (!str) return "";

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([cipher.update(str, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypt encrypted string
 * @param {string} encryptedPayload
 * @returns {string} plaintext
 */
function decrypt(encryptedPayload) {
  if (!encryptedPayload) return null;
  const parts = String(encryptedPayload).split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }

  const [ivB64, tagB64, cipherB64] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(cipherB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

module.exports = {
  encrypt,
  decrypt,
};
