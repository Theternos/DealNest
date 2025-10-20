// App.js
import React from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  useLocation,
} from "react-router-dom";

// pages
import Clients from "./components/clients";
import Vendors from "./components/vendors";
import Products from "./components/products";
import Purchases from "./components/purchases";
import Inventory from "./components/inventory";
import Sales from "./components/sales";
import Ledger from "./components/ledger";
import Parties from "./components/parties";
import PackagesDashboard from "./components/packagesDashboard"; 
import Investments from "./components/investments";
import GroceriesDashboard from "./components/groceriesDashboard";

import "./App.css";

/** ---------- Inline SVG Icons (no extra files) ---------- **/
const Ico = {
  GroceriesDashboard: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <path d="M3 10h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10Zm0-4h18V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v0Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 6V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  PackagesDashboard: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <path d="M3 10h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10Zm0-4h18V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v0Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 6V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  Clients: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.418 0-8 1.791-8 4v1h16v-1c0-2.209-3.582-4-8-4Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  Vendors: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <path d="M3 7h18l-2 12H5L3 7Zm4-4h10l1 4H6l1-4Z" stroke="currentColor" strokeWidth="1.5" />
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
      <path d="M17 20h5v-2a3 3 0 0 0-3-3h-2v5ZM13 15h-2v5h2v-5ZM9 20H4v-2a3 3 0 0 1 3-3h2v5ZM12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  Investments: (p) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
      <path d="M12 2v20M5 12h14M5 5l14 5-14 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

/** ---------- SideNav Link helper ---------- **/
function SideLink({ to, icon: Icon, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `side-link ${isActive ? "active" : ""}`}
    >
      <span className="ico" aria-hidden="true">
        <Icon />
      </span>
      <span>{children}</span>
    </NavLink>
  );
}

/** ---------- Internal Layout Component ---------- **/
function AppLayout() {
  const [open, setOpen] = React.useState(false);
  const loc = useLocation();

  // Close drawer on route change
  React.useEffect(() => { setOpen(false); }, [loc.pathname]);

  // ESC to close
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
    <div className="app-wrap">
      {/* Header */}
      <header className="app-header" role="banner">
        <div className="container">
          <div className="brand">B2B TRADERS</div>

          {/* Desktop inline nav hidden (we will use side nav) */}
          <nav className="nav" aria-label="Primary" />

          {/* Mobile hamburger */}
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

      {/* Mobile drawer + backdrop (unchanged) */}
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
          <NavLink to="/groceriesDashboard" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Groceries Dashboard</NavLink>
          <NavLink to="/packagesDashboard" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Packages Dashboard</NavLink>
          <NavLink to="/clients" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Clients</NavLink>
          <NavLink to="/vendors" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Vendors</NavLink>
          <NavLink to="/products" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Products</NavLink>
          <NavLink to="/purchases" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Purchases</NavLink>
          <NavLink to="/inventory" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Inventory</NavLink>
          <NavLink to="/sales" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Sales</NavLink>
          <NavLink to="/ledger" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Ledger</NavLink>
          <NavLink to="/parties" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Parties</NavLink>
          <NavLink to="/investments" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} onClick={() => setOpen(false)}>Investments</NavLink>
        </nav>
      </aside>

      {/* Desktop side shell: sticky side nav + main */}
      <div className="side-shell">
        {/* Side Nav (visible on ≥768px by CSS) */}
        <aside className="side-nav" aria-label="Primary">
          <div className="side-head" />
          <div className="side-list">
            <SideLink to="/groceriesDashboard" icon={Ico.GroceriesDashboard}>G-Dashboard</SideLink>
            <SideLink to="/packagesDashboard" icon={Ico.PackagesDashboard}>P-Dashboard</SideLink>
            <SideLink to="/clients" icon={Ico.Clients}>Clients</SideLink>
            <SideLink to="/vendors" icon={Ico.Vendors}>Vendors</SideLink>
            <SideLink to="/products" icon={Ico.Products}>Products</SideLink>
            <SideLink to="/inventory" icon={Ico.Inventory}>Inventory</SideLink>
            <SideLink to="/purchases" icon={Ico.Purchases}>Purchases</SideLink>
            <SideLink to="/sales" icon={Ico.Sales}>Sales</SideLink>
            <SideLink to="/ledger" icon={Ico.Ledger}>Ledger</SideLink>
            <SideLink to="/parties" icon={Ico.Parties}>Parties</SideLink>
            <SideLink to="/investments" icon={Ico.Investments}>Investments</SideLink>
          </div>
        </aside>

        {/* Main */}
        <main className="app-main">
          <div className="container">
            <Routes>
              <Route path="/" element={<Navigate to="/groceriesDashboard" replace />} />
              <Route path="/groceriesDashboard" element={<GroceriesDashboard />} />
              <Route path="/packagesDashboard" element={<PackagesDashboard />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/vendors" element={<Vendors />} />
              <Route path="/products" element={<Products />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/purchases" element={<Purchases />} />
              <Route path="/sales" element={<Sales />} />
              <Route path="/ledger" element={<Ledger />} />
              <Route path="/parties" element={<Parties />} />
              <Route path="/investments" element={<Investments />} />
              <Route path="*" element={<div style={{ padding: 24 }}>Not Found</div>} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

/** ---------- Outer App (Router wrapper) ---------- **/
export default function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}
