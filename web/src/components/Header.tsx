"use client";

import React, { useState } from "react";
import {
  Eye,
  EyeOff,
  Shield,
  Cpu,
  RefreshCw,
  LogOut,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { WorkerInfo } from "../types/ci";
import ThemeToggle from "./ThemeToggle";

interface HeaderProps {
  token: string;
  onTokenChange: (token: string) => void;
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  workers: WorkerInfo[];
  authError?: string;
  user?: {
    fullName?: string;
    username?: string;
    email?: string;
    organization?: string;
    roleTitle?: string;
    role?: string;
  } | null;
}

export default function Header({
  token,
  onTokenChange,
  isConnected,
  isConnecting,
  onConnect,
  onDisconnect,
  workers,
  authError,
  user,
}: HeaderProps) {
  const [showToken, setShowToken] = useState(false);

  const activeWorker = workers.find((w) => w.online);

  return (
    <header className="border-b border-slate-200 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl sticky top-0 z-40 transition-all shadow-xs dark:shadow-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          {/* Brand Identity */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center">
              <img
                src="/assets/images/Infraxis.png"
                alt="Infraxis Logo"
                className="w-full h-full object-contain drop-shadow-md"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                  Infraxis Console
                </h1>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  Infraxis Core
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Infrastructure for every release.
              </p>
            </div>
          </div>

          {/* Right Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            {isConnected && (
              <div className="flex flex-wrap items-center gap-2.5 animate-fadeIn">
                {/* CI Connection Pill */}
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 dark:text-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
                  <span>Connected</span>
                </div>

                {/* Worker Status Pill */}
                {activeWorker && (
                  <div
                    className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 dark:text-indigo-300"
                    title={`Infraxis Agent: ${activeWorker.id} · Labels: ${activeWorker.labels.join(", ")}`}
                  >
                    <Cpu className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                    <span className="font-mono text-[11px] truncate max-w-35">
                      {activeWorker.id}
                    </span>
                    <span className="text-[10px] bg-indigo-500/20 px-1.5 py-0.5 rounded text-indigo-600 dark:text-indigo-200">
                      {activeWorker.labels.join(", ")}
                    </span>
                  </div>
                )}

                {/* User Profile Chip */}
                {user && (
                  <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-lg">
                    <div className="w-6 h-6 rounded-full bg-blue-600/20 dark:bg-blue-600/30 border border-blue-500/40 text-blue-600 dark:text-blue-300 font-semibold text-[11px] flex items-center justify-center">
                      {(user.fullName || user.username || "U")[0].toUpperCase()}
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-tight">
                        {user.fullName || user.username}
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                        {user.roleTitle ||
                          user.organization ||
                          user.role ||
                          "Admin"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Log Out Button */}
                <button
                  type="button"
                  onClick={onDisconnect}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/30 rounded-lg transition-all cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Log Out
                </button>
              </div>
            )}

            {/* Theme Toggle Button */}
            <ThemeToggle />
          </div>
        </div>

        {isConnected && authError && (
          <div className="mt-2.5 flex items-center gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/50 px-3 py-1.5 rounded-md">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{authError}</span>
          </div>
        )}
      </div>
    </header>
  );
}
