"use client";

import { useEffect, useMemo, useState } from "react";

type User = {
  userId: string;
  githubId: string;
  email: string;
  name: string;
  avatarUrl: string;
  createdAt: string;
};

type GitHubRepo = {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  private: boolean;
  defaultBranch: string;
  owner: { login: string };
};

type ApiKeyRecord = {
  keyId: string;
  projectId: string;
  projectName: string;
  repoFullName?: string;
  preview: string;
  active: boolean;
  createdAt: string;
  lastUsedAt?: string;
};

type CreatedApiKey = {
  keyId: string;
  projectId: string;
  apiKey: string;
  createdAt: string;
};

const API_BASE = process.env.NEXT_PUBLIC_DESHLO_ANNOTATIONS_API_BASE_URL || "http://localhost:8080";
const OAUTH_START_URL = `${API_BASE}/v1/auth/github/start`;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}

async function apiFetch<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers || {}),
    },
  });

  const body = (await response.json().catch(() => ({}))) as any;

  if (response.status === 401) {
    throw new Error("AUTH_REQUIRED");
  }

  if (!response.ok || body?.ok === false) {
    throw new Error(body?.message || `Request failed (${response.status})`);
  }

  return body as T;
}

export default function Page() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepoFullName, setSelectedRepoFullName] = useState("");
  const [lastCreatedKey, setLastCreatedKey] = useState<CreatedApiKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const authToken = url.searchParams.get("auth_token");
    const authError = url.searchParams.get("auth_error");

    if (authToken) {
      sessionStorage.setItem("deshlo-auth-token", authToken);
      setToken(authToken);
      url.searchParams.delete("auth_token");
      window.history.replaceState({}, "", url.toString());
    } else {
      const persisted = sessionStorage.getItem("deshlo-auth-token") || "";
      if (persisted) {
        setToken(persisted);
      }
    }

    if (authError) {
      setError(`Sign-in failed: ${authError}`);
      url.searchParams.delete("auth_error");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setKeys([]);
      setRepos([]);
      setSelectedRepoFullName("");
      return;
    }

    void refreshAll(token);
  }, [token]);

  const isSignedIn = Boolean(user);

  async function refreshAll(activeToken: string): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const me = await apiFetch<{ user: User }>("/v1/me", activeToken);
      setUser(me.user);

      const reposResult = await apiFetch<{ repos: GitHubRepo[] }>("/v1/github/repos", activeToken);
      const nextRepos = reposResult.repos || [];
      setRepos(nextRepos);
      setSelectedRepoFullName((current) => {
        if (current && nextRepos.some((repo) => repo.fullName === current)) {
          return current;
        }
        return nextRepos[0]?.fullName || "";
      });

      const keysResult = await apiFetch<{ keys: ApiKeyRecord[] }>("/v1/keys", activeToken);
      setKeys(keysResult.keys || []);
    } catch (nextError) {
      const message = toErrorMessage(nextError);
      if (message === "AUTH_REQUIRED") {
        await handleLogout();
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function handleLogin(): void {
    window.location.href = OAUTH_START_URL;
  }

  async function handleLogout(): Promise<void> {
    const activeToken = token;
    sessionStorage.removeItem("deshlo-auth-token");
    setToken("");
    setUser(null);
    setKeys([]);
    setLastCreatedKey(null);

    if (activeToken) {
      try {
        await apiFetch<{ ok: boolean }>("/v1/auth/logout", activeToken, { method: "POST" });
      } catch {
        // ignore logout call errors
      }
    }
  }

  async function copyApiKey(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore copy failures
    }
  }

  async function handleCreateApiKey(): Promise<void> {
    const repoFullName = selectedRepoFullName.trim();
    if (!token) {
      setError("Please sign in first.");
      return;
    }
    if (!repoFullName) {
      setError("Please select a GitHub repository.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await apiFetch<{ key: CreatedApiKey }>("/v1/keys", token, {
        method: "POST",
        body: JSON.stringify({ repoFullName }),
      });
      setLastCreatedKey(result.key);
      await refreshAll(token);
    } catch (nextError) {
      setError(toErrorMessage(nextError));
      setLoading(false);
    }
  }

  async function handleDeleteApiKey(keyId: string): Promise<void> {
    if (!token) {
      setError("Please sign in first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await apiFetch<{ ok: boolean }>(`/v1/keys/${keyId}`, token, {
        method: "DELETE",
      });
      await refreshAll(token);
    } catch (nextError) {
      setError(toErrorMessage(nextError));
      setLoading(false);
    }
  }

  const heroSubtitle = useMemo(
    () => "1) Select repository  2) Generate key  3) Add key to your app env",
    []
  );

  return (
    <main className="dashboard">
      <header className="hero card reveal">
        <div>
          <div className="eyebrow">Client Portal</div>
          <h1 className="heroTitle">Deshlo Dashboard</h1>
          <p className="muted">{heroSubtitle}</p>
        </div>
        <div className="apiPill">
          <span>API</span>
          <code>{API_BASE}</code>
        </div>
      </header>

      {!isSignedIn ? (
        <section className="card reveal">
          <h2>Sign In</h2>
          <p className="muted">Sign in with GitHub to generate repository-linked API keys.</p>
          <div className="actions">
            <button className="btn btnPrimary" onClick={handleLogin}>
              Sign in with GitHub
            </button>
          </div>
        </section>
      ) : (
        <section className="card reveal">
          <div className="accountRow">
            <div className="accountIdentity">
              {user?.avatarUrl ? <img src={user.avatarUrl} alt="avatar" className="avatar" /> : null}
              <div>
                <h2>{user?.name || user?.email || user?.githubId}</h2>
                <p className="muted">{user?.email || "No public email"}</p>
              </div>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => void refreshAll(token)} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh"}
              </button>
              <button className="btn btnDanger" onClick={() => void handleLogout()}>
                Logout
              </button>
            </div>
          </div>
        </section>
      )}

      {lastCreatedKey ? (
        <section className="notice noticeSuccess reveal">
          <div>
            <strong>New API key generated</strong>
            <p className="muted">Copy this now. It will not be shown again.</p>
            <code className="blockCode">{lastCreatedKey.apiKey}</code>
          </div>
          <button className="btn" onClick={() => void copyApiKey(lastCreatedKey.apiKey)}>
            Copy key
          </button>
        </section>
      ) : null}

      {error ? (
        <section className="notice noticeError reveal">
          <strong>Error</strong>
          <p>{error}</p>
        </section>
      ) : null}

      {isSignedIn ? (
        <>
          <section className="card reveal">
            <h2>Create API Key</h2>
            <p className="muted">Each API key is assigned to one GitHub repository.</p>
            <div className="inputRow">
              <select
                value={selectedRepoFullName}
                onChange={(event) => setSelectedRepoFullName(event.target.value)}
                disabled={loading}
              >
                <option value="">Select repository</option>
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.fullName}>
                    {repo.fullName}
                    {repo.private ? " (private)" : ""}
                  </option>
                ))}
              </select>
              <button className="btn btnPrimary" onClick={() => void handleCreateApiKey()} disabled={loading}>
                Generate key
              </button>
            </div>
            {repos.length === 0 ? (
              <p className="muted">No repos returned. Confirm GitHub OAuth repo permissions and try refresh.</p>
            ) : null}
          </section>

          <section className="projectsSection reveal">
            {keys.length === 0 ? (
              <div className="card muted">No API keys yet. Generate your first key above.</div>
            ) : (
              <article className="card">
                <h3>Your API Keys</h3>
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Key ID</th>
                        <th>Repository</th>
                        <th>Preview</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Last Used</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {keys.map((key) => (
                        <tr key={key.keyId}>
                          <td>
                            <code>{key.keyId}</code>
                          </td>
                          <td>{key.repoFullName || key.projectName || key.projectId}</td>
                          <td>
                            <code>{key.preview}</code>
                          </td>
                          <td>
                            <span className={key.active ? "status active" : "status revoked"}>
                              {key.active ? "active" : "revoked"}
                            </span>
                          </td>
                          <td>{new Date(key.createdAt).toLocaleString()}</td>
                          <td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "-"}</td>
                          <td>
                            <button
                              className="btn btnDanger"
                              onClick={() => void handleDeleteApiKey(key.keyId)}
                              disabled={loading}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
