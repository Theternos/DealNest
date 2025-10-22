// parties.js
import React, { useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import "../styles/clients.css";
import NavFrame from "./nav";
import { getSession } from "./login";

/** =============================================================================
 *  Utilities
 * =============================================================================*/
const IST_TZ = "Asia/Kolkata";
const LIST_PAGE_SIZE = 10;
const DETAIL_PAGE_SIZE = 5;
const TAX_MAP = { "Tax Exemption": 0, "5%": 0.05, "12%": 0.12, "18%": 0.18 };
const safeNum = (n) => (isFinite(Number(n)) ? Number(n) : 0);
const fmtINR = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n || 0);

const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}
function istInputToUTCDate(inputValue) {
  if (!inputValue) return null;
  const [d, t] = inputValue.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, day, hh, mm));
}
function getRange(preset) {
  if (preset === "ALL") return [null, null];
  const now = new Date();
  const todayIST = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: IST_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now)
  );
  const startOfToday = new Date(`${todayIST.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const endOfToday = new Date(`${todayIST.toISOString().slice(0, 10)}T23:59:59.999Z`);
  const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
  const day = startOfToday.getUTCDay();
  const startOfWeek = addDays(startOfToday, -((day + 6) % 7));
  const endOfWeek = addDays(startOfWeek, 6);
  const lastWeekStart = addDays(startOfWeek, -7);
  const lastWeekEnd = addDays(startOfWeek, -1);
  const y = startOfToday.getUTCFullYear();
  const m = startOfToday.getUTCMonth();
  const startOfMonth = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  const endOfMonth = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
  const startOfLastMonth = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const endOfLastMonth = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  const startOfYear = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0));
  const endOfYear = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
  const startOfLastYear = new Date(Date.UTC(y - 1, 0, 1, 0, 0, 0, 0));
  const endOfLastYear = new Date(Date.UTC(y - 1, 11, 31, 23, 59, 59, 999));
  switch (preset) {
    case "TODAY":
      return [startOfToday.toISOString(), endOfToday.toISOString()];
    case "YESTERDAY":
      return [addDays(startOfToday, -1).toISOString(), addDays(endOfToday, -1).toISOString()];
    case "THIS_WEEK":
      return [startOfWeek.toISOString(), endOfWeek.toISOString()];
    case "LAST_WEEK":
      return [lastWeekStart.toISOString(), lastWeekEnd.toISOString()];
    case "THIS_MONTH":
      return [startOfMonth.toISOString(), endOfMonth.toISOString()];
    case "LAST_MONTH":
      return [startOfLastMonth.toISOString(), endOfLastMonth.toISOString()];
    case "LAST_30":
      return [addDays(endOfToday, -29).toISOString(), endOfToday.toISOString()];
    case "THIS_YEAR":
      return [startOfYear.toISOString(), endOfYear.toISOString()];
    case "LAST_YEAR":
      return [startOfLastYear.toISOString(), endOfLastYear.toISOString()];
    default:
      return [null, null];
  }
}
function calcSaleTotals(sale, items = [], payments = []) {
  const subtotal = items.reduce((s, it) => s + safeNum(it.quantity) * safeNum(it.unit_price), 0);
  const tax =
    sale?.with_tax || sale?.invoice_with_gst
      ? items.reduce(
        (s, it) => s + safeNum(it.quantity) * safeNum(it.unit_price) * (TAX_MAP[it.tax_rate] || 0),
        0
      )
      : 0;
  const total = subtotal + tax;
  const paid = payments.reduce((s, p) => s + safeNum(p.amount), 0);
  return { total, paid, balance: Math.max(0, total - paid) };
}
function calcPurchaseTotals(purchase, items = [], payments = []) {
  const itemsSubtotal = items.reduce((s, it) => s + safeNum(it.line_subtotal), 0);
  const tax = items.reduce((s, it) => s + safeNum(it.line_subtotal) * (TAX_MAP[it.tax_rate] || 0), 0);
  const freight = safeNum(purchase?.freight_charge_total);
  const total = itemsSubtotal + tax + freight;
  const paid = payments.reduce((s, p) => s + safeNum(p.amount), 0);
  return { total, paid, balance: Math.max(0, total - paid) };
}

/** =============================================================================
 *  Small UI atoms
 * =============================================================================*/
function Pager({ page, totalPages, setPage }) {
  return (
    <div className="pager">
      <div className="muted">
        Page {page} of {totalPages}
      </div>
      <div className="pager-controls">
        <button className="btn" onClick={() => setPage(1)} disabled={page === 1}>
          «
        </button>
        <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
          Prev
        </button>
        <button
          className="btn"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
        >
          Next
        </button>
        <button className="btn" onClick={() => setPage(totalPages)} disabled={page === totalPages}>
          »
        </button>
      </div>
    </div>
  );
}
function DetailRow({
  label,
  edit,
  type = "text",
  value,
  checked,
  onChange,
  onChangeChecked,
  required = false,
  step,
  maxLength,
  placeholder,
  rows = 3,
}) {
  return (
    <div className="detail-row">
      <div className="detail-label">
        {label}
        {required ? " *" : ""}
      </div>
      {!edit ? (
        <div className="detail-value">{value ? String(value) : <span className="muted">-</span>}</div>
      ) : type === "textarea" ? (
        <textarea
          className="input area"
          rows={rows}
          value={value || ""}
          placeholder={placeholder}
          onChange={(e) => onChange?.(e.target.value)}
        />
      ) : type === "checkbox" ? (
        <label className="check">
          <input type="checkbox" checked={!!checked} onChange={(e) => onChangeChecked?.(e.target.checked)} />
          <span>Active</span>
        </label>
      ) : (
        <input
          className="input"
          type={type}
          step={step}
          required={required}
          value={value ?? ""}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange?.(e.target.value)}
        />
      )}
    </div>
  );
}

/** =============================================================================
 *  Form defaults
 * =============================================================================*/
const EMPTY_CLIENT = {
  name: "",
  contact: "",
  billing_address: "",
  shipping_address: "",
  credit: "",
  active: true,
  notes: "",
  gstin: "",
};
const EMPTY_VENDOR = {
  name: "",
  contact: "",
  secondary_contact: "",
  address: "",
  active: true,
  notes: "",
  gstin: "",
};

/** =============================================================================
 *  Main Parties component (tabs: Customers & Vendors)
 * =============================================================================*/
export default function Parties() {
  const [tab, setTab] = useState("CUSTOMERS");
  const isSalesUser = getSession()?.role === 'sales';

  // Ensure sales users can't access vendors tab
  useEffect(() => {
    if (isSalesUser && tab === 'VENDORS') {
      setTab('CUSTOMERS');
    }
  }, [isSalesUser, tab]);

  // base lists
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [vendors, setVendors] = useState([]);

  // pending maps
  const [clientPendingMap, setClientPendingMap] = useState(new Map());
  const [vendorPendingMap, setVendorPendingMap] = useState(new Map());

  // list filters
  const [search, setSearch] = useState("");
  const [pendingFilter, setPendingFilter] = useState("ALL"); // ALL | PENDING | NOPENDING
  const [activeFilter, setActiveFilter] = useState("ALL"); // ALL | ACTIVE | INACTIVE

  // list pagination
  const [custPage, setCustPage] = useState(1);
  const [vendPage, setVendPage] = useState(1);

  // Create/Edit modal (Customers)
  const [cModalOpen, setCModalOpen] = useState(false);
  const [cEditing, setCEditing] = useState(false);
  const [cSelected, setCSelected] = useState(null);
  const [cForm, setCForm] = useState(EMPTY_CLIENT);
  const [cConfirmOpen, setCConfirmOpen] = useState(false);
  const cSavingRef = useRef(false);

  // Create/Edit modal (Vendors)
  const [vModalOpen, setVModalOpen] = useState(false);
  const [vEditing, setVEditing] = useState(false);
  const [vSelected, setVSelected] = useState(null);
  const [vForm, setVForm] = useState(EMPTY_VENDOR);
  const [vConfirmOpen, setVConfirmOpen] = useState(false);
  const vSavingRef = useRef(false);

  // Statement modal
  const [open, setOpen] = useState(false);
  const [partyKind, setPartyKind] = useState(null); // 'CLIENT' | 'VENDOR'
  const [party, setParty] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [payments, setPayments] = useState([]);

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [datePreset, setDatePreset] = useState("ALL");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rowsPage, setRowsPage] = useState(1);
  const [histPage, setHistPage] = useState(1);

  const [fromISO, toISO] = useMemo(() => {
    if (datePreset === "CUSTOM" && customFrom && customTo) {
      return [
        istInputToUTCDate(customFrom)?.toISOString() ?? null,
        istInputToUTCDate(customTo)?.toISOString() ?? null,
      ];
    }
    return getRange(datePreset);
  }, [datePreset, customFrom, customTo]);

  /** ---------- Load base lists ---------- **/
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [{ data: cli, error: e1 }, { data: ven, error: e2 }] = await Promise.all([
          supabase
            .from("clients")
            .select(
              "id,name,contact,billing_address,shipping_address,active,notes,created_at,credit,gstin"
            )
            .order("created_at", { ascending: false }),
          supabase
            .from("vendors")
            .select(
              "id,name,contact,address,active,notes,created_at,secondary_contact,gstin"
            )
            .order("created_at", { ascending: false }),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        setCustomers(cli || []);
        setVendors(ven || []);
        await computeAggregatePending(cli || [], ven || []);
      } catch (err) {
        console.error("Load parties lists failed:", err);
        alert("Failed to load parties.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ---------- Compute aggregate pending ---------- **/
  async function computeAggregatePending(cli, ven) {
    try {
      const { data: sales, error: eSales } = await supabase
        .from("sales")
        .select("id, client_id, sale_at, with_tax, invoice_with_gst");
      if (eSales) throw eSales;

      const saleIds = (sales || []).map((s) => s.id);
      const [{ data: sItems, error: eItems }, { data: sPays, error: ePays }] = await Promise.all([
        saleIds.length
          ? supabase
            .from("sales_items")
            .select("id,sale_id,quantity,unit_price,tax_rate")
            .in("sale_id", saleIds)
          : { data: [], error: null },
        saleIds.length
          ? supabase
            .from("payments")
            .select("id,kind,sale_id,amount")
            .eq("kind", "SALE")
            .in("sale_id", saleIds)
          : { data: [], error: null },
      ]);
      if (eItems) throw eItems;
      if (ePays) throw ePays;

      const itemsBySale = new Map();
      (sItems || []).forEach((it) => {
        const arr = itemsBySale.get(it.sale_id) || [];
        arr.push(it);
        itemsBySale.set(it.sale_id, arr);
      });
      const paysBySale = new Map();
      (sPays || []).forEach((p) => {
        const arr = paysBySale.get(p.sale_id) || [];
        arr.push(p);
        paysBySale.set(p.sale_id, arr);
      });

      const cPend = new Map();
      (sales || []).forEach((s) => {
        const its = itemsBySale.get(s.id) || [];
        const ps = paysBySale.get(s.id) || [];
        const { balance } = calcSaleTotals(s, its, ps);
        if (balance > 0) cPend.set(s.client_id, (cPend.get(s.client_id) || 0) + balance);
      });
      setClientPendingMap(cPend);
    } catch (err) {
      console.error("Aggregate receivables failed:", err);
      setClientPendingMap(new Map());
    }

    try {
      const { data: purchases, error: ePurch } = await supabase
        .from("purchases")
        .select("id, vendor_id, freight_charge_total");
      if (ePurch) throw ePurch;

      const puIds = (purchases || []).map((p) => p.id);
      const [{ data: pItems, error: eItems }, { data: pPays, error: ePays }] = await Promise.all([
        puIds.length
          ? supabase
            .from("purchase_items")
            .select("id,purchase_id,line_subtotal,tax_rate")
            .in("purchase_id", puIds)
          : { data: [], error: null },
        puIds.length
          ? supabase
            .from("payments")
            .select("id,kind,purchase_id,amount")
            .eq("kind", "PURCHASE")
            .in("purchase_id", puIds)
          : { data: [], error: null },
      ]);
      if (eItems) throw eItems;
      if (ePays) throw ePays;

      const itemsByPurch = new Map();
      (pItems || []).forEach((it) => {
        const arr = itemsByPurch.get(it.purchase_id) || [];
        arr.push(it);
        itemsByPurch.set(it.purchase_id, arr);
      });
      const paysByPurch = new Map();
      (pPays || []).forEach((p) => {
        const arr = paysByPurch.get(p.purchase_id) || [];
        arr.push(p);
        paysByPurch.set(p.purchase_id, arr);
      });

      const vPend = new Map();
      (purchases || []).forEach((pu) => {
        const its = itemsByPurch.get(pu.id) || [];
        const ps = paysByPurch.get(pu.id) || [];
        const { balance } = calcPurchaseTotals(pu, its, ps);
        if (balance > 0) vPend.set(pu.vendor_id, (vPend.get(pu.vendor_id) || 0) + balance);
      });
      setVendorPendingMap(vPend);
    } catch (err) {
      console.error("Aggregate payables failed:", err);
      setVendorPendingMap(new Map());
    }
  }

  /** ---------- Derived lists (filters, sort, pagination) ---------- **/
  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q
      ? customers
      : customers.filter(
        (c) =>
          (c.name || "").toLowerCase().includes(q) ||
          (c.contact || "").toLowerCase().includes(q) ||
          (c.billing_address || "").toLowerCase().includes(q) ||
          (c.gstin || "").toLowerCase().includes(q)
      );

    const withPending = base
      .map((c) => ({ ...c, _pending: clientPendingMap.get(c.id) || 0 }))
      .filter((c) => {
        if (pendingFilter === "PENDING") return c._pending > 0;
        if (pendingFilter === "NOPENDING") return (c._pending || 0) === 0;
        return true;
      })
      .filter((c) => {
        if (activeFilter === "ACTIVE") return !!c.active;
        if (activeFilter === "INACTIVE") return !c.active;
        return true;
      })
      .sort((a, b) => b._pending - a._pending || a.name.localeCompare(b.name));

    const pages = Math.max(1, Math.ceil(withPending.length / LIST_PAGE_SIZE));
    if (custPage > pages) setCustPage(1);
    return withPending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, clientPendingMap, search, pendingFilter, activeFilter]);

  const custStart = (custPage - 1) * LIST_PAGE_SIZE;
  const custSlice = filteredCustomers.slice(custStart, custStart + LIST_PAGE_SIZE);
  const custTotalPages = Math.max(1, Math.ceil(filteredCustomers.length / LIST_PAGE_SIZE));

  const filteredVendors = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q
      ? vendors
      : vendors.filter(
        (v) =>
          (v.name || "").toLowerCase().includes(q) ||
          (v.contact || "").toLowerCase().includes(q) ||
          (v.address || "").toLowerCase().includes(q) ||
          (v.gstin || "").toLowerCase().includes(q)
      );

    const withPending = base
      .map((v) => ({ ...v, _pending: vendorPendingMap.get(v.id) || 0 }))
      .filter((v) => {
        if (pendingFilter === "PENDING") return v._pending > 0;
        if (pendingFilter === "NOPENDING") return (v._pending || 0) === 0;
        return true;
      })
      .filter((v) => {
        if (activeFilter === "ACTIVE") return !!v.active;
        if (activeFilter === "INACTIVE") return !v.active;
        return true;
      })
      .sort((a, b) => b._pending - a._pending || a.name.localeCompare(b.name));

    const pages = Math.max(1, Math.ceil(withPending.length / LIST_PAGE_SIZE));
    if (vendPage > pages) setVendPage(1);
    return withPending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendors, vendorPendingMap, search, pendingFilter, activeFilter]);

  const vendStart = (vendPage - 1) * LIST_PAGE_SIZE;
  const vendSlice = filteredVendors.slice(vendStart, vendStart + LIST_PAGE_SIZE);
  const vendTotalPages = Math.max(1, Math.ceil(filteredVendors.length / LIST_PAGE_SIZE));

  // reset pages when list-level filters change
  useEffect(() => {
    setCustPage(1);
    setVendPage(1);
  }, [search, pendingFilter, activeFilter, tab]);

  /** =============================================================================
   *  Customers CRUD
   * =============================================================================*/
  function openCustomerAdd() {
    setCSelected(null);
    setCForm(EMPTY_CLIENT);
    setCEditing(true);
    setCConfirmOpen(false);
    setCModalOpen(true);
  }
  function openCustomerView(row) {
    setCSelected(row);
    setCForm({
      name: row.name || "",
      contact: row.contact || "",
      billing_address: row.billing_address || "",
      shipping_address: row.shipping_address || "",
      credit: row.credit ?? "",
      active: !!row.active,
      notes: row.notes || "",
      gstin: row.gstin || "",
    });
    setCEditing(false);
    setCConfirmOpen(false);
    setCModalOpen(true);
  }
  function closeCustomerModal() {
    setCModalOpen(false);
    setCSelected(null);
    setCEditing(false);
    setCConfirmOpen(false);
    setCForm(EMPTY_CLIENT);
  }
  function normalizeGSTIN(input) {
    return (input || "").replace(/\s+/g, "").toUpperCase();
  }
  async function saveCustomer(e) {
    e.preventDefault();
    if (cSavingRef.current) return;
    const cleanedGSTIN = normalizeGSTIN(cForm.gstin);
    if (cleanedGSTIN && !GSTIN_REGEX.test(cleanedGSTIN)) {
      alert("Invalid GSTIN format. It must be 15 characters and match the GSTIN pattern.");
      return;
    }
    const payload = {
      ...cForm,
      name: cForm.name?.trim(),
      contact: cForm.contact?.trim() || null,
      billing_address: cForm.billing_address?.trim() || null,
      shipping_address: cForm.shipping_address?.trim() || null,
      notes: cForm.notes?.trim() || null,
      credit: cForm.credit === "" ? null : Number(cForm.credit),
      gstin: cleanedGSTIN || null,
    };
    if (!payload.name) {
      alert("Client name is required");
      return;
    }
    cSavingRef.current = true;
    try {
      if (cSelected) {
        const { error } = await supabase.from("clients").update(payload).eq("id", cSelected.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clients").insert([payload]);
        if (error) throw error;
      }
      // refresh
      const { data: cli } = await supabase
        .from("clients")
        .select(
          "id,name,contact,billing_address,shipping_address,active,notes,created_at,credit,gstin"
        )
        .order("created_at", { ascending: false });
      setCustomers(cli || []);
      await computeAggregatePending(cli || [], vendors || []);
      closeCustomerModal();
    } catch (err) {
      console.error("Save client failed", err);
      alert(err?.message || "Failed to save client");
    } finally {
      cSavingRef.current = false;
    }
  }
  async function deleteCustomer() {
    if (!cSelected) return;
    try {
      const { error } = await supabase.from("clients").delete().eq("id", cSelected.id);
      if (error) throw error;
      const remaining = customers.filter((x) => x.id !== cSelected.id);
      setCustomers(remaining);
      await computeAggregatePending(remaining, vendors || []);
      closeCustomerModal();
    } catch (err) {
      console.error("Delete client failed", err);
      alert(err?.message || "Failed to delete client");
    }
  }

  /** =============================================================================
   *  Vendors CRUD
   * =============================================================================*/
  function openVendorAdd() {
    setVSelected(null);
    setVForm(EMPTY_VENDOR);
    setVEditing(true);
    setVConfirmOpen(false);
    setVModalOpen(true);
  }
  function openVendorView(row) {
    setVSelected(row);
    setVForm({
      name: row.name || "",
      contact: row.contact || "",
      secondary_contact: row.secondary_contact || "",
      address: row.address || "",
      active: !!row.active,
      notes: row.notes || "",
      gstin: row.gstin || "",
    });
    setVEditing(false);
    setVConfirmOpen(false);
    setVModalOpen(true);
  }
  function closeVendorModal() {
    setVModalOpen(false);
    setVSelected(null);
    setVEditing(false);
    setVConfirmOpen(false);
    setVForm(EMPTY_VENDOR);
  }
  function isValidGSTIN(v) {
    if (!v) return true;
    return GSTIN_REGEX.test((v || "").toUpperCase().trim());
  }
  async function saveVendor(e) {
    e.preventDefault();
    if (vSavingRef.current) return;
    if (!vForm.name?.trim()) {
      alert("Vendor name is required");
      return;
    }
    if (!isValidGSTIN(vForm.gstin)) {
      alert("Invalid GSTIN format. It should be 15 characters like 27ABCDE1234F1Z5.");
      return;
    }
    const payload = {
      ...vForm,
      name: vForm.name?.trim(),
      contact: vForm.contact?.trim() || null,
      secondary_contact: vForm.secondary_contact?.trim() || null,
      address: vForm.address?.trim() || null,
      notes: vForm.notes?.trim() || null,
      gstin: vForm.gstin?.trim() ? vForm.gstin.trim().toUpperCase() : null,
    };
    vSavingRef.current = true;
    try {
      if (vSelected) {
        const { error } = await supabase.from("vendors").update(payload).eq("id", vSelected.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("vendors").insert([payload]);
        if (error) throw error;
      }
      // refresh
      const { data: ven } = await supabase
        .from("vendors")
        .select(
          "id,name,contact,address,active,notes,created_at,secondary_contact,gstin"
        )
        .order("created_at", { ascending: false });
      setVendors(ven || []);
      await computeAggregatePending(customers || [], ven || []);
      closeVendorModal();
    } catch (err) {
      console.error("Save vendor failed", err);
      alert(err?.message || "Failed to save vendor");
    } finally {
      vSavingRef.current = false;
    }
  }
  async function deleteVendor() {
    if (!vSelected) return;
    try {
      const { error } = await supabase.from("vendors").delete().eq("id", vSelected.id);
      if (error) throw error;
      const remaining = vendors.filter((x) => x.id !== vSelected.id);
      setVendors(remaining);
      await computeAggregatePending(customers || [], remaining);
      closeVendorModal();
    } catch (err) {
      console.error("Delete vendor failed", err);
      alert(err?.message || "Failed to delete vendor");
    }
  }

  /** =============================================================================
   *  Statement / Details (shared)
   * =============================================================================*/
  async function onViewStatement(kind, record) {
    setOpen(true);
    setPartyKind(kind);
    setParty(record);
    setStatusFilter("ALL");
    setDatePreset("ALL");
    setCustomFrom("");
    setCustomTo("");
    setRowsPage(1);
    setHistPage(1);
    await loadDetails(kind, record, "ALL", ...getRange("ALL"));
  }
  async function loadDetails(kind, record, status, from, to) {
    if (!record) return;
    setDetailLoading(true);
    try {
      if (kind === "CLIENT") {
        let q = supabase
          .from("sales")
          .select(
            "id,sale_id,client_id,sale_at,with_tax,invoice_with_gst,description,created_at"
          )
          .eq("client_id", record.id);
        if (from) q = q.gte("sale_at", from);
        if (to) q = q.lte("sale_at", to);
        const { data: sales, error: eSales } = await q.order("sale_at", { ascending: false });
        if (eSales) throw eSales;

        const saleIds = (sales || []).map((s) => s.id);
        const [{ data: items, error: eItems }, { data: pays, error: ePays }] = await Promise.all([
          saleIds.length
            ? supabase
              .from("sales_items")
              .select("id,sale_id,quantity,unit,unit_price,tax_rate")
              .in("sale_id", saleIds)
            : { data: [], error: null },
          saleIds.length
            ? supabase
              .from("payments")
              .select("id,kind,sale_id,amount,paid_at,notes,created_at")
              .eq("kind", "SALE")
              .in("sale_id", saleIds)
              .order("paid_at", { ascending: false })
            : { data: [], error: null },
        ]);
        if (eItems) throw eItems;
        if (ePays) throw ePays;

        const itemsBySale = new Map();
        (items || []).forEach((it) => {
          const arr = itemsBySale.get(it.sale_id) || [];
          arr.push(it);
          itemsBySale.set(it.sale_id, arr);
        });
        const paysBySale = new Map();
        (pays || []).forEach((p) => {
          const arr = paysBySale.get(p.sale_id) || [];
          arr.push(p);
          paysBySale.set(p.sale_id, arr);
        });

        let computed = (sales || []).map((s) => {
          const its = itemsBySale.get(s.id) || [];
          const ps = paysBySale.get(s.id) || [];
          const t = calcSaleTotals(s, its, ps);
          return { kind: "SALE", ...s, ...t, items: its, payments: ps };
        });

        if (status === "PAID") computed = computed.filter((r) => r.balance === 0);
        if (status === "PENDING") computed = computed.filter((r) => r.balance > 0);

        const history = (pays || [])
          .map((p) => ({
            type: "PAYMENT",
            id: p.id,
            date: p.paid_at,
            label: "Payment from customer",
            amount: p.amount,
            notes: p.notes,
          }))
          .sort((a, b) => new Date(b.date) - new Date(a.date));

        setRows(computed);
        setPayments(history);
      } else {
        let q = supabase
          .from("purchases")
          .select(
            "id,purchase_id,vendor_id,purchase_at,mode_of_payment,description,status,created_at,freight_charge_total"
          )
          .eq("vendor_id", record.id);
        if (from) q = q.gte("purchase_at", from);
        if (to) q = q.lte("purchase_at", to);
        const { data: purchases, error: ePurch } = await q.order("purchase_at", {
          ascending: false,
        });
        if (ePurch) throw ePurch;

        const puIds = (purchases || []).map((p) => p.id);
        const [{ data: items, error: eItems }, { data: pays, error: ePays }] = await Promise.all([
          puIds.length
            ? supabase
              .from("purchase_items")
              .select(
                "id,purchase_id,line_subtotal,tax_rate,quantity,unit_price,unit,delivered"
              )
              .in("purchase_id", puIds)
            : { data: [], error: null },
          puIds.length
            ? supabase
              .from("payments")
              .select("id,kind,purchase_id,amount,paid_at,notes,created_at")
              .eq("kind", "PURCHASE")
              .in("purchase_id", puIds)
              .order("paid_at", { ascending: false })
            : { data: [], error: null },
        ]);
        if (eItems) throw eItems;
        if (ePays) throw ePays;

        const itemsByPurch = new Map();
        (items || []).forEach((it) => {
          const arr = itemsByPurch.get(it.purchase_id) || [];
          arr.push(it);
          itemsByPurch.set(it.purchase_id, arr);
        });
        const paysByPurch = new Map();
        (pays || []).forEach((p) => {
          const arr = paysByPurch.get(p.purchase_id) || [];
          arr.push(p);
          paysByPurch.set(p.purchase_id, arr);
        });

        let computed = (purchases || []).map((pu) => {
          const its = itemsByPurch.get(pu.id) || [];
          const ps = paysByPurch.get(pu.id) || [];
          const t = calcPurchaseTotals(pu, its, ps);
          return { kind: "PURCHASE", ...pu, ...t, items: its, payments: ps };
        });

        if (status === "PAID") computed = computed.filter((r) => r.balance === 0);
        if (status === "PENDING") computed = computed.filter((r) => r.balance > 0);

        const history = (pays || [])
          .map((p) => ({
            type: "PAYMENT",
            id: p.id,
            date: p.paid_at,
            label: "Payment to vendor",
            amount: p.amount,
            notes: p.notes,
          }))
          .sort((a, b) => new Date(b.date) - new Date(a.date));

        setRows(computed);
        setPayments(history);
      }
    } catch (err) {
      console.error("Load details failed:", err);
    } finally {
      setDetailLoading(false);
    }
  }
  const summary = useMemo(() => {
    const total = rows.reduce((s, r) => s + (r.total || 0), 0);
    const paid = rows.reduce((s, r) => s + (r.paid || 0), 0);
    const balance = rows.reduce((s, r) => s + (r.balance || 0), 0);
    return { total, paid, balance };
  }, [rows]);
  useEffect(() => {
    setRowsPage(1);
    setHistPage(1);
    if (!partyKind || !party) return;
    if (datePreset === "ALL") {
      loadDetails(partyKind, party, statusFilter, null, null);
    } else {
      loadDetails(partyKind, party, statusFilter, fromISO, toISO);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, datePreset, fromISO, toISO]);

  const rowsStart = (rowsPage - 1) * DETAIL_PAGE_SIZE;
  const rowsSlice = rows.slice(rowsStart, rowsStart + DETAIL_PAGE_SIZE);
  const rowsTotalPages = Math.max(1, Math.ceil(rows.length / DETAIL_PAGE_SIZE));

  const histStart = (histPage - 1) * DETAIL_PAGE_SIZE;
  const histSlice = payments.slice(histStart, histStart + DETAIL_PAGE_SIZE);
  const histTotalPages = Math.max(1, Math.ceil(payments.length / DETAIL_PAGE_SIZE));

  function downloadPDF() {
    if (!party) return;
    const win = window.open("", "_blank");
    const title = partyKind === "CLIENT" ? `Customer_${party.name}` : `Vendor_${party.name}`;
    const style = `
      <style>
        body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; color:#111827; }
        h1 { margin:0 0 8px; font-size:20px; }
        h2 { font-size:16px; margin:18px 0 8px; }
        table { width:100%; border-collapse: collapse; font-size:12px; }
        th, td { border:1px solid #e5e7eb; padding:6px 8px; text-align:left; }
        .right { text-align:right; }
        .muted { color:#667085; }
        .danger { color:#b91c1c; font-weight:700; }
        .chip { display:inline-block; border:1px solid #e5e7eb; padding:2px 8px; border-radius:999px; font-size:11px; }
      </style>
    `;
    const rowsHTML = rows
      .map((r) => {
        const date = r.sale_at || r.purchase_at || r.created_at;
        const formattedDate = date ? formatDate(date) : "";
        const code = r.sale_id || r.purchase_id || "";
        return `<tr>
    <td>${formattedDate}</td>
    <td>${code}</td>
    <td class="right">${fmtINR(r.total)}</td>
    <td class="right">${fmtINR(r.paid)}</td>
    <td class="right">${fmtINR(r.balance)}</td>
  </tr>`;
      })
      .join("");
    const summaryHTML = `
      <div>
        <div><strong>Name:</strong> ${party.name || ""}</div>
        <div class="muted">${partyKind === "CLIENT" ? party.billing_address || "" : party.address || ""}</div>
        <div style="margin-top:8px"><span class="chip">Total: ${fmtINR(summary.total)}</span>
          <span class="chip" style="margin-left:8px">Paid: ${fmtINR(summary.paid)}</span>
          <span class="chip" style="margin-left:8px">Pending: <span class="danger">${fmtINR(
      summary.balance
    )}</span></span>
        </div>
      </div>
    `;
    win.document.write(
      `<html><head><title>${title}</title>${style}</head><body>
      <h1>${partyKind === "CLIENT" ? "Customer" : "Vendor"} Statement</h1>
      ${summaryHTML}
      <h2>Transactions (${rows.length})</h2>
      <table>
        <thead><tr><th>Date</th><th>Code</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Pending</th></tr></thead>
        <tbody>${rowsHTML}</tbody>
      </table>
      </body></html>`
    );
    win.document.close();
    win.focus();
    win.onafterprint = function () {
      win.close();
    };
    const fallbackClose = setTimeout(() => {
      if (!win.closed) {
        win.close();
      }
    }, 1000);
    win.addEventListener("beforeunload", () => {
      clearTimeout(fallbackClose);
    });
    win.print();
  }

  /** ---------- Render helpers ---------- **/
  const PendingChip = ({ amount }) => {
    if (!amount || amount <= 0) return null;
    return (
      <div
        className="status"
        style={{
          marginTop: 6,
          color: "#991B1B",
          background: "#FEF2F2",
          borderColor: "#FECACA",
          marginLeft: "8px",
        }}
      >
        <span className="dot" style={{ background: "#EF4444" }} />
        Pending
      </div>
    );
  };

  /** =============================================================================
   *  UI
   * =============================================================================*/
  return (
    <NavFrame>
      <div className="wrap">
        <div className="bar">
          <div className="title margin-bottom">Parties</div>
          <div className="actions margin-bottom">
            {tab === "CUSTOMERS" ? (
              <button className="btn primary modal-btn width-100" onClick={openCustomerAdd}>
                + Add Customer
              </button>
            ) : (
              <button className="btn primary modal-btn width-100" onClick={openVendorAdd}>
                + Add Vendor
              </button>
            )}
          </div>
        </div>

        <div className="actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            className={`btn modal-btn ${tab === "CUSTOMERS" ? "primary" : ""}`}
            onClick={() => setTab("CUSTOMERS")}
          >
            Customers
          </button>
          {!isSalesUser && (
            <button
              className={`btn modal-btn ${tab === "VENDORS" ? "primary" : ""}`}
              onClick={() => setTab("VENDORS")}
            >
              Vendors
            </button>
          )}
        </div>

        {/* Toolbar */}
        <div className="parties-toolbar">
          <div className="parties-toolbar__group">
            <label className="lbl parties-toolbar__label">
              <span className="lbl-text">Search</span>
            </label>
            <input
              className="input"
              placeholder={
                tab === "CUSTOMERS"
                  ? "Search customers by name, contact, address or GSTIN…"
                  : "Search vendors by name, contact, address or GSTIN…"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="parties-toolbar__group">
            <label className="lbl parties-toolbar__label">
              <span className="lbl-text">Pending</span>
            </label>
            <select
              className="input"
              value={pendingFilter}
              onChange={(e) => setPendingFilter(e.target.value)}
              aria-label="Filter by pending"
            >
              <option value="ALL">All</option>
              <option value="PENDING">Pending only</option>
              <option value="NOPENDING">No pending</option>
            </select>
          </div>

          <div className="parties-toolbar__group">
            <label className="lbl parties-toolbar__label">
              <span className="lbl-text">Status</span>
            </label>
            <select
              className="input"
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value)}
              aria-label="Filter by active status"
            >
              <option value="ALL">All</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>

        {/* Lists */}
        <div className="card table-wrap">
          {loading ? (
            <div style={{ padding: 14, textAlign: "center" }}>Loading…</div>
          ) : tab === "CUSTOMERS" ? (
            <>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Contact</th>
                    <th>Billing Address</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {custSlice.map((c) => {
                    const pend = clientPendingMap.get(c.id) || 0;
                    return (
                      <tr key={c.id}>
                        <td data-th="Name">
                          <div className="truncate">{c.name}</div>
                          <div className={`status ${c.active ? "status--active" : "status--inactive"}`} style={{ marginTop: 6 }}>
                            <span className="dot" /> {c.active ? "Active" : "Inactive"}
                          </div>
                          <PendingChip amount={pend} />
                        </td>
                        <td data-th="Contact" className="wrap-text">
                          {c.contact || <span className="muted">—</span>}
                        </td>
                        <td data-th="Billing Address" className="wrap-text truncate">
                          {c.billing_address || <span className="muted">—</span>}
                        </td>
                        <td data-th="Actions" className="right">
                          <div className="actions">
                            <button className="btn" onClick={() => openCustomerView(c)}>
                              View
                            </button>
                            <button className="btn ghost" onClick={() => onViewStatement("CLIENT", c)}>
                              Statement
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {custSlice.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: 14 }} className="muted">
                        No customers found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <Pager page={custPage} totalPages={custTotalPages} setPage={setCustPage} />
            </>
          ) : (
            <>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Contact(s)</th>
                    <th>Address</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vendSlice.map((v) => {
                    const pend = vendorPendingMap.get(v.id) || 0;
                    return (
                      <tr key={v.id}>
                        <td data-th="Name">
                          <div className="truncate">{v.name}</div>
                          <div className={`status ${v.active ? "status--active" : "status--inactive"}`} style={{ marginTop: 6 }}>
                            <span className="dot" /> {v.active ? "Active" : "Inactive"}
                          </div>
                          <PendingChip amount={pend} />
                        </td>
                        <td data-th="Contact(s)" className="wrap-text">
                          {v.contact || <span className="muted">—</span>}
                          {v.secondary_contact ? `, ${v.secondary_contact}` : ""}
                        </td>
                        <td data-th="Address" className="wrap-text truncate">
                          {v.address || <span className="muted">—</span>}
                        </td>
                        <td data-th="Actions" className="right">
                          <div className="actions">
                            <button className="btn" onClick={() => openVendorView(v)}>
                              View
                            </button>
                            <button className="btn ghost" onClick={() => onViewStatement("VENDOR", v)}>
                              Statement
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {vendSlice.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: 14 }} className="muted">
                        No vendors found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <Pager page={vendPage} totalPages={vendTotalPages} setPage={setVendPage} />
            </>
          )}
        </div>

        {/* Customer Modal */}
        {cModalOpen && (
          <div className="modal">
            <div className="modal-card modal-card--lg">
              <div className="modal-head">
                <h2 className="modal-title">
                  {cSelected ? (cEditing ? "Edit Customer" : "Customer Details") : "Add Customer"}
                </h2>
                <button className="btn icon" onClick={closeCustomerModal} aria-label="Close">
                  ×
                </button>
              </div>

              <form onSubmit={saveCustomer}>
                <div className="details-grid">
                  <div className="details-col">
                    <DetailRow
                      label="Name"
                      edit={cEditing}
                      value={cForm.name}
                      onChange={(v) => setCForm({ ...cForm, name: v })}
                      required
                    />
                    <DetailRow
                      label="Contact"
                      edit={cEditing}
                      value={cForm.contact}
                      onChange={(v) => setCForm({ ...cForm, contact: v })}
                    />
                    <DetailRow
                      label="Credit (₹)"
                      edit={cEditing}
                      type="number"
                      step="0.01"
                      value={cForm.credit}
                      onChange={(v) => setCForm({ ...cForm, credit: v })}
                    />
                    <DetailRow
                      label="Active"
                      edit={cEditing}
                      type="checkbox"
                      checked={!!cForm.active}
                      onChangeChecked={(c) => setCForm({ ...cForm, active: c })}
                      value={cForm.active ? "Yes" : "No"}
                    />
                  </div>

                  <div className="details-col">
                    <DetailRow
                      label="Billing Address"
                      edit={cEditing}
                      type="textarea"
                      rows={3}
                      value={cForm.billing_address}
                      onChange={(v) => setCForm({ ...cForm, billing_address: v })}
                    />
                    <DetailRow
                      label="Shipping Address"
                      edit={cEditing}
                      type="textarea"
                      rows={3}
                      value={cForm.shipping_address}
                      onChange={(v) => setCForm({ ...cForm, shipping_address: v })}
                    />
                    <DetailRow
                      label="Notes"
                      edit={cEditing}
                      type="textarea"
                      rows={3}
                      value={cForm.notes}
                      onChange={(v) => setCForm({ ...cForm, notes: v })}
                    />
                    <DetailRow
                      label="GSTIN (optional)"
                      edit={cEditing}
                      value={cForm.gstin}
                      maxLength={15}
                      onChange={(v) => setCForm({ ...cForm, gstin: (v || "").toUpperCase() })}
                    />
                  </div>
                </div>

                <div className="modal-actions between">
                  {!cEditing ? (
                    <>
                      {cSelected && (
                        <button
                          type="button"
                          className="btn modal-btn"
                          onClick={() => setCEditing(true)}
                        >
                          Edit
                        </button>
                      )}
                      {cSelected && (
                        <button
                          type="button"
                          className="btn danger modal-btn"
                          onClick={() => setCConfirmOpen(true)}
                        >
                          Remove
                        </button>
                      )}
                      {!cSelected && <span className="muted">Fill details and click “Create”.</span>}
                      <div />
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn modal-btn"
                        onClick={() => {
                          if (cSelected) {
                            setCEditing(false);
                            openCustomerView(cSelected);
                          } else {
                            closeCustomerModal();
                          }
                        }}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="btn primary modal-btn">
                        {cSelected ? "Save Changes" : "Create"}
                      </button>
                    </>
                  )}
                </div>
              </form>
            </div>

            {cConfirmOpen && cSelected && (
              <div className="confirm">
                <div className="confirm-card">
                  <div className="confirm-title">Delete Customer?</div>
                  <p className="confirm-text">
                    This action cannot be undone. Remove <b>{cSelected.name}</b>?
                  </p>
                  <div className="confirm-actions">
                    <button className="btn modal-btn" onClick={() => setCConfirmOpen(false)}>
                      Cancel
                    </button>
                    <button className="btn danger modal-btn" onClick={deleteCustomer}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Vendor Modal */}
        {vModalOpen && (
          <div className="modal">
            <div className="modal-card modal-card--lg">
              <div className="modal-head">
                <h2 className="modal-title">
                  {vSelected ? (vEditing ? "Edit Vendor" : "Vendor Details") : "Add Vendor"}
                </h2>
                <button className="btn icon" onClick={closeVendorModal} aria-label="Close">
                  ×
                </button>
              </div>

              <form onSubmit={saveVendor}>
                <div className="details-grid">
                  <div className="details-col">
                    <DetailRow
                      label="Name"
                      edit={vEditing}
                      value={vForm.name}
                      onChange={(v) => setVForm({ ...vForm, name: v })}
                      required
                    />
                    <DetailRow
                      label="Contact"
                      edit={vEditing}
                      value={vForm.contact}
                      onChange={(v) => setVForm({ ...vForm, contact: v })}
                    />
                    <DetailRow
                      label="Secondary Contact"
                      edit={vEditing}
                      value={vForm.secondary_contact}
                      onChange={(v) => setVForm({ ...vForm, secondary_contact: v })}
                    />
                    <DetailRow
                      label="Active"
                      edit={vEditing}
                      type="checkbox"
                      checked={!!vForm.active}
                      onChangeChecked={(c) => setVForm({ ...vForm, active: c })}
                      value={vForm.active ? "Yes" : "No"}
                    />
                  </div>

                  <div className="details-col">
                    <DetailRow
                      label="Address"
                      edit={vEditing}
                      type="textarea"
                      rows={3}
                      value={vForm.address}
                      onChange={(v) => setVForm({ ...vForm, address: v })}
                    />
                    <DetailRow
                      label="Notes"
                      edit={vEditing}
                      type="textarea"
                      rows={3}
                      value={vForm.notes}
                      onChange={(v) => setVForm({ ...vForm, notes: v })}
                    />
                    <DetailRow
                      label="GSTIN"
                      edit={vEditing}
                      value={vForm.gstin}
                      maxLength={15}
                      onChange={(v) => setVForm({ ...vForm, gstin: (v || "").toUpperCase() })}
                    />
                  </div>
                </div>

                <div className="modal-actions between">
                  {!vEditing ? (
                    <>
                      {vSelected && (
                        <button
                          type="button"
                          className="btn modal-btn"
                          onClick={() => setVEditing(true)}
                        >
                          Edit
                        </button>
                      )}
                      {vSelected && (
                        <button
                          type="button"
                          className="btn danger modal-btn"
                          onClick={() => setVConfirmOpen(true)}
                        >
                          Remove
                        </button>
                      )}
                      {!vSelected && <span className="muted">Fill details and click “Create”.</span>}
                      <div />
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn modal-btn"
                        onClick={() => {
                          if (vSelected) {
                            setVEditing(false);
                            openVendorView(vSelected);
                          } else {
                            closeVendorModal();
                          }
                        }}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="btn modal-btn primary">
                        {vSelected ? "Save Changes" : "Create"}
                      </button>
                    </>
                  )}
                </div>
              </form>
            </div>

            {vConfirmOpen && vSelected && (
              <div className="confirm">
                <div className="confirm-card">
                  <div className="confirm-title">Delete Vendor?</div>
                  <p className="confirm-text">
                    This action cannot be undone. Remove <b>{vSelected.name}</b>?
                  </p>
                  <div className="confirm-actions">
                    <button className="btn modal-btn" onClick={() => setVConfirmOpen(false)}>
                      Cancel
                    </button>
                    <button className="btn modal-btn danger" onClick={deleteVendor}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Statement Modal */}
        {open && (
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-card modal-card--lg">
              <div className="modal-head">
                <div className="modal-title">
                  {partyKind === "CLIENT" ? "Customer Details" : "Vendor Details"}
                </div>
                <div className="actions">
                  <button className="btn parties-download-btn-pc" onClick={downloadPDF}>
                    Download as PDF
                  </button>
                  <button className="btn icon" aria-label="Close" onClick={() => setOpen(false)}>
                    ✕
                  </button>
                </div>
              </div>
                <button className="btn parties-download-btn-mobile" onClick={downloadPDF}>
                  Download as PDF
                </button>

              {/* Summary */}
              <div className="details-grid">
                <div className="details-col">
                  <div className="detail-row">
                    <div className="detail-label">Name</div>
                    <div className="detail-value">{party?.name}</div>
                  </div>
                  <div className="detail-row">
                    <div className="detail-label">
                      {partyKind === "CLIENT" ? "Receivable (Pending)" : "Payable (Pending)"}
                    </div>
                    <div className="detail-value" style={{ color: "#b91c1c", fontWeight: 700 }}>
                      {fmtINR(summary.balance)}
                    </div>
                  </div>
                </div>
                <div className="details-col">
                  <div className="detail-row">
                    <div className="detail-label">Total</div>
                    <div className="detail-value">{fmtINR(summary.total)}</div>
                  </div>
                  <div className="detail-row">
                    <div className="detail-label">Paid</div>
                    <div className="detail-value">{fmtINR(summary.paid)}</div>
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className="parties-modal-filters" style={{ marginTop: 10 }}>
                <label className="lbl">
                  <span className="lbl-text">Status</span>
                  <select
                    className="input"
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setRowsPage(1);
                    }}
                  >
                    <option value="ALL">All</option>
                    <option value="PENDING">Pending</option>
                    <option value="PAID">Paid</option>
                  </select>
                </label>
                <label className="lbl">
                  <span className="lbl-text">Date range</span>
                  <select
                    className="input"
                    value={datePreset}
                    onChange={(e) => setDatePreset(e.target.value)}
                    style={{ minWidth: "160px" }}
                  >
                    <option value="ALL">All Time</option>
                    <option value="TODAY">Today</option>
                    <option value="YESTERDAY">Yesterday</option>
                    <option value="THIS_WEEK">This Week</option>
                    <option value="LAST_WEEK">Last Week</option>
                    <option value="THIS_MONTH">This Month</option>
                    <option value="LAST_MONTH">Last Month</option>
                    <option value="LAST_30">Last 30 days</option>
                    <option value="THIS_YEAR">This Year</option>
                    <option value="LAST_YEAR">Last Year</option>
                    <option value="CUSTOM">Custom Range</option>
                  </select>
                </label>
                {datePreset === "CUSTOM" && (
                  <>
                    <label className="lbl">
                      <span className="lbl-text">From (IST)</span>
                      <input
                        className="input"
                        type="datetime-local"
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                      />
                    </label>
                    <label className="lbl">
                      <span className="lbl-text">To (IST)</span>
                      <input
                        className="input"
                        type="datetime-local"
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                      />
                    </label>
                  </>
                )}
              </div>

              {/* Details table */}
              <div className="table-wrap" style={{ marginTop: 10, overflowX: "auto" }}>
                <div style={{ minWidth: "600px" }}>
                  <table className="tbl" style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "12px", backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                          Date
                        </th>
                        <th style={{ textAlign: "left", padding: "12px", backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                          Reference ID
                        </th>
                        <th style={{ textAlign: "right", padding: "12px", backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                          Total
                        </th>
                        <th style={{ textAlign: "right", padding: "12px", backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                          Paid
                        </th>
                        <th style={{ textAlign: "right", padding: "12px", backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                          Pending
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailLoading && (
                        <tr>
                          <td colSpan={5} style={{ padding: "16px", textAlign: "center" }}>
                            Loading…
                          </td>
                        </tr>
                      )}
                      {!detailLoading && rowsSlice.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ padding: "16px", textAlign: "center" }} className="muted">
                            No records found in the selected date range.
                          </td>
                        </tr>
                      )}
                      {!detailLoading &&
                        rowsSlice.map((r) => {
                          const date = r.sale_at || r.purchase_at || r.created_at;
                          const code = r.sale_id || r.purchase_id || "—";
                          const isPending = r.balance > 0;
                          return (
                            <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                              <td style={{ padding: "12px", whiteSpace: "nowrap" }}>{formatDate(date)}</td>
                              <td
                                style={{
                                  padding: "12px",
                                  maxWidth: "200px",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {code}
                              </td>
                              <td
                                style={{
                                  padding: "12px",
                                  textAlign: "right",
                                  fontFamily: "monospace",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {fmtINR(r.total)}
                              </td>
                              <td
                                style={{
                                  padding: "12px",
                                  textAlign: "right",
                                  fontFamily: "monospace",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {fmtINR(r.paid)}
                              </td>
                              <td
                                style={{
                                  padding: "12px",
                                  textAlign: "right",
                                  fontFamily: "monospace",
                                  color: isPending ? "#b91c1c" : "#334155",
                                  fontWeight: isPending ? 600 : 400,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {fmtINR(r.balance)}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <Pager page={rowsPage} totalPages={rowsTotalPages} setPage={setRowsPage} />
              </div>

              {/* Transaction History */}
              <div style={{ marginTop: "24px" }}>
                <div className="modal-title" style={{ marginBottom: "12px" }}>
                  Transaction History
                </div>
                <div className="table-wrap" style={{ overflowX: "auto" }}>
                  <div style={{ minWidth: "600px" }}>
                    <table className="tbl" style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={{ padding: "12px 16px", backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", textAlign: "left", fontWeight: 600, fontSize: "0.875rem", color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Date & Time
                          </th>
                          <th style={{ padding: "12px 16px", backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", textAlign: "right", fontWeight: 600, fontSize: "0.875rem", color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Amount
                          </th>
                          <th style={{ padding: "12px 16px", backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", textAlign: "left", fontWeight: 600, fontSize: "0.875rem", color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Notes
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailLoading ? (
                          <tr>
                            <td colSpan={3} style={{ padding: "16px", textAlign: "center" }}>
                              Loading transactions...
                            </td>
                          </tr>
                        ) : histSlice.length === 0 ? (
                          <tr>
                            <td colSpan={3} style={{ padding: "16px", textAlign: "center" }} className="muted">
                              No transactions found in the selected period.
                            </td>
                          </tr>
                        ) : (
                          histSlice.map((payment) => (
                            <tr key={`hist-${payment.type}-${payment.id}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                              <td style={{ padding: "14px 16px", verticalAlign: "middle", fontSize: "0.9375rem", color: "#1e293b", whiteSpace: "nowrap" }}>
                                {formatDate(payment.date)}
                              </td>
                              <td style={{ padding: "14px 16px", verticalAlign: "middle", fontSize: "0.9375rem", color: "#1e293b", textAlign: "right", fontFamily: "monospace" }}>
                                {fmtINR(payment.amount)}
                              </td>
                              <td style={{ padding: "14px 16px", verticalAlign: "middle", fontSize: "0.9375rem", color: "#64748b" }}>
                                {payment.notes || "—"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={histPage} totalPages={histTotalPages} setPage={setHistPage} />
                </div>
              </div>

              <div className="modal-actions between">
                <button className="btn modal-btn width-100 margin-bottom" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </NavFrame>
  );
}
