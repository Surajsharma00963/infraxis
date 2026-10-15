"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { encrypt, decrypt } = require("../server/services/encryption");

test("Encryption: Encrypts and decrypts sensitive tokens with AES-256-GCM", () => {
  const secret = "ghp_mySuperSecretGitHubPersonalAccessToken1234567890";
  const encrypted = encrypt(secret);

  assert.notEqual(encrypted, secret);
  assert.match(encrypted, /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);

  const decrypted = decrypt(encrypted);
  assert.equal(decrypted, secret);
});

test("Encryption: Handles null, empty, or undefined input gracefully", () => {
  assert.equal(encrypt(null), null);
  assert.equal(encrypt(undefined), null);
  assert.equal(encrypt(""), "");
  assert.equal(decrypt(null), null);
  assert.equal(decrypt(""), null);
});

test("Encryption: Rejects tampered ciphertext or auth tag", () => {
  const secret = "bitbucket_oauth_refresh_token_xyz987";
  const encrypted = encrypt(secret);
  const parts = encrypted.split(":");

  // Tamper with ciphertext
  const tamperedCipher = parts[2].slice(0, -2) + "==";
  const tamperedPayload = `${parts[0]}:${parts[1]}:${tamperedCipher}`;

  assert.throws(() => {
    decrypt(tamperedPayload);
  });
});
