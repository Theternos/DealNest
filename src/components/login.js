// src/pages/login.js
import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

/** ================================
 *  Minimal session helpers
 *  ================================ */
const STORAGE_KEY = "app.session";
const INACTIVITY_MS = 60 * 60 * 1000; // 1 hour

export function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(partial) {
  const prev = getSession() || {};
  const next = { ...prev, ...partial };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function isSessionValid(s) {
  if (!s || !s.loggedIn) return false;
  const now = Date.now();
  const last = Number(s.lastActivity || s.loginAt || 0);
  return now - last < INACTIVITY_MS;
}

export function touchActivity() {
  const s = getSession();
  if (s && s.loggedIn) saveSession({ lastActivity: Date.now() });
}

/** Install global inactivity tracker once (call it in App.jsx root) */
export function installInactivityTracker(onLogout) {
  if (window.__inactivityTrackerInstalled) return;
  window.__inactivityTrackerInstalled = true;

  const bump = () => touchActivity();
  ["click", "keydown", "mousemove", "scroll", "touchstart"].forEach((ev) =>
    window.addEventListener(ev, bump, { passive: true })
  );

  // periodic check
  window.__idleInterval = setInterval(() => {
    const s = getSession();
    if (!s || !s.loggedIn) return;
    if (!isSessionValid(s)) {
      clearSession();
      onLogout?.();
    }
  }, 60 * 1000); // check every minute
}

/** ================================
 *  Login Page
 *  ================================ */
export default function LoginPage() {
  const nav = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ username: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // If already logged in & valid → go to intended page or home
  useEffect(() => {
    const s = getSession();
    if (isSessionValid(s)) {
      const from = location.state?.from || "/";
      touchActivity();
      nav(from, { replace: true });
    } else if (location.state?.sessionExpired) {
      setErr("Your session has expired. Please log in again.");
    }
  }, [nav, location.state]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    if (!form.username || !form.password) {
      setErr("Enter username and password");
      return;
    }
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("users")
        .select("id,username,role,name,password")
        .eq("username", form.username)
        .eq("password", form.password)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setErr("Invalid credentials");
        setLoading(false);
        return;
      }

      const now = Date.now();
      const sessionData = {
        loggedIn: true,
        username: data.username,
        role: data.role || "sales",
        loginAt: now,
        lastActivity: now,
        name: data.name || data.username,
      };
      saveSession(sessionData);

      // Redirect to the intended page or home
      const from = location.state?.from || "/";
      nav(from, { replace: true });
    } catch (e2) {
      console.error(e2);
      setErr("Unable to sign in. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wrap" style={{ justifyContent: "center", alignItems: "center", paddingTop: "25vh", maxHeight:"100vh" }}>
      <div className="card" style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
        <div className="bar" style={{ marginBottom: 0 }}>
          <div className="title" style={{ marginBottom: 20 }}>Sign in</div>
        </div>

        {err ? (
          <div
            className="card"
            style={{
              background: "#FEF2F2",
              borderColor: "#FCA5A5",
              color: "#991B1B",
              padding: 10,
              margin: "10px 0",
            }}
          >
            {err}
          </div>
        ) : null}

        <form className="form" onSubmit={handleSubmit}>
          <label className="lbl">
            <span className="lbl-text">Username</span>
            <input
              className="input"
              autoComplete="username"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="Enter username"
              disabled={loading}
            />
          </label>

          <label className="lbl">
            <span className="lbl-text">Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Enter password"
              disabled={loading}
            />
          </label>

          <div className="actions" style={{ justifyContent: "space-between" }}>
            <button
              type="submit"
              className="btn primary"
              disabled={loading}
              style={{ width: "100%" }}
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </div>
        </form>

        <div className="muted" style={{ fontSize: 12, marginTop: 10, textAlign: "center"}}>
          Session auto-logs out after 1 hour of inactivity.
        </div>
      </div>
    </div>
  );
}
