"use strict";

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const db = require("../server/db");

test("Authentication: Users and Tokens", async () => {
  const userId = "test-user-" + crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("hex");

  const created = await db.auth.createDirectUser({
    id: userId,
    username: "testuser_" + crypto.randomUUID().slice(0, 8),
    email: `test_${crypto.randomUUID().slice(0, 8)}@infraxis.local`,
    passwordHash: "hash123",
    salt: "salt123",
    fullName: "Test User",
    organization: "Infraxis QA",
    roleTitle: "Lead Engineer",
    token,
  });

  assert.strictEqual(created.id, userId);

  // Find user by token
  const found = await db.auth.findUserByToken(token);
  assert.ok(found, "User should be found by token");
  assert.strictEqual(found.id, userId);
  assert.strictEqual(found.organization, "Infraxis QA");

  // Cleanup
  await db.query("DELETE FROM users WHERE id = $1", [userId]);
});

test("Authentication: OTP creation and single-use verification", async () => {
  const email = `otp_test_${crypto.randomUUID().slice(0, 8)}@infraxis.local`;
  const code = "654321";
  const expiresAt = new Date(Date.now() + 600000).toISOString();

  await db.auth.recordOtp({
    email,
    otpCode: code,
    purpose: "login",
    expiresAt,
  });

  // 1. Invalid code should fail
  const badVerify = await db.auth.verifyOtp({ email, otpCode: "000000", purpose: "login" });
  assert.strictEqual(badVerify, false);

  // 2. Valid code should succeed
  const goodVerify = await db.auth.verifyOtp({ email, otpCode: code, purpose: "login" });
  assert.strictEqual(goodVerify, true);

  // 3. Second attempt with same code should fail (single-use OTP)
  const reusedVerify = await db.auth.verifyOtp({ email, otpCode: code, purpose: "login" });
  assert.strictEqual(reusedVerify, false);

  // Cleanup
  await db.query("DELETE FROM otps WHERE email = $1", [email]);
});

test.after(async () => {
  await db.closePool().catch(() => {});
});
