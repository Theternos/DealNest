// ledger.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { createPortal } from "react-dom";
import "../styles/clients.css";
import NavFrame from "./nav";
import { getSession } from "./login";

/** ---------- IST (Asia/Kolkata) helpers ---------- **/
const IST_TZ = "Asia/Kolkata";

// Convert a JS Date (UTC) → "YYYY-MM-DDTHH:mm" string in IST for <input type="datetime-local">
function dateToISTInputValue(date) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: IST_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    const parts = fmt.format(date).split(", "); // ["YYYY-MM-DD", "HH:mm"]
    return `${parts[0]}T${parts[1]}`;
}
function istInputToUTCDate(inputValue /* "YYYY-MM-DDTHH:mm" */) {
    if (!inputValue) return null;
    return new Date(inputValue + ":00+05:30");
}
function istNowInput() {
    return dateToISTInputValue(new Date());
}
function inrFmt(n) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(n || 0));
}

/** ---------- Date range presets ---------- **/
const PRESETS = [
    { id: "ALL_TIME", label: "All time" },
    { id: "TODAY", label: "Today" },
    { id: "YESTERDAY", label: "Yesterday" },
    { id: "THIS_WEEK", label: "This week" },
    { id: "LAST_WEEK", label: "Last week" },
    { id: "THIS_MONTH", label: "This month" },
    { id: "LAST_MONTH", label: "Last month" },
    { id: "LAST_30", label: "Last 30 days" },
    { id: "THIS_YEAR", label: "This year" },
    { id: "LAST_YEAR", label: "Last year" },
    { id: "CUSTOM", label: "Custom range" },
];

function presetToRange(presetId) {
    const now = new Date();
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

    let start, end;

    switch (presetId) {
        case "ALL_TIME":
            start = null; end = null; break;
        case "TODAY":
            start = startOfDay(now); end = endOfDay(now); break;
        case "YESTERDAY": {
            const y = new Date(now); y.setDate(y.getDate() - 1);
            start = startOfDay(y); end = endOfDay(y); break;
        }
        case "THIS_WEEK": {
            const d = new Date(now);
            const day = d.getDay(); // 0 Sun … 6 Sat
            const diffToMon = (day + 6) % 7;
            const monday = new Date(d); monday.setDate(d.getDate() - diffToMon);
            start = startOfDay(monday);
            const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
            end = endOfDay(sunday);
            break;
        }
        case "LAST_WEEK": {
            const d = new Date(now);
            const day = d.getDay();
            const diffToMon = (day + 6) % 7;
            const mondayThis = new Date(d); mondayThis.setDate(d.getDate() - diffToMon);
            const mondayLast = new Date(mondayThis); mondayLast.setDate(mondayThis.getDate() - 7);
            start = startOfDay(mondayLast);
            const sundayLast = new Date(mondayLast); sundayLast.setDate(mondayLast.getDate() + 6);
            end = endOfDay(sundayLast);
            break;
        }
        case "THIS_MONTH": {
            start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            break;
        }
        case "LAST_MONTH": {
            start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
            break;
        }
        case "LAST_30": {
            start = new Date(now); start.setDate(start.getDate() - 29); start = startOfDay(start);
            end = endOfDay(now);
            break;
        }
        case "THIS_YEAR":
            start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
            end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
            break;
        case "LAST_YEAR":
            start = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0, 0);
            end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
            break;
        default:
            start = null; end = null;
    }

    return { start, end };
}

const STATUS_FILTERS = [
    { id: "ALL", label: "All" },
    { id: "PAID", label: "Paid" },
    { id: "PENDING", label: "Pending" },
];

// small helper
function paginate(list, page, pageSize) {
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const clampedPage = Math.min(Math.max(1, page), totalPages);
    const from = (clampedPage - 1) * pageSize;
    const to = from + pageSize;
    return { slice: list.slice(from, to), page: clampedPage, total, totalPages };
}

