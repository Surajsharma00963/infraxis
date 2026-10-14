export function getStoredToken(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem("ci_token") || "";
}

export function setStoredToken(token: string) {
  if (typeof window === "undefined") return;
  if (token) {
    sessionStorage.setItem("ci_token", token);
  } else {
    sessionStorage.removeItem("ci_token");
  }
}

export function getWebSocketUrl(token?: string): string {
  if (typeof window === "undefined") return "";
  const currentToken = token || getStoredToken();
  const isHttps = window.location.protocol === "https:";
  const wsProtocol = isHttps ? "wss:" : "ws:";
  const host =
    window.location.port === "3000"
      ? `${window.location.hostname}:8787`
      : window.location.host;
  const base = `${wsProtocol}//${host}/ws`;
  return currentToken
    ? `${base}?token=${encodeURIComponent(currentToken)}`
    : base;
}

export async function apiFetch<T = any>(
  endpoint: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const currentToken = token || getStoredToken();
  const headers = new Headers(options.headers || {});

  if (currentToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${currentToken}`);
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errMsg = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data?.error) errMsg = data.error;
    } catch {}
    throw new Error(errMsg);
  }

  return res.json();
}

export async function downloadArtifactFile(
  id: string,
  filename: string,
  token?: string,
) {
  const currentToken = token || getStoredToken();

  const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}`, {
    headers: {
      Authorization: `Bearer ${currentToken}`,
    },
  });

  if (!res.ok) throw new Error("Failed to download artifact");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "build-artifact";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function deleteArtifactFile(id: string, token?: string) {
  return apiFetch<{ ok: boolean; id: string }>(
    `/api/artifacts/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    token,
  );
}

export async function clearAllArtifacts(token?: string) {
  return apiFetch<{ ok: boolean; count: number }>(
    "/api/artifacts",
    { method: "DELETE" },
    token,
  );
}

export function timeAgo(isoDate: string): string {
  if (!isoDate) return "just now";
  const diffSec = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export function isLocalUrl(url?: string): boolean {
  if (!url) return false;
  return (
    url.startsWith("/") ||
    url.startsWith("file://") ||
    url.startsWith("./") ||
    url.startsWith("../") ||
    url.startsWith("~")
  );
}
