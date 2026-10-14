"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Lock,
  Mail,
  User,
  Building,
  Briefcase,
  Phone,
  Shield,
  ArrowRight,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  ArrowLeft,
} from "lucide-react";

interface AuthScreenProps {
  onAuthenticate: (token: string) => void;
  isConnecting: boolean;
  authError?: string;
}

export default function AuthScreen({
  onAuthenticate,
  isConnecting,
  authError,
}: AuthScreenProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [step, setStep] = useState<"form" | "otp">("form");

  // Sign In inputs
  const [signInIdentifier, setSignInIdentifier] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [showSignInPassword, setShowSignInPassword] = useState(false);

  // Sign Up inputs
  const [fullName, setFullName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpUsername, setSignUpUsername] = useState("");
  const [organization, setOrganization] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpConfirmPassword, setSignUpConfirmPassword] = useState("");
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);

  // OTP inputs & state
  const [activeEmail, setActiveEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Status state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const otpInputRef = useRef<HTMLInputElement>(null);

  // Handle resend countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // Focus OTP input when stepping to OTP screen
  useEffect(() => {
    if (step === "otp") {
      setTimeout(() => {
        otpInputRef.current?.focus();
      }, 150);
    }
  }, [step]);

  // Reset form when changing mode
  const handleSwitchMode = (newMode: "signin" | "signup") => {
    setMode(newMode);
    setStep("form");
    setErrorMsg("");
    setSuccessMsg("");
    setOtpCode("");
    setDevOtp(null);
  };

  // 1. Submit Sign In Step 1 (Send OTP)
  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    const identifier = signInIdentifier.trim();
    const password = signInPassword.trim();

    if (!identifier || !password) {
      setErrorMsg("Please enter both username/email and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/login-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: identifier,
          username: identifier,
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Invalid username or password.");
      }

      setActiveEmail(data.email || identifier);
      setDevOtp(data.devOtp || null);
      setStep("otp");
      setResendCooldown(30);
      setSuccessMsg(
        `Verification code generated for ${data.email || identifier}`,
      );
    } catch (err: any) {
      setErrorMsg(err.message || "Sign in failed. Please check credentials.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 2. Submit Sign Up Step 1 (Send OTP with Details)
  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    const cleanFullName = fullName.trim();
    const cleanEmail = signUpEmail.trim().toLowerCase();
    const cleanUsername = signUpUsername.trim().toLowerCase();
    const cleanPassword = signUpPassword.trim();
    const cleanConfirm = signUpConfirmPassword.trim();

    if (!cleanFullName) {
      setErrorMsg("Please enter your full name.");
      return;
    }
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }
    if (!cleanUsername || cleanUsername.length < 3) {
      setErrorMsg("Username must be at least 3 characters.");
      return;
    }
    if (!cleanPassword || cleanPassword.length < 6) {
      setErrorMsg("Password must be at least 6 characters.");
      return;
    }
    if (cleanPassword !== cleanConfirm) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: cleanFullName,
          email: cleanEmail,
          username: cleanUsername,
          organization: organization.trim(),
          roleTitle: roleTitle.trim(),
          phone: phone.trim(),
          password: cleanPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Registration failed.");
      }

      setActiveEmail(cleanEmail);
      setDevOtp(data.devOtp || null);
      setStep("otp");
      setResendCooldown(30);
      setSuccessMsg(`Verification OTP code generated for ${cleanEmail}`);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to initialize registration.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 3. Verify OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    const code = otpCode.trim();
    if (!code || code.length < 6) {
      setErrorMsg("Please enter the complete 6-digit OTP code.");
      return;
    }

    setIsSubmitting(true);
    const endpoint =
      mode === "signup" ? "/api/auth/signup-verify" : "/api/auth/login-verify";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: activeEmail,
          otp: code,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.token) {
        throw new Error(data.error || "Invalid or expired OTP code.");
      }

      setSuccessMsg("Verification successful! Signing in...");
      onAuthenticate(data.token);
    } catch (err: any) {
      setErrorMsg(err.message || "OTP verification failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 4. Resend OTP
  const handleResendOtp = async () => {
    if (resendCooldown > 0 || !activeEmail) return;
    setErrorMsg("");
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: activeEmail,
          purpose: mode,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to resend verification code.");
      }

      setDevOtp(data.devOtp || null);
      setResendCooldown(30);
      setSuccessMsg("A new verification code has been generated.");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to resend code.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayedError = errorMsg || authError;

  return (
    <div className="min-h-[82vh] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Brand Header */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-25 h-25 mb-3.5">
            <img
              src="/assets/images/Infraxis.png"
              alt="Infraxis Logo"
              className="w-full h-full object-contain drop-shadow-xl"
            />
          </div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
            Infraxis Console
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Infrastructure for every release. A self-hosted engineering platform
            for mobile, web, and software delivery.
          </p>
        </div>

        {/* Auth Card */}
        <div className="glass-panel-elevated rounded-2xl p-6 sm:p-8 border border-slate-800 shadow-2xl relative overflow-hidden backdrop-blur-2xl">
          {/* Tabs */}
          {step === "form" && (
            <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-950/80 rounded-xl border border-slate-200 dark:border-slate-800/80 mb-6">
              <button
                type="button"
                onClick={() => handleSwitchMode("signin")}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === "signin"
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                Sign In
              </button>
              <button
                type="button"
                onClick={() => handleSwitchMode("signup")}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  mode === "signup"
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <User className="w-3.5 h-3.5" />
                Create Account
              </button>
            </div>
          )}

          {/* Alert / Feedback Messages */}
          {displayedError && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2.5 animate-fadeIn">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{displayedError}</div>
            </div>
          )}

          {successMsg && (
            <div className="mb-5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-start gap-2.5 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{successMsg}</div>
            </div>
          )}

          {/* ================= STEP 1: SIGN IN ================= */}
          {step === "form" && mode === "signin" && (
            <form onSubmit={handleSignInSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Email or Username
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={signInIdentifier}
                    onChange={(e) => setSignInIdentifier(e.target.value)}
                    placeholder="name@example.com or username"
                    autoComplete="username"
                    required
                    className="w-full pl-9 pr-4 py-2.5 bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all font-sans"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showSignInPassword ? "text" : "password"}
                    value={signInPassword}
                    onChange={(e) => setSignInPassword(e.target.value)}
                    placeholder="••••••••••••"
                    autoComplete="current-password"
                    required
                    className="w-full pl-9 pr-10 py-2.5 bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all font-sans"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSignInPassword(!showSignInPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300"
                  >
                    {showSignInPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || isConnecting}
                  className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-medium shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Authenticating & Generating OTP...
                    </>
                  ) : (
                    <>
                      <span>Continue & Send OTP</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>

              <div className="text-center pt-2">
                <p className="text-[11px] text-slate-400">
                  New to Infraxis?{" "}
                  <button
                    type="button"
                    onClick={() => handleSwitchMode("signup")}
                    className="text-blue-400 hover:text-blue-300 font-semibold transition-colors"
                  >
                    Create an account here
                  </button>
                </p>
              </div>
            </form>
          )}

          {/* ================= STEP 1: SIGN UP (DETAILS + CREDENTIALS) ================= */}
          {step === "form" && mode === "signup" && (
            <form onSubmit={handleSignUpSubmit} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Full Name*
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-500">
                      <User className="w-3.5 h-3.5" />
                    </div>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Jane Doe"
                      required
                      className="w-full pl-8 pr-3 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-sans"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Username*
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-500">
                      <User className="w-3.5 h-3.5" />
                    </div>
                    <input
                      type="text"
                      value={signUpUsername}
                      onChange={(e) => setSignUpUsername(e.target.value)}
                      placeholder="janedoe"
                      required
                      className="w-full pl-8 pr-3 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-sans"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Work / Personal Email*
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-500">
                    <Mail className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="email"
                    value={signUpEmail}
                    onChange={(e) => setSignUpEmail(e.target.value)}
                    placeholder="name@example.com"
                    required
                    className="w-full pl-8 pr-3 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-sans"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Role / Title
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-500">
                      <Briefcase className="w-3.5 h-3.5" />
                    </div>
                    <input
                      type="text"
                      value={roleTitle}
                      onChange={(e) => setRoleTitle(e.target.value)}
                      placeholder="React Native Lead"
                      className="w-full pl-8 pr-3 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-sans"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Organization / Team
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-500">
                      <Building className="w-3.5 h-3.5" />
                    </div>
                    <input
                      type="text"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      placeholder="Mobile Core Team"
                      className="w-full pl-8 pr-3 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-sans"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Phone Number (Optional)
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-500">
                    <Phone className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 12345 67890"
                    className="w-full pl-8 pr-3 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-sans"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Password*
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-500">
                      <Lock className="w-3.5 h-3.5" />
                    </div>
                    <input
                      type={showSignUpPassword ? "text" : "password"}
                      value={signUpPassword}
                      onChange={(e) => setSignUpPassword(e.target.value)}
                      placeholder="Min. 6 chars"
                      required
                      className="w-full pl-8 pr-9 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-sans"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignUpPassword(!showSignUpPassword)}
                      className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-500 hover:text-slate-300"
                    >
                      {showSignUpPassword ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Confirm Password*
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-500">
                      <Lock className="w-3.5 h-3.5" />
                    </div>
                    <input
                      type={showSignUpPassword ? "text" : "password"}
                      value={signUpConfirmPassword}
                      onChange={(e) => setSignUpConfirmPassword(e.target.value)}
                      placeholder="Repeat password"
                      required
                      className="w-full pl-8 pr-3 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-slate-100 text-xs placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-sans"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-medium shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating Account & Generating OTP...
                    </>
                  ) : (
                    <>
                      <span>Continue to OTP Verification</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>

              <div className="text-center pt-1">
                <p className="text-[11px] text-slate-400">
                  Already registered?{" "}
                  <button
                    type="button"
                    onClick={() => handleSwitchMode("signin")}
                    className="text-blue-400 hover:text-blue-300 font-semibold transition-colors"
                  >
                    Sign In
                  </button>
                </p>
              </div>
            </form>
          )}

          {/* ================= STEP 2: OTP VERIFICATION ================= */}
          {step === "otp" && (
            <div className="space-y-5 animate-fadeIn">
              <div className="text-center">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mx-auto mb-3">
                  <Shield className="w-6 h-6" />
                </div>
                <h2 className="text-base font-semibold text-slate-100">
                  Enter 6-Digit Verification Code
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  We have generated a verification OTP for{" "}
                  <span className="text-blue-400 font-mono font-medium">
                    {activeEmail}
                  </span>
                </p>
              </div>

              {/* Dev / Demo OTP helper badge */}
              {devOtp && (
                <div className="p-3 bg-linear-to-r from-blue-950/40 to-indigo-950/40 border border-blue-800/40 rounded-xl flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="text-xs text-slate-300">
                      Demo / Dev Code:{" "}
                      <code className="px-1.5 py-0.5 bg-blue-900/60 text-blue-300 font-mono font-bold rounded border border-blue-700/50">
                        {devOtp}
                      </code>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOtpCode(devOtp)}
                    className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold px-2 py-1 bg-blue-900/30 rounded border border-blue-800/50 transition-colors"
                  >
                    Auto Fill
                  </button>
                </div>
              )}

              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5 text-center">
                    6-Digit One Time Password (OTP)
                  </label>
                  <input
                    ref={otpInputRef}
                    type="text"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) =>
                      setOtpCode(
                        e.target.value.replace(/[^0-9]/g, "").slice(0, 6),
                      )
                    }
                    placeholder="123456"
                    required
                    className="w-full text-center tracking-[0.5em] text-2xl font-mono py-3 bg-slate-950/80 border border-slate-700 rounded-xl text-slate-100 placeholder:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={
                      isSubmitting || otpCode.length < 6 || isConnecting
                    }
                    className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    {isSubmitting || isConnecting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Verifying Code & Signing in...
                      </>
                    ) : (
                      <>
                        <span>Verify & Launch Dashboard</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>

                {/* Resend and back options */}
                <div className="flex items-center justify-between text-xs pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("form");
                      setErrorMsg("");
                    }}
                    className="flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to form</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={resendCooldown > 0 || isSubmitting}
                    className={`flex items-center gap-1 font-medium ${
                      resendCooldown > 0
                        ? "text-slate-400 dark:text-slate-500 cursor-not-allowed"
                        : "text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer"
                    }`}
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${
                        isSubmitting ? "animate-spin" : ""
                      }`}
                    />
                    <span>
                      {resendCooldown > 0
                        ? `Resend OTP (${resendCooldown}s)`
                        : "Resend OTP"}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Security Footer */}
        <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-slate-500">
          <Shield className="w-3.5 h-3.5 text-blue-400" />
          <span>Two-Factor Authentication · Infraxis Platform</span>
        </div>
      </div>
    </div>
  );
}