/** ---------- UI ---------- **/
export default function Ledger() {
    const session = getSession();
    const isSalesUser = session?.role === 'sales';
    const currentUsername = session?.username;
    
    const [tab, setTab] = useState(isSalesUser ? "SALES" : "SALES"); // SALES | PURCHASES
    
    // Ensure sales users can't access purchases tab
    useEffect(() => {
        if (isSalesUser && tab === 'PURCHASES') {
            setTab('SALES');
        }
    }, [isSalesUser, tab]);
    
    const [status, setStatus] = useState("ALL");
    const [preset, setPreset] = useState("ALL_TIME");
    const [{ start, end }, setRange] = useState(presetToRange("ALL_TIME"));
    const [customStart, setCustomStart] = useState("");
    const [customEnd, setCustomEnd] = useState("");

    // NEW: party search (Customer/Vendor)
    const [partySearch, setPartySearch] = useState("");

    // data
    const [loading, setLoading] = useState(false);
    const [sales, setSales] = useState([]);              // [{sale, items, total, paid, balance, client}]
    const [purchases, setPurchases] = useState([]);      // [{purchase, items, total, paid, balance, vendor}]
    const [payments, setPayments] = useState([]);        // unified transaction history

    // selections/modals
    const [recordOpen, setRecordOpen] = useState(false);
    const [target, setTarget] = useState(null); // {kind:'SALE'|'PURCHASE', id, code, partyName, balance}
    const [pay, setPay] = useState({ amount: "", paid_at: istNowInput(), notes: "" });

    // view modal
    const [viewOpen, setViewOpen] = useState(false);
    const [view, setView] = useState(null); // { kind, row, txns: [] }

    // totals
    const totalReceivable = useMemo(() => sales.reduce((s, r) => s + Math.max(0, r.balance), 0), [sales]);
    const totalPayable = useMemo(() => purchases.reduce((s, r) => s + Math.max(0, r.balance), 0), [purchases]);

    // Pagination state (use existing .pager CSS)
    const PAGE_SIZE = 10;
    const [salesPage, setSalesPage] = useState(1);
    const [purchPage, setPurchPage] = useState(1);
    const [payPage, setPayPage] = useState(1);

    // reset pages when filters/search/tab change
    useEffect(() => { setSalesPage(1); setPurchPage(1); setPayPage(1); }, [status, preset, customStart, customEnd, partySearch, tab]);

    // update range on preset change
    useEffect(() => {
        if (preset === "CUSTOM") {
            setRange({ start: customStart ? new Date(customStart) : null, end: customEnd ? new Date(customEnd) : null });
        } else {
            setRange(presetToRange(preset));
        }
    }, [preset, customStart, customEnd]);

    // fetch everything (kept same behavior; payments are not date-filtered)
    useEffect(() => {
        fetchAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [preset, start?.toISOString?.(), end?.toISOString?.()]);

    async function fetchAll() {
        setLoading(true);

        // date filter field for bills: sale_at / purchase_at
        const saleQuery = supabase
            .from("sales")
            .select("id,sale_id,client_id,sale_at,with_tax,description,created_by")
            .order("sale_at", { ascending: false });

        const purchaseQuery = supabase
            .from("purchases")
            .select("id,purchase_id,vendor_id,purchase_at,description,created_by")
            .order("purchase_at", { ascending: false });

        // Add user-based filtering for sales users
        if (isSalesUser && currentUsername) {
            saleQuery.eq("created_by", currentUsername);
            purchaseQuery.eq("created_by", currentUsername);
        }

        if (start && end) {
            saleQuery.gte("sale_at", start.toISOString()).lte("sale_at", end.toISOString());
            purchaseQuery.gte("purchase_at", start.toISOString()).lte("purchase_at", end.toISOString());
        }

        const [{ data: salesRows }, { data: purchaseRows }] = await Promise.all([saleQuery, purchaseQuery]);

        // fetch items for totals
        const salesIds = (salesRows || []).map(s => s.id);
        const purchaseIds = (purchaseRows || []).map(p => p.id);

        const [{ data: saleItems }, { data: purchaseItems }] = await Promise.all([
            salesIds.length
                ? supabase.from("sales_items").select("sale_id,quantity,unit_price,tax_rate").in("sale_id", salesIds)
                : { data: [] },
            purchaseIds.length
                ? supabase.from("purchase_items").select("purchase_id,quantity,unit_price,line_subtotal,freight_charge_split,tax_rate").in("purchase_id", purchaseIds)
                : { data: [] },
        ]);

        // fetch payments for mapping
        const [{ data: salePays }, { data: purchPays }] = await Promise.all([
            salesIds.length ? supabase.from("payments").select("sale_id,amount").eq("kind", "SALE").in("sale_id", salesIds) : { data: [] },
            purchaseIds.length ? supabase.from("payments").select("purchase_id,amount").eq("kind", "PURCHASE").in("purchase_id", purchaseIds) : { data: [] },
        ]);

        // clients/vendors
        const [{ data: clients }, { data: vendors }] = await Promise.all([
            supabase.from("clients").select("id,name"),
            supabase.from("vendors").select("id,name").order("name"),
        ]);

        // compute totals for sales
        const saleMapItems = new Map();
        (saleItems || []).forEach(li => {
            const arr = saleMapItems.get(li.sale_id) || [];
            arr.push(li);
            saleMapItems.set(li.sale_id, arr);
        });
        const saleMapPaid = new Map();
        (salePays || []).forEach(p => {
            saleMapPaid.set(p.sale_id, (saleMapPaid.get(p.sale_id) || 0) + Number(p.amount || 0));
        });

        const salesEnriched = (salesRows || []).map(s => {
            const items = saleMapItems.get(s.id) || [];
            let sub = 0, tax = 0;
            for (const ln of items) {
                const q = Number(ln.quantity || 0);
                const rate = Number(ln.unit_price || 0);
                const taxable = q * rate;
                sub += taxable;
                const pct = (s.with_tax && ln.tax_rate && ln.tax_rate.endsWith("%")) ? parseFloat(ln.tax_rate) / 100 : 0;
                tax += taxable * pct;
            }
            const total = sub + tax;
            const paid = saleMapPaid.get(s.id) || 0;
            const balance = Math.max(0, total - paid);
            return {
                id: s.id,
                code: s.sale_id,
                at: s.sale_at,
                with_tax: s.with_tax,
                description: s.description || "",
                partyName: clients?.find(c => c.id === s.client_id)?.name || "-",
                client_id: s.client_id, // keep for reference, though not required by new logic
                created_by: s.created_by, // Add created_by for display if needed
                items,
                sub, tax, total, paid, balance,
            };
        });

        // compute totals for purchases
        const purchMapItems = new Map();
        (purchaseItems || []).forEach(li => {
            const arr = purchMapItems.get(li.purchase_id) || [];
            arr.push(li);
            purchMapItems.set(li.purchase_id, arr);
        });
        const purchMapPaid = new Map();
        (purchPays || []).forEach(p => {
            purchMapPaid.set(p.purchase_id, (purchMapPaid.get(p.purchase_id) || 0) + Number(p.amount || 0));
        });

        const purchasesEnriched = (purchaseRows || []).map(p => {
            const items = purchMapItems.get(p.id) || [];
            let sub = 0, tax = 0;
            for (const ln of items) {
                const taxable = ln.line_subtotal != null ? Number(ln.line_subtotal) : Number(ln.quantity || 0) * Number(ln.unit_price || 0);
                const freight = Number(ln.freight_charge_split || 0);
                const base = taxable + freight;
                sub += base;
                const pctRaw = (typeof ln.tax_rate === "string" && ln.tax_rate.endsWith("%")) ? parseFloat(ln.tax_rate) / 100 : Number(ln.tax_rate || 0) / 100;
                const pct = isNaN(pctRaw) ? 0 : pctRaw;
                tax += base * pct;
            }
            const total = sub + tax;
            const paid = purchMapPaid.get(p.id) || 0;
            const balance = Math.max(0, total - paid);
            return {
                id: p.id,
                code: p.purchase_id,
                at: p.purchase_at,
                description: p.description || "",
                partyName: (vendors?.find(v => v.id === p.vendor_id)?.name) || "-",
                created_by: p.created_by, // Add created_by for display if needed
                items,
                sub, tax, total, paid, balance,
            };
        });

        setSales(salesEnriched);
        setPurchases(purchasesEnriched);

        // transaction history - filter by user role for payments too
        let paymentQuery = supabase
            .from("payments")
            .select("id,kind,sale_id,purchase_id,amount,paid_at,notes,created_at,created_by")
            .order("paid_at", { ascending: false });

        // For sales users, filter payments to only show those related to their sales/purchases
        if (isSalesUser && currentUsername) {
            // Get IDs of sales and purchases created by this user
            const userSaleIds = salesEnriched.map(s => s.id);
            const userPurchaseIds = purchasesEnriched.map(p => p.id);
            
            paymentQuery = paymentQuery
                .or(`sale_id.in.(${userSaleIds.join(',')}),purchase_id.in.(${userPurchaseIds.join(',')})`);
        }

        const { data: tx } = await paymentQuery;
        setPayments(tx || []);

        setLoading(false);
    }

    // filter computed rows by status + party search
    const filteredSales = useMemo(() => {
        const term = (partySearch || "").toLowerCase();
        return sales.filter(r => {
            if (status === "PAID") {
                if (r.balance > 0.009) return false;
            } else if (status === "PENDING") {
                if (r.balance <= 0.009) return false;
            }
            if (term && !r.partyName.toLowerCase().includes(term)) return false;
            return true;
        });
    }, [sales, status, partySearch]);

    const filteredPurchases = useMemo(() => {
        const term = (partySearch || "").toLowerCase();
        return purchases.filter(r => {
            if (status === "PAID") {
                if (r.balance > 0.009) return false;
            } else if (status === "PENDING") {
                if (r.balance <= 0.009) return false;
            }
            if (term && !r.partyName.toLowerCase().includes(term)) return false;
            return true;
        });
    }, [purchases, status, partySearch]);

    // Apply pagination
    const salesPaged = useMemo(() => paginate(filteredSales, salesPage, PAGE_SIZE), [filteredSales, salesPage]);
    const purchPaged = useMemo(() => paginate(filteredPurchases, purchPage, PAGE_SIZE), [filteredPurchases, purchPage]);
    const paysPaged = useMemo(() => paginate(payments, payPage, PAGE_SIZE), [payments, payPage]);

    function openRecord(kind, row) {
        // Default amount = pending balance for that bill
        setTarget({ kind, id: row.id, code: row.code, partyName: row.partyName, balance: row.balance });
        setPay({ amount: String(Number(row.balance || 0).toFixed(2)), paid_at: istNowInput(), notes: "" });
        setRecordOpen(true);
    }

    function openView(kind, row) {
        const txns = (payments || []).filter(t => kind === "SALE" ? t.sale_id === row.id : t.purchase_id === row.id);
        setView({ kind, row, txns });
        setViewOpen(true);
    }

    // >>>>> UPDATED: Include created_by in payment payload <<<<<
    async function savePayment(e) {
        e.preventDefault();
        if (!target) return;
        const amount = Number(pay.amount);
        if (!amount || amount <= 0) { alert("Enter a valid amount"); return; }

        const payload = {
            kind: target.kind,
            amount,
            paid_at: istInputToUTCDate(pay.paid_at) || new Date(),
            notes: pay.notes?.trim() || null,
            sale_id: target.kind === "SALE" ? target.id : null,
            purchase_id: target.kind === "PURCHASE" ? target.id : null,
            created_by: currentUsername, // Add created_by with current username
        };

        // 1) insert payment
        const { error } = await supabase.from("payments").insert([payload]);
        if (error) { alert("Failed to record payment"); console.error(error); return; }

        // 2) If SALE, subtract amount from the related client's credit
        if (target.kind === "SALE") {
            // get the sale's client_id
            const { data: saleRow, error: es } = await supabase
                .from("sales")
                .select("client_id")
                .eq("id", target.id)
                .single();
            if (!es && saleRow?.client_id) {
                // fetch current credit
                const { data: clientRow, error: ec } = await supabase
                    .from("clients")
                    .select("credit")
                    .eq("id", saleRow.client_id)
                    .single();
                if (!ec) {
                    const current = Number(clientRow?.credit ?? 0);
                    const newCredit = current - amount; // subtract
                    const { error: eu } = await supabase
                        .from("clients")
                        .update({ credit: newCredit })
                        .eq("id", saleRow.client_id);
                    if (eu) {
                        console.error("Failed to update client credit", eu);
                        // Not blocking the flow; payment already recorded.
                    }
                } else {
                    console.error("Failed to fetch client credit", ec);
                }
            } else {
                console.error("Failed to fetch sale->client_id", es);
            }
        }
        // <<<<< END CHANGE

        setRecordOpen(false);
        await fetchAll();
    }

    // open bill helpers (sales invoice exists already)
    function openSaleBill(row) {
        window.alert(`Open Sales Bill ${row.code} for ${row.partyName}`);
    }
    function openPurchaseBill(row) {
        window.alert(`Open Purchase Bill ${row.code} for ${row.partyName}`);
    }

    // formatted date range preview
    const rangePreview = start && end
        ? `${start.toLocaleDateString("en-IN")} → ${end.toLocaleDateString("en-IN")}`
        : "";

    return (
        <NavFrame>
            <div className="wrap">
                <header className="bar">
                    <h1 className="title">Ledger</h1>
                    <div className="muted">
                        Receivable Pending: <b>{inrFmt(totalReceivable)}</b> • Payable Pending: <b>{inrFmt(totalPayable)}</b>
                        {isSalesUser && (
                            <span style={{ marginLeft: '16px', fontSize: '0.9em', color: '#666' }}>
                                (Viewing only your records)
                            </span>
                        )}
                    </div>
                </header>

                {/* Tabs */}
                <div className="tabs" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button className={`btn ${tab === "SALES" ? "primary" : ""} modal-btn`} onClick={() => setTab("SALES")}>Sales</button>
                    {!isSalesUser && (
                        <button 
                            className={`btn ${tab === "PURCHASES" ? "primary" : ""} modal-btn`} 
                            onClick={() => setTab("PURCHASES")}
                        >
                            Purchases
                        </button>
                    )}
                </div>

                {/* Toolbar (new responsive, no inline styles) */}
                <div className="ledger-toolbar margin-bottom">
                    {/* Left: Status + search */}
                    <div className="ledger-toolbar__left">
                        <div className="muted ledger-toolbar__label">Status</div>
                        <select
                            className="input"
                            value={status}
                            onChange={(e) => setStatus(e.target.value)}
                        >
                            {STATUS_FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                        </select>

                        <input
                            className="input"
                            placeholder="Search customer / vendor…"
                            value={partySearch}
                            onChange={(e) => setPartySearch(e.target.value)}
                        />
                    </div>

                    {/* Middle: Date presets + custom range */}
                    <div className="ledger-toolbar__range">
                        <select
                            className="input"
                            value={preset}
                            onChange={(e) => setPreset(e.target.value)}
                        >
                            {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>

                        {preset === "CUSTOM" && (
                            <>
                                <input
                                    className="input"
                                    type="date"
                                    value={customStart}
                                    onChange={(e) => setCustomStart(e.target.value)}
                                />
                                <input
                                    className="input"
                                    type="date"
                                    value={customEnd}
                                    onChange={(e) => setCustomEnd(e.target.value)}
                                />
                            </>
                        )}
                    </div>

                    {/* Right: Refresh */}
                    <div className="ledger-toolbar__actions">
                        <button className="btn" onClick={fetchAll}>Refresh</button>
                    </div>
                </div>


                {/* Tables */}
                <div className="card">
                    <div className="table-wrap">
                        {tab === "SALES" ? (
                            <table className="tbl">
                                <thead>
                                    <tr>
                                        <th>Sale ID</th>
                                        <th>Client</th>
                                        <th>Date</th>
                                        {!isSalesUser && <th>Created By</th>}
                                        <th className="right">Total</th>
                                        <th className="right">Paid</th>
                                        <th className="right">Balance</th>
                                        <th className="right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && <tr><td colSpan={isSalesUser ? "7" : "8"} className="muted center">Loading…</td></tr>}
                                    {!loading && salesPaged.total === 0 && <tr><td colSpan={isSalesUser ? "7" : "8"} className="muted center">No records</td></tr>}
                                    {!loading && salesPaged.slice.map(r => (
                                        <tr key={r.id}>
                                            <td data-th="Sale ID">{r.code}</td>
                                            <td data-th="Client">{r.partyName}</td>
                                            <td data-th="Date">{new Date(r.at).toLocaleString("en-IN", { timeZone: IST_TZ })}</td>
                                            {!isSalesUser && <td data-th="Created By">{r.created_by || "-"}</td>}
                                            <td className="right" data-th="Total">{inrFmt(r.total)}</td>
                                            <td className="right" data-th="Paid">{inrFmt(r.paid)}</td>
                                            <td className="right" data-th="Balance" style={{ fontWeight: 600 }}>{inrFmt(r.balance)}</td>
                                            <td className="right" data-th="Actions">
                                                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                                                    {r.balance > 0.009 ? (
                                                        <>
                                                            <button className="btn" onClick={() => openView("SALE", r)}>View</button>
                                                            <button className="btn primary" onClick={() => openRecord("SALE", r)}>Record Receipt</button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button className="btn" onClick={() => openView("SALE", r)}>View</button>
                                                            <button disabled className="btn primary">Record Receipt</button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <table className="tbl">
                                <thead>
                                    <tr>
                                        <th>Purchase ID</th>
                                        <th>Vendor</th>
                                        <th>Date</th>
                                        {!isSalesUser && <th>Created By</th>}
                                        <th className="right">Total</th>
                                        <th className="right">Paid</th>
                                        <th className="right">Balance</th>
                                        <th className="right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && <tr><td colSpan={isSalesUser ? "7" : "8"} className="muted center">Loading…</td></tr>}
                                    {!loading && purchPaged.total === 0 && <tr><td colSpan={isSalesUser ? "7" : "8"} className="muted center">No records</td></tr>}
                                    {!loading && purchPaged.slice.map(r => (
                                        <tr key={r.id}>
                                            <td data-th="Purchase ID">{r.code}</td>
                                            <td data-th="Vendor">{r.partyName}</td>
                                            <td data-th="Date">{new Date(r.at).toLocaleString("en-IN", { timeZone: IST_TZ })}</td>
                                            {!isSalesUser && <td data-th="Created By">{r.created_by || "-"}</td>}
                                            <td className="right" data-th="Total">{inrFmt(r.total)}</td>
                                            <td className="right" data-th="Paid">{inrFmt(r.paid)}</td>
                                            <td className="right" data-th="Balance" style={{ fontWeight: 600 }}>{inrFmt(r.balance)}</td>
                                            <td className="right" data-th="Actions">
                                                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                                                    {r.balance > 0.009 ? (
                                                        <>
                                                            <button className="btn" onClick={() => openView("PURCHASE", r)}>View</button>
                                                            <button className="btn primary" onClick={() => openRecord("PURCHASE", r)}>Record Payment</button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button className="btn" onClick={() => openView("PURCHASE", r)}>View</button>
                                                            <button disabled className="btn primary">Record Payment</button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Table pagination footer */}
                    <div className="pager">
                        <div className="muted">
                            {tab === "SALES"
                                ? <>{salesPaged.total} total • Page {salesPaged.page} of {salesPaged.totalPages}</>
                                : <>{purchPaged.total} total • Page {purchPaged.page} of {purchPaged.totalPages}</>
                            }
                        </div>
                        <div className="pager-controls">
                            {tab === "SALES" ? (
                                <>
                                    <button className="btn" onClick={() => setSalesPage(p => Math.max(1, p - 1))} disabled={salesPaged.page <= 1}>Prev</button>
                                    <button className="btn" onClick={() => setSalesPage(p => Math.min(salesPaged.totalPages, p + 1))} disabled={salesPaged.page >= salesPaged.totalPages}>Next</button>
                                </>
                            ) : (
                                <>
                                    <button className="btn" onClick={() => setPurchPage(p => Math.max(1, p - 1))} disabled={purchPaged.page <= 1}>Prev</button>
                                    <button className="btn" onClick={() => setPurchPage(p => Math.min(purchPaged.totalPages, p + 1))} disabled={purchPaged.page >= purchPaged.totalPages}>Next</button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Transaction History (global) */}
                <div className="card margin-bottom" style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 8, marginTop: 12, paddingLeft: 12 }}>Transaction History</div>
                    <div className="table-wrap">
                        <table className="tbl">
                            <thead>
                                <tr>
                                    <th>Type</th>
                                    <th>Bill</th>
                                    <th>Date</th>
                                    {!isSalesUser && <th>Created By</th>}
                                    <th className="right">Amount</th>
                                    <th>Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paysPaged.total === 0 ? (
                                    <tr><td colSpan={isSalesUser ? "5" : "6"} className="muted center">No transactions</td></tr>
                                ) : paysPaged.slice.filter(t => !isSalesUser || t.kind !== "PURCHASE").length === 0 ? (
                                    <tr><td colSpan={isSalesUser ? "5" : "6"} className="muted center">No transactions to display</td></tr>
                                ) : (
                                    paysPaged.slice
                                        .filter(t => !isSalesUser || t.kind !== "PURCHASE")
                                        .map(t => {
                                            const saleRow = sales.find(s => s.id === t.sale_id);
                                            const purchRow = purchases.find(p => p.id === t.purchase_id);
                                            const billCode = t.kind === "SALE" ? (saleRow?.code || "—") : (purchRow?.code || "—");
                                            const party = t.kind === "SALE" ? (saleRow?.partyName || "") : (purchRow?.partyName || "");
                                            return (
                                                <tr key={t.id}>
                                                    <td data-th="Type">{t.kind === "SALE" ? "Receipt" : "Payment"}</td>
                                                    <td data-th="Bill">{billCode} {party ? `• ${party}` : ""}</td>
                                                    <td data-th="Date">{new Date(t.paid_at).toLocaleString("en-IN", { timeZone: IST_TZ })}</td>
                                                    {!isSalesUser && <td data-th="Created By">{t.created_by || "-"}</td>}
                                                    <td
                                                        className={`right txn-amt ${t.kind === "SALE" ? "txn-amt--in" : "txn-amt--out"}`}
                                                        data-th="Amount"
                                                    >
                                                        {inrFmt(t.amount)}
                                                    </td>
                                                    <td data-th="Notes">{t.notes || "-"}</td>
                                                </tr>
                                            );
                                        })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Transactions pagination */}
                    <div className="pager">
                        <div className="muted">
                            {paysPaged.total} total • Page {paysPaged.page} of {paysPaged.totalPages}
                        </div>
                        <div className="pager-controls">
                            <button className="btn" onClick={() => setPayPage(p => Math.max(1, p - 1))} disabled={paysPaged.page <= 1}>Prev</button>
                            <button className="btn" onClick={() => setPayPage(p => Math.min(paysPaged.totalPages, p + 1))} disabled={paysPaged.page >= paysPaged.totalPages}>Next</button>
                        </div>
                    </div>
                </div>

                {/* Record Payment / Receipt Modal */}
                {recordOpen && target && (
                    <div className="modal">
                        <div className="modal-card">
                            <div className="modal-head">
                                <h2 className="modal-title">
                                    {target.kind === "SALE" ? "Record Receipt" : "Record Payment"}
                                </h2>
                                <button className="btn icon" onClick={() => setRecordOpen(false)} aria-label="Close">×</button>
                            </div>

                            <form onSubmit={savePayment}>
                                <div className="details-grid">
                                    <div className="details-col">
                                        <div className="detail-row">
                                            <div className="detail-label">Bill</div>
                                            <div className="detail-value">{target.code}</div>
                                        </div>
                                        <div className="detail-row">
                                            <div className="detail-label">{target.kind === "SALE" ? "Client" : "Vendor"}</div>
                                            <div className="detail-value">{target.partyName}</div>
                                        </div>
                                    </div>
                                    <div className="details-col">
                                        <div className="detail-row">
                                            <div className="detail-label">Pending</div>
                                            <div className="detail-value">{inrFmt(target.balance || 0)}</div>
                                        </div>
                                        <label className="detail-row">
                                            <span className="detail-label">Paid At *</span>
                                            <input className="detail-value" type="datetime-local" required value={pay.paid_at} onChange={(e) => setPay(p => ({ ...p, paid_at: e.target.value }))} />
                                        </label>
                                    </div>
                                </div>

                                <label className="lbl">
                                    <span className="lbl-text">Amount *</span>
                                    <input className="input" type="number" step="0.01" required value={pay.amount} onChange={(e) => setPay(p => ({ ...p, amount: e.target.value }))} />
                                </label>

                                <label className="lbl">
                                    <span className="lbl-text">Notes</span>
                                    <input className="input" maxLength={200} value={pay.notes} onChange={(e) => setPay(p => ({ ...p, notes: e.target.value }))} />
                                </label>

                                <div className="modal-actions between margin-bottom" style={{ marginTop: 8 }}>
                                    <div className="muted">Defaulted to pending amount. Adjust if part-payment.</div>
                                </div>
                                <div className="modal-actions margin-bottom">
                                    <button type="button" className="btn modal-btn" onClick={() => setRecordOpen(false)}>Cancel</button>
                                    <button type="submit" className="btn modal-btn primary">Save</button>
                                </div>
                            </form>

                        </div>
                    </div>
                )}

                {/* View Bill & Transactions Modal */}
                {viewOpen && view && (
                    <div className="modal">
                        <div className="modal-card">
                            <div className="modal-head">
                                <h2 className="modal-title">{view.kind === "SALE" ? "Sale" : "Purchase"} — {view.row.code}</h2>
                                <button className="btn icon" onClick={() => setViewOpen(false)} aria-label="Close">×</button>
                            </div>

                            <div className="details-grid">
                                <div className="details-col">
                                    <div className="detail-row"><div className="detail-label">Party</div><div className="detail-value">{view.row.partyName}</div></div>
                                    <div className="detail-row"><div className="detail-label">Date</div><div className="detail-value">{new Date(view.row.at).toLocaleString("en-IN", { timeZone: IST_TZ })}</div></div>
                                    <div className="detail-row"><div className="detail-label">Description</div><div className="detail-value">{view.row.description || "-"}</div></div>
                                    {!isSalesUser && <div className="detail-row"><div className="detail-label">Created By</div><div className="detail-value">{view.row.created_by || "-"}</div></div>}
                                    <div className="detail-row"><div className="detail-label">Balance</div><div className="detail-value" style={{ fontWeight: 700 }}>{inrFmt(view.row.balance)}</div></div>
                                </div>
                                <div className="details-col">
                                    <div className="detail-row"><div className="detail-label">Subtotal</div><div className="detail-value">{inrFmt(view.row.sub)}</div></div>
                                    <div className="detail-row"><div className="detail-label">Tax</div><div className="detail-value">{inrFmt(view.row.tax)}</div></div>
                                    <div className="detail-row"><div className="detail-label">Total</div><div className="detail-value">{inrFmt(view.row.total)}</div></div>
                                    <div className="detail-row"><div className="detail-label">Paid</div><div className="detail-value">{inrFmt(view.row.paid)}</div></div>
                                </div>
                            </div>

                            <div className="table-wrap margin-bottom" style={{ marginTop: 8 }}>
                                <div style={{ fontWeight: 700, marginBottom: 6 }}>Transactions</div>
                                <table className="tbl margin-bottom">
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            {!isSalesUser && <th>Created By</th>}
                                            <th className="right">Amount</th>
                                            <th>Notes</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {view.txns.length === 0 && <tr><td colSpan={isSalesUser ? "3" : "4"} className="muted center">No transactions</td></tr>}
                                        {view.txns.map(t => (
                                            <tr key={t.id}>
                                                <td data-th="Date">{new Date(t.paid_at).toLocaleString("en-IN", { timeZone: IST_TZ })}</td>
                                                {!isSalesUser && <td data-th="Created By">{t.created_by || "-"}</td>}
                                                <td className="right" data-th="Amount">{inrFmt(t.amount)}</td>
                                                <td data-th="Notes">{t.notes || "-"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="modal-actions margin-bottom">
                                <button className="btn modal-btn" onClick={() => setViewOpen(false)}>Close</button>
                                {view.row.balance > 0.009 && (
                                    <button className="btn modal-btn primary" onClick={() => { setViewOpen(false); openRecord(view.kind, view.row); }}>
                                        Record {view.kind === "SALE" ? "Receipt" : "Payment"}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </NavFrame>
    );
}

/* ===== Minimal portal select (reuse if you want advanced pickers) ===== */
function SearchSelect({ options, valueId, onChange, placeholder = "Search…" }) {
    const [open, setOpen] = useState(false);
    const [term, setTerm] = useState("");
    const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
    const inputRef = useRef(null);
    const containerRef = useRef(null);

    const valueLabel = useMemo(() => options.find(o => o.id === valueId)?.label || "", [options, valueId]);
    useEffect(() => { setTerm(valueLabel); }, [valueLabel]);

    function updatePosition() {
        const el = inputRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }

    useEffect(() => {
        if (!open) return;
        updatePosition();
        const onScroll = () => updatePosition();
        const onResize = () => updatePosition();
        const onDoc = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target) && !inputRef.current.contains(e.target)) setOpen(false);
        };
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", onResize);
        document.addEventListener("mousedown", onDoc);
        return () => {
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", onResize);
            document.removeEventListener("mousedown", onDoc);
        };
    }, [open]);

    const filtered = useMemo(() => {
        const t = (term || "").toLowerCase();
        return options.filter(o => o.label.toLowerCase().includes(t)).slice(0, 120);
    }, [options, term]);

    return (
        <div style={{ position: "relative" }}>
            <input
                ref={inputRef}
                className="input"
                placeholder={placeholder}
                value={term}
                onFocus={() => { setOpen(true); updatePosition(); }}
                onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
            />
            {open && createPortal(
                <div ref={containerRef} className="search-dropdown-portal" style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}>
                    {filtered.length === 0 && <div className="search-option muted">No matches</div>}
                    {filtered.map(opt => (
                        <div key={opt.id} className="search-option" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange?.(opt); setTerm(opt.label); setOpen(false); }}>
                            {opt.label}
                        </div>
                    ))}
                    {valueId && (
                        <div className="search-option" style={{ color: "#b91c1c", fontWeight: 500 }}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { onChange?.(null); setTerm(""); setOpen(false); }}>
                            Clear selection
                        </div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}