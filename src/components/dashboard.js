// dashboard.js
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../styles/clients.css";
import NavFrame from "./nav";
import { supabase } from "../lib/supabaseClient";

// Import both sections
import PackagesDashboard from "./packagesDashboard";
import GroceriesDashboard from "./groceriesDashboard";

/** ================================
 *  Minimal session helpers (read-only)
 *  ================================ */
const SESSION_KEY = "app.session";
function getSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}
function sessionPopupKey() {
    const s = getSession();
    if (!s || !s.loggedIn) return "negOrderPopupDismissed@anon";
    // make it unique per login session so logout/login shows again
    return `negOrderPopupDismissed@${s.username || "user"}@${s.loginAt || "0"}`;
}

/**
 * Unified Dashboard wrapper that lets you switch between:
 *  - 📦 Packages (default)
 *  - 🛒 Groceries
 *
 * It also shows a one-time-per-session popup listing all products
 * whose qty_available is negative in the order_inventory table.
 * If a row has a client_id, we map and display the client name.
 */
export default function Dashboard() {
    const location = useLocation();
    const navigate = useNavigate();

    // Resolve initial view from query -> localStorage -> default
    const initialFromQuery = useMemo(() => {
        const p = new URLSearchParams(location.search).get("view");
        if (p === "packages" || p === "groceries") return p;
        return null;
    }, [location.search]);

    const [view, setView] = useState(
        initialFromQuery || localStorage.getItem("dashboard.view") || "packages"
    );

    // Negative order inventory popup state
    const [negRows, setNegRows] = useState([]); // {id, product_id, client_id, qty_available, product_name, client_name}
    const [popupOpen, setPopupOpen] = useState(false);
    const [loadingPopup, setLoadingPopup] = useState(false);

    // Keep URL in sync when view changes
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        if (params.get("view") !== view) {
            params.set("view", view);
            navigate({ search: params.toString() }, { replace: true });
        }
        localStorage.setItem("dashboard.view", view);
    }, [view, location.search, navigate]);

    // Load negative order_inventory once per session (and only open if any)
    useEffect(() => {
        let mounted = true;
        const dismissedKey = sessionPopupKey();
        const alreadyDismissed = localStorage.getItem(dismissedKey) === "1";
        if (alreadyDismissed) return;

        (async () => {
            setLoadingPopup(true);
            try {
                // Fetch all negative rows from order_inventory
                const [{ data: oi, error: eOI }, { data: products }, { data: clients }] =
                    await Promise.all([
                        supabase
                            .from("order_inventory")
                            .select("id, product_id, client_id, qty_available")
                            .lt("qty_available", 0)
                            .order("qty_available", { ascending: true }), // most negative first
                        supabase.from("products").select("id,name").order("name"),
                        supabase.from("clients").select("id,name").order("name"),
                    ]);

                if (eOI) {
                    console.error("order_inventory load error:", eOI);
                    if (mounted) {
                        setNegRows([]);
                        setPopupOpen(false);
                    }
                    return;
                }

                const pMap = Object.fromEntries((products || []).map((p) => [p.id, p.name]));
                const cMap = Object.fromEntries((clients || []).map((c) => [c.id, c.name]));

                const rows = (oi || []).map((r) => ({
                    ...r,
                    product_name: pMap[r.product_id] || "(Unknown product)",
                    client_name:
                        r.client_id == null ? "-" : cMap[r.client_id] || "(Unknown client)",
                }));

                if (mounted) {
                    setNegRows(rows);
                    setPopupOpen(rows.length > 0);
                }
            } catch (err) {
                console.error("Failed loading negative order_inventory:", err);
                if (mounted) {
                    setNegRows([]);
                    setPopupOpen(false);
                }
            } finally {
                if (mounted) setLoadingPopup(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, []);

    function closePopupForSession() {
        const key = sessionPopupKey();
        localStorage.setItem(key, "1");
        setPopupOpen(false);
    }

    return (
        <NavFrame>
            <div className="wrap" style={{ paddingTop: 12 }}>
                <div
                    className="card"
                    style={{ padding: 8, marginBottom: 12, maxWidth: "1065px", margin: "auto" }}
                >
                    <TabSwitcher view={view} onChange={setView} />
                </div>

                {/* Only render the active dashboard to prevent double fetching */}
                {view === "packages" ? <PackagesDashboard /> : null}
                {view === "groceries" ? <GroceriesDashboard /> : null}

                {/* One-time per session popup for negative order_inventory */}
                {popupOpen && (
                    <div className="modal">
                        <div className="modal-card modal-card--xl" style={{ width: "80vw" }}>
                            <div className="modal-head">
                                <h2 className="modal-title">⚠️ Negative Order Inventory</h2>
                                <button
                                    className="btn icon"
                                    onClick={closePopupForSession}
                                    aria-label="Close"
                                    title="Close"
                                >
                                    ×
                                </button>
                            </div>

                            <div className="card" style={{ padding: 12 }}>
                                {loadingPopup ? (
                                    <div className="muted center" style={{ padding: 16 }}>
                                        Loading…
                                    </div>
                                ) : negRows.length === 0 ? (
                                    <div className="muted center" style={{ padding: 16 }}>
                                        No negative quantities found.
                                    </div>
                                ) : (
                                    <div className="table-wrap">
                                        <table className="tbl">
                                            <thead>
                                                <tr>
                                                    <th>Product</th>
                                                    <th>Client</th>
                                                    <th className="right">Qty (negative)</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {negRows.map((r) => (
                                                    <tr key={r.id}>
                                                        <td data-th="Product">{r.product_name}</td>
                                                        <td data-th="Client">{r.client_name}</td>
                                                        <td className="right" data-th="Qty">
                                                            {Number(r.qty_available).toLocaleString("en-IN", {
                                                                maximumFractionDigits: 3,
                                                            })}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            <div className="modal-actions between" style={{ marginTop: 8 }}>
                                <button className="btn modal-btn" onClick={() => setPopupOpen(false)}>
                                    Close (show again later)
                                </button>
                                <button className="btn primary modal-btn margin-bottom" onClick={closePopupForSession}>
                                    Got it — don't show again
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Scoped styles for the tabs */}
                <style>{`
          .tabs {
            display: inline-flex;
            gap: 6px;
            padding: 4px;
            border: 1px solid var(--border);
            border-radius: 10px;
            background: #fff;
          }
          .tab-btn {
            appearance: none;
            border: 1px solid transparent;
            background: transparent;
            padding: 8px 12px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            color: var(--muted);
          }
          .tab-btn[aria-selected="true"] {
            background: var(--card);
            color: var(--text);
            border-color: var(--border);
            box-shadow: 0 1px 0 rgba(0,0,0,0.02);
          }
          .tab-spacer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 6px;
          }
          .tab-title {
            font-weight: 700;
            color: var(--text);
          }
        `}</style>
            </div>
        </NavFrame>
    );
}

function TabSwitcher({ view, onChange }) {
    const title =
        view === "packages"
            ? "📦 Packages — Business Intelligence"
            : "🛒 Groceries — Business Intelligence";

    return (
        <div className="tab-spacer">
            <div className="tab-title">{title}</div>
            <div className="tabs" role="tablist" aria-label="Select dashboard section">
                <button
                    type="button"
                    className="tab-btn"
                    role="tab"
                    aria-selected={view === "packages"}
                    onClick={() => onChange("packages")}
                    title="Packages dashboard"
                >
                    📦 Packages
                </button>
                <button
                    type="button"
                    className="tab-btn"
                    role="tab"
                    aria-selected={view === "groceries"}
                    onClick={() => onChange("groceries")}
                    title="Groceries dashboard"
                >
                    🛒 Groceries
                </button>
            </div>
        </div>
    );
}
