// nav.js
import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { clearSession, getSession } from "./login";
import "../App.js";
import "../App.css";

/** ---------- Inline SVG Icons ---------- **/
const Ico = {
  Dashboard: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <path d="M4 10h16l-2 9H6l-2-9Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 10l2-5h6l2 5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="18" r="1" fill="currentColor" />
      <circle cx="15" cy="18" r="1" fill="currentColor" />
    </svg>
  ),
  Products: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <path d="M12 3 3 7l9 4 9-4-9-4Zm9 7-9 4-9-4v7l9 4 9-4v-7Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  Purchases: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <path d="M7 7V5a5 5 0 1 1 10 0v2M4 7h16l-1 12H5L4 7Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  Inventory: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <path d="M4 4h16v6H4V4Zm0 10h16v6H4v-6Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  Orders: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      {/* Shopping bag / purchase order symbol */}
      <path
        d="M6 7h12l1 12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2l1-12Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9 7a3 3 0 0 1 6 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="9" cy="11" r="0.8" fill="currentColor" />
      <circle cx="15" cy="11" r="0.8" fill="currentColor" />
    </svg>
  ),

  Sales: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <path d="M4 14l4-4 4 4 6-6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M14 8h6v6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  Ledger: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  Parties: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <circle cx="7" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 18c0-2.21 3.134-4 7-4s7 1.79 7 4M14 18c0-1.657 2.015-3 4.5-3S23 16.343 23 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  Investments: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <path d="M4 20V10l5 4 6-6 5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

/** ---------- Small helper for side links ---------- **/
function SideLink({ to, icon: Icon, children, onClick }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `side-link ${isActive ? "active" : ""}`}
      onClick={onClick}
    >
      <span className="ico" aria-hidden="true">
        <Icon />
      </span>
      <span>{children}</span>
    </NavLink>
  );
}

/** ---------- Layout Wrapper to use INSIDE each page ---------- **/
export default function NavFrame({ children }) {
  const [open, setOpen] = React.useState(false);
  const loc = useLocation();

  // Close mobile drawer on route change
  React.useEffect(() => setOpen(false), [loc.pathname]);

  // ESC closes mobile drawer
  React.useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Optional: header shadow on scroll
  React.useEffect(() => {
    const header = document.querySelector(".app-header");
    if (!header) return;
    const onScroll = () => {
      if (window.scrollY > 4) header.classList.add("has-shadow");
      else header.classList.remove("has-shadow");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      {/* Top Bar */}
      <header className="app-header" role="banner">
        <div className="container">
          <div className="brand">B2B TRADERS</div>
          <nav className="nav" aria-label="Top navigation" />
          <button
            type="button"
            className={`nav-toggle ${open ? "is-open" : ""}`}
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="mobile-primary-nav"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="bars" aria-hidden="true"></span>
          </button>
        </div>
      </header>

      {/* Mobile Drawer */}
      <div
        className={`nav-backdrop ${open ? "is-open" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden={!open}
      />
      <aside className={`nav-drawer ${open ? "is-open" : ""}`} aria-hidden={!open}>
        <div className="nav-drawer-head">
          <div className="brand">B2B TRADERS</div>
          <button
            type="button"
            className="nav-toggle is-open"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
          >
            <span className="bars" aria-hidden="true"></span>
          </button>
        </div>

        <nav id="mobile-primary-nav" className="nav" aria-label="Primary mobile">
          {(!getSession()?.role || getSession()?.role !== 'sales') && (
            <NavLink to="/dashboard" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Dashboard</NavLink>
          )}
          <NavLink to="/sales" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Sales</NavLink>
          <NavLink to="/orders" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Orders</NavLink>
          {(!getSession()?.role || getSession()?.role !== 'sales') && (
            <NavLink to="/purchases" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Purchases</NavLink>
          )}
          <NavLink to="/products" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Products</NavLink>
          <NavLink to="/inventory" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Inventory</NavLink>
          {(!getSession()?.role || getSession()?.role !== 'sales') && (
            <NavLink to="/parties" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Parties</NavLink>
          )}
          <NavLink to="/ledger" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Ledger</NavLink>
          {(!getSession()?.role || getSession()?.role !== 'sales') && (
            <NavLink to="/investments" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Investments</NavLink>
          )}

          <div className="mt-auto">
            <button
              onClick={() => {
                clearSession();
                window.location.href = "/login";
              }}
              className="logout-btn"
            >
              Logout
            </button>
          </div>
        </nav>
      </aside>

      {/* Desktop Side + Main Content */}
      <div className="side-shell">
        <aside className="side-nav" aria-label="Primary sidebar">
          <div className="side-head" />
          <div className="side-list">
            {(!getSession()?.role || getSession()?.role !== 'sales') && (
              <SideLink to="/dashboard" icon={Ico.Dashboard}>Dashboard</SideLink>
            )}
            <SideLink to="/sales" icon={Ico.Sales}>Sales</SideLink>
            <SideLink to="/orders" icon={Ico.Orders}>Orders</SideLink>
            {(!getSession()?.role || getSession()?.role !== 'sales') && (
              <SideLink to="/purchases" icon={Ico.Purchases}>Purchases</SideLink>
            )}
            <SideLink to="/products" icon={Ico.Products}>Products</SideLink>
            <SideLink to="/inventory" icon={Ico.Inventory}>Inventory</SideLink>
            {(!getSession()?.role || getSession()?.role !== 'sales') && (
              <SideLink to="/parties" icon={Ico.Parties}>Parties</SideLink>
            )}
            <SideLink to="/ledger" icon={Ico.Ledger}>Ledger</SideLink>
            {(!getSession()?.role || getSession()?.role !== 'sales') && (
              <SideLink to="/investments" icon={Ico.Investments}>Investments</SideLink>
            )}

            <div className="mt-auto">
              <button
                onClick={() => {
                  clearSession();
                  window.location.href = "/login";
                }}
                className="logout-btn"
              >
                Logout
              </button>
            </div>
          </div>
        </aside>

        <main className="app-main">
          <div className="container">{children}</div>
        </main>
      </div>
    </>
  );
}
