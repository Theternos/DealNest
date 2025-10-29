// orders.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { createPortal } from "react-dom";
import "../styles/clients.css";
import NavFrame from "./nav";

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
    const parts = fmt.format(date).split(", ");
    return `${parts[0]}T${parts[1]}`;
}

// Parse an <input type="datetime-local"> (assume IST) → JS Date (UTC)
function istInputToUTCDate(inputValue /* "YYYY-MM-DDTHH:mm" */) {
    if (!inputValue) return null;
    return new Date(inputValue + ":00+05:30");
}

// Convenience: now() in IST for inputs
function istNowInput() {
    return dateToISTInputValue(new Date());
}

// ----- Date range presets (IST-aware) -----
function startOfDayIST(d) {
    const s = new Date(d);
    return new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0, 0);
}
function endOfDayIST(d) {
    const s = new Date(d);
    return new Date(s.getFullYear(), s.getMonth(), s.getDate(), 23, 59, 59, 999);
}
// Make a Date from "YYYY-MM-DD" in IST
function istDateFromInput(yyyy_mm_dd) {
    if (!yyyy_mm_dd) return null;
    return new Date(`${yyyy_mm_dd}T00:00:00+05:30`);
}
function getPresetRangeIST(preset) {
    const now = new Date(); // current time
    const today = new Date(now.toLocaleString("en-US", { timeZone: IST_TZ }));
    const dow = (today.getDay() + 6) % 7; // Mon=0 ... Sun=6

    let start, end;

    switch (preset) {
        case "TODAY":
            start = startOfDayIST(today);
            end = endOfDayIST(today);
            break;
        case "YESTERDAY": {
            const y = new Date(today);
            y.setDate(y.getDate() - 1);
            start = startOfDayIST(y);
            end = endOfDayIST(y);
            break;
        }
        case "THIS_WEEK": {
            const monday = new Date(today);
            monday.setDate(monday.getDate() - dow);
            const sunday = new Date(monday);
            sunday.setDate(sunday.getDate() + 6);
            start = startOfDayIST(monday);
            end = endOfDayIST(sunday);
            break;
        }
        case "LAST_WEEK": {
            const monday = new Date(today);
            monday.setDate(monday.getDate() - dow - 7);
            const sunday = new Date(monday);
            sunday.setDate(sunday.getDate() + 6);
            start = startOfDayIST(monday);
            end = endOfDayIST(sunday);
            break;
        }
        case "THIS_MONTH": {
            const m0 = new Date(today.getFullYear(), today.getMonth(), 1);
            const m1 = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            start = startOfDayIST(m0);
            end = endOfDayIST(m1);
            break;
        }
        case "LAST_MONTH": {
            const m0 = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const m1 = new Date(today.getFullYear(), today.getMonth(), 0);
            start = startOfDayIST(m0);
            end = endOfDayIST(m1);
            break;
        }
        case "THIS_YEAR": {
            const y0 = new Date(today.getFullYear(), 0, 1);
            const y1 = new Date(today.getFullYear(), 11, 31);
            start = startOfDayIST(y0);
            end = endOfDayIST(y1);
            break;
        }
        case "LAST_YEAR": {
            const y0 = new Date(today.getFullYear() - 1, 0, 1);
            const y1 = new Date(today.getFullYear() - 1, 11, 31);
            start = startOfDayIST(y0);
            end = endOfDayIST(y1);
            break;
        }
        default:
            return null; // ALL_TIME or CUSTOM handled elsewhere
    }
    // Convert IST times to UTC ISO for Supabase filter (compensate local offset)
    const startISO = new Date(
        start.getTime() - start.getTimezoneOffset() * 60000
    ).toISOString();
    const endISO = new Date(
        end.getTime() - end.getTimezoneOffset() * 60000
    ).toISOString();
    return { startISO, endISO };
}

/** ---------- JS-side Order Code Generator (IST, collision-safe) ---------- **/
function getISTYear() {
    // Make the "year" flip at IST midnight
    const nowIST = new Date(new Date().toLocaleString("en-US", { timeZone: IST_TZ }));
    return nowIST.getFullYear();
}

/**
 * Generates the next order_code by checking the current max suffix
 * for this IST year and incrementing. Retries to avoid collisions.
 * @returns {Promise<string>} e.g. "ORD-2025-000123"
 */
async function generateOrderCode() {
    const year = getISTYear();
    const prefix = `ORD-${year}-`;

    // 1) Find the current max order_code for this year
    const { data: rows, error } = await supabase
        .from("orders")
        .select("order_code")
        .ilike("order_code", `${prefix}%`)
        .order("order_code", { ascending: false })
        .limit(1);

    if (error) {
        console.error("Failed to read max order_code:", error);
    }

    let nextNum = 1;
    if (rows && rows.length > 0 && rows[0].order_code) {
        const last = rows[0].order_code; // e.g., ORD-2025-000123
        const suffix = last.slice(prefix.length); // "000123"
        const n = parseInt(suffix, 10);
        if (!Number.isNaN(n) && n >= 1) nextNum = n + 1;
    }

    // 2) Try up to N times in case of a race causing unique violation
    for (let attempt = 0; attempt < 6; attempt++) {
        const code = `${prefix}${String(nextNum).padStart(6, "0")}`;

        // quick existence check to avoid obvious collision
        const { data: exists, error: exErr } = await supabase
            .from("orders")
            .select("id")
            .eq("order_code", code)
            .limit(1);

        if (!exErr && (!exists || exists.length === 0)) {
            return code; // looks free
        }
        nextNum++; // bump and retry
    }

    // Fallback: still formatted
    return `${prefix}${String(nextNum).padStart(6, "0")}`;
}

/** ---------- Session Storage Helpers ---------- **/
const SESSION_STORAGE_KEYS = {
    ORDER_FORM: 'order_form_data',
    ORDER_FORM_TIMESTAMP: 'order_form_timestamp'
};

// 5 minutes in milliseconds
const SESSION_EXPIRY = 5 * 60 * 1000;

function saveFormToSession(header, lines) {
    try {
        const formData = {
            header: { ...header },
            lines: lines.map(line => ({ ...line }))
        };
        const timestamp = Date.now();

        sessionStorage.setItem(SESSION_STORAGE_KEYS.ORDER_FORM, JSON.stringify(formData));
        sessionStorage.setItem(SESSION_STORAGE_KEYS.ORDER_FORM_TIMESTAMP, timestamp.toString());
    } catch (error) {
        console.warn('Failed to save form data to session storage:', error);
    }
}

function getFormFromSession() {
    try {
        const storedData = sessionStorage.getItem(SESSION_STORAGE_KEYS.ORDER_FORM);
        const storedTimestamp = sessionStorage.getItem(SESSION_STORAGE_KEYS.ORDER_FORM_TIMESTAMP);

        if (!storedData || !storedTimestamp) {
            return null;
        }

        const timestamp = parseInt(storedTimestamp, 10);
        const now = Date.now();

        // Check if data is expired
        if (now - timestamp > SESSION_EXPIRY) {
            clearSessionForm();
            return null;
        }

        return JSON.parse(storedData);
    } catch (error) {
        console.warn('Failed to retrieve form data from session storage:', error);
        return null;
    }
}

function clearSessionForm() {
    try {
        sessionStorage.removeItem(SESSION_STORAGE_KEYS.ORDER_FORM);
        sessionStorage.removeItem(SESSION_STORAGE_KEYS.ORDER_FORM_TIMESTAMP);
    } catch (error) {
        console.warn('Failed to clear session storage:', error);
    }
}

/** ---------- UI constants ---------- **/
const TAX_OPTIONS = ["Tax Exemption", "2.5%", "5%", "12%", "18%"];

const EMPTY_HEADER = {
    client_id: "",
    order_at: istNowInput(),
    description: "",
    status: "Pending", // Pending | Converted | Cancelled
};

const EMPTY_LINE = {
    product_id: "",
    quantity: "",
    unit: "",
    unit_price: "",
    tax_rate: "Tax Exemption",
};

// money fmt
const inr = (n) =>
    `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function Orders() {
    // list + pagination
    const [rows, setRows] = useState([]);
    const [count, setCount] = useState(0);
    const [page, setPage] = useState(1);
    const pageSize = 10;
    const totalPages = useMemo(
        () => Math.max(1, Math.ceil((count || 0) / pageSize)),
        [count]
    );
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // refs
    const [clients, setClients] = useState([]);
    const [products, setProducts] = useState([]); // id, name, unit, selling_price, tax_rate, product_type
    const [orderInventory, setOrderInventory] = useState([]); // product_id, client_id, qty_available (open demand)
    const [inventory, setInventory] = useState([]); // product_id, client_id, qty_available (stock)

    // ui
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");

    // filters
    const [filterClient, setFilterClient] = useState("");
    const [datePreset, setDatePreset] = useState("ALL_TIME"); // ALL_TIME|TODAY|YESTERDAY|THIS_WEEK|LAST_WEEK|THIS_MONTH|LAST_MONTH|THIS_YEAR|LAST_YEAR|CUSTOM
    const [customStart, setCustomStart] = useState(""); // "YYYY-MM-DD"
    const [customEnd, setCustomEnd] = useState(""); // "YYYY-MM-DD"
    const [statusFilter, setStatusFilter] = useState("ALL"); // ALL | Pending | Converted | Cancelled

    // modal
    const [modalOpen, setModalOpen] = useState(false);
    const [selected, setSelected] = useState(null); // order row
    const [isEditing, setIsEditing] = useState(false);

    // form
    const [header, setHeader] = useState(EMPTY_HEADER);
    const [lines, setLines] = useState([{ ...EMPTY_LINE }]);

    // Add this near your other state declarations
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [pendingAction, setPendingAction] = useState(null);
    const [dialogMessage, setDialogMessage] = useState('');

    // Add auto-save effect for form data
    useEffect(() => {
        if (isEditing && modalOpen) {
            // Only auto-save when in editing mode and modal is open
            saveFormToSession(header, lines);
        }
    }, [header, lines, isEditing, modalOpen]);

    // Add this function to handle the confirmation
    const handleConfirmAction = async () => {
        if (!pendingAction) return;

        try {
            if (pendingAction === 'convert') {
                await markOrderConverted();
            } else if (pendingAction === 'cancel') {
                await markOrderCancelled();
            }
        } finally {
            setShowConfirmDialog(false);
            setPendingAction(null);
        }
    };

    // Add this component before your main return
    const ConfirmDialog = () => (
        <div className="modal-overlay" style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000000
        }}>
            <div className="modal-card" style={{
                background: 'white',
                padding: '1.5rem',
                borderRadius: '8px',
                maxWidth: '400px',
                width: '90%'
            }}>
                <h3 style={{ marginTop: 0 }}>Confirm Action</h3>
                <p>{dialogMessage}</p>
                <div style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '0.75rem',
                    marginTop: '1.5rem'
                }}>
                    <button
                        className="btn modal-btn"
                        onClick={() => setShowConfirmDialog(false)}
                    >
                        Cancel
                    </button>
                    <button
                        className="btn modal-btn danger"
                        onClick={handleConfirmAction}
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );

    // fetch refs (also pull inventory)
    useEffect(() => {
        (async () => {
            const [{ data: c }, { data: p }, { data: oi }, { data: inv }] = await Promise.all([
                supabase
                    .from("clients")
                    .select("id,name,contact,billing_address,shipping_address,credit")
                    .order("name"),
                supabase
                    .from("products")
                    .select("id,name,unit,selling_price,tax_rate,product_type")
                    .order("name"),
                supabase
                    .from("order_inventory")
                    .select("id,product_id,client_id,qty_available")
                    .order("product_id"),
                supabase
                    .from("inventory")
                    .select("id,product_id,client_id,qty_available")
                    .order("product_id"),
            ]);
            setClients(c || []);
            setProducts(p || []);
            setOrderInventory(oi || []);
            setInventory(inv || []);
        })();
    }, []);

    // helpers
    const clientName = (id) => clients.find((x) => x.id === id)?.name || "-";
    const productName = (id) => products.find((x) => x.id === id)?.name || "-";
    const productMeta = (id) => products.find((x) => x.id === id);

    // Build a map: (product_id::client_id) -> open demand qty_available (order_inventory)
    const orderInvMap = useMemo(() => {
        const m = new Map();
        for (const r of orderInventory || []) {
            const k = `${r.product_id}::${r.client_id ?? "NULL"}`;
            m.set(k, Number(r.qty_available || 0));
        }
        return m;
    }, [orderInventory]);

    // Build a map: (product_id::client_id) -> inventory qty_available
    const invMap = useMemo(() => {
        const m = new Map();
        for (const r of inventory || []) {
            const k = `${r.product_id}::${r.client_id ?? "NULL"}`;
            m.set(k, Number(r.qty_available || 0));
        }
        return m;
    }, [inventory]);

    // choose client scope for OI/Inventory based on product_type
    function oiClientScope(product_id, selectedClientId) {
        const p = productMeta(product_id);
        if (!p) return null; // default to generic scope when unknown
        return p.product_type === "customised" ? selectedClientId || null : null;
    }

    // Helper: get qty for a (product_id, client scope) with fallback to "Any" (NULL)
    function getScopedQty(map, product_id, selectedClientId) {
        const scopedClientId = oiClientScope(product_id, selectedClientId); // null for generic products
        const keyScoped = `${product_id}::${scopedClientId ?? "NULL"}`;
        const keyAny = `${product_id}::NULL`;
        if (map.has(keyScoped)) return map.get(keyScoped) ?? 0; // prefer scoped if present
        return map.get(keyAny) ?? 0; // fallback to Any
    }

    // Demand (if needed elsewhere) using same fallback rule
    const demandFor = (product_id, selectedClientId) =>
        getScopedQty(orderInvMap, product_id, selectedClientId);

    // Available = Inventory - Demand (can be negative), with fallback handling
    function availableFor(product_id, selectedClientId) {
        const invQty = getScopedQty(invMap, product_id, selectedClientId);
        const demandQty = getScopedQty(orderInvMap, product_id, selectedClientId);
        return invQty - demandQty;
    }

    // open modal
    async function openAdd() {
        setSelected(null);

        // Try to load from session storage
        const savedForm = getFormFromSession();
        if (savedForm) {
            setHeader({ ...savedForm.header });
            setLines(savedForm.lines.map(line => ({ ...line })));
        } else {
            setHeader({ ...EMPTY_HEADER, order_at: istNowInput(), status: "Pending" });
            setLines([{ ...EMPTY_LINE }]);
        }

        setIsEditing(true);
        setModalOpen(true);
    }

    async function openView(row) {
        setSelected(row);
        setHeader({
            client_id: row.client_id,
            order_at: dateToISTInputValue(new Date(row.order_at)),
            description: row.description || "",
            status: row.status || "Pending",
        });
        const { data: li } = await supabase
            .from("ordered_items")
            .select("id,product_id,quantity,unit,unit_price,tax_rate")
            .eq("order_id", row.id)
            .order("created_at");
        setLines(li || []);
        setIsEditing(false);
        setModalOpen(true);
    }

    function closeModal() {
        setModalOpen(false);
        setSelected(null);
        setIsEditing(false);
        setHeader(EMPTY_HEADER);
        setLines([{ ...EMPTY_LINE }]);
    }

    // Clear all form data and session storage
    function clearAllFormData() {
        setHeader({ ...EMPTY_HEADER, order_at: istNowInput(), status: "Pending" });
        setLines([{ ...EMPTY_LINE }]);
        clearSessionForm();
    }

    // Check if form has significant data
    const hasSignificantData = useMemo(() => {
        // Check if any line has data
        const hasLineData = lines.some(line => 
            line.product_id || 
            line.quantity || 
            line.unit || 
            line.unit_price || 
            line.tax_rate !== "Tax Exemption"
        );
        
        // Check if header has significant data (excluding default values)
        const hasHeaderData = 
            header.client_id || 
            (header.description && header.description.trim() !== '') ||
            header.status !== "Pending" ||
            header.order_at !== istNowInput();
            
        // Count filled fields
        const filledFields = [
            header.client_id ? 1 : 0,
            header.description?.trim() ? 1 : 0,
            header.status !== "Pending" ? 1 : 0,
            header.order_at !== istNowInput() ? 1 : 0,
            ...lines.flatMap(line => [
                line.product_id ? 1 : 0,
                line.quantity ? 1 : 0,
                line.unit ? 1 : 0,
                line.unit_price ? 1 : 0,
                line.tax_rate !== "Tax Exemption" ? 1 : 0
            ])
        ].reduce((sum, val) => sum + val, 0);
        
        return filledFields > 2;
    }, [header, lines]);

    // line ops
    function addLine() {
        setLines((arr) => [...arr, { ...EMPTY_LINE }]);
    }
    function removeLine(idx) {
        setLines((arr) => arr.filter((_, i) => i !== idx));
    }
    function setLine(idx, patch) {
        setLines((arr) => arr.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)));
    }
    function onProductChange(idx, product_id) {
        if (!product_id) {
            setLine(idx, {
                product_id: "",
                unit: "",
                unit_price: "",
                tax_rate: "Tax Exemption",
                quantity: "",
            });
            return;
        }
        const p = productMeta(product_id);
        setLine(idx, {
            product_id,
            unit: p?.unit || "",
            unit_price: p?.selling_price ?? "",
            tax_rate: p?.tax_rate || "Tax Exemption",
        });
    }

    // totals
    const totals = useMemo(() => {
        let sub = 0,
            tax = 0;
        for (const ln of lines) {
            const q = Number(ln.quantity || 0);
            const rate = Number(ln.unit_price || 0);
            const lineSub = q * rate;
            sub += lineSub;

            let pct = 0;
            if (ln.tax_rate && ln.tax_rate !== "Tax Exemption" && ln.tax_rate.endsWith("%")) {
                pct = parseFloat(ln.tax_rate.replace("%", "")) / 100;
            }
            tax += lineSub * pct;
        }
        return { sub, tax, grand: sub + tax };
    }, [lines]);

    // clear filters
    function clearFilters() {
        setSearch("");
        setFilterClient("");
        setDatePreset("ALL_TIME");
        setCustomStart("");
        setCustomEnd("");
        setStatusFilter("ALL");
        setPage(1);
    }

    // list orders
    async function fetchOrders() {
        setLoading(true);
        let q = supabase
            .from("orders")
            .select("id,order_code,client_id,order_at,status,description,created_at", {
                count: "exact",
            })
            .order("created_at", { ascending: false })
            .range(from, to);

        if (search.trim()) {
            // match code or description
            q = q.or(
                `order_code.ilike.%${search.trim()}%,description.ilike.%${search.trim()}%`
            );
        }
        if (filterClient) q = q.eq("client_id", filterClient);
        if (statusFilter !== "ALL") q = q.eq("status", statusFilter);

        // Single dropdown date range
        if (datePreset && datePreset !== "ALL_TIME") {
            if (datePreset === "CUSTOM") {
                if (customStart && customEnd) {
                    const s = istDateFromInput(customStart);
                    const e = istDateFromInput(customEnd);
                    if (s && e) {
                        const start = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0, 0);
                        const end = new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59, 999);
                        const startISO = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString();
                        const endISO = new Date(end.getTime() - end.getTimezoneOffset() * 60000).toISOString();
                        q = q.gte("order_at", startISO).lte("order_at", endISO);
                    }
                }
            } else {
                const range = getPresetRangeIST(datePreset);
                if (range) {
                    q = q.gte("order_at", range.startISO).lte("order_at", range.endISO);
                }
            }
        }

        const { data, count: c, error } = await q;
        setLoading(false);
        if (error) { console.error(error); return; }
        setRows(data || []);
        setCount(c || 0);
    }
    useEffect(() => { fetchOrders(); /* eslint-disable-next-line */ }, [page, search, filterClient, statusFilter, datePreset, customStart, customEnd]);

    // Function to mark order as Converted
    async function markOrderConverted() {
        if (!selected) return;

        try {
            console.log("Converting order:", selected.id);

            // 1) Update order status to "Converted" and set active to false
            const { error: orderError } = await supabase
                .from("orders")
                .update({
                    status: "Converted",
                    active: false
                })
                .eq("id", selected.id);

            if (orderError) throw new Error("Update order status failed: " + orderError.message);

            // 2) Decrease order inventory (remove the demand) for each product in the order
            const { data: orderedItems, error: itemsError } = await supabase
                .from("ordered_items")
                .select("product_id, quantity")
                .eq("order_id", selected.id);

            if (itemsError) throw new Error("Fetch ordered items failed: " + itemsError.message);

            if (orderedItems && orderedItems.length > 0) {
                for (const item of orderedItems) {
                    const productId = item.product_id;
                    const orderQuantity = Number(item.quantity || 0);

                    if (orderQuantity > 0) {
                        await decreaseOrderInventory(productId, selected.client_id, -orderQuantity); // Negative to decrease
                    }
                }
            }

            // Refresh data
            await refreshOrderInventory();
            await fetchOrders();

            // Reload and update the view
            const fresh = await reloadOrderById(selected.id);
            if (fresh) {
                setSelected(fresh);
                setHeader({
                    ...header,
                    status: "Converted"
                });
            }

            console.log("Order successfully converted");
        } catch (err) {
            console.error("Error converting order:", err);
            alert("Failed to convert order: " + (err.message || "Unknown error"));
        }
    }

    // Function to mark order as Cancelled
    async function markOrderCancelled() {
        if (!selected) return;

        try {
            console.log("Cancelling order:", selected.id);

            // 1) Update order status to "Cancelled" and set active to false
            const { error: orderError } = await supabase
                .from("orders")
                .update({
                    status: "Cancelled",
                    active: false
                })
                .eq("id", selected.id);

            if (orderError) throw new Error("Update order status failed: " + orderError.message);

            // 2) Decrease order inventory (remove the demand) for each product in the order
            const { data: orderedItems, error: itemsError } = await supabase
                .from("ordered_items")
                .select("product_id, quantity")
                .eq("order_id", selected.id);

            if (itemsError) throw new Error("Fetch ordered items failed: " + itemsError.message);

            if (orderedItems && orderedItems.length > 0) {
                for (const item of orderedItems) {
                    const productId = item.product_id;
                    const orderQuantity = Number(item.quantity || 0);

                    if (orderQuantity > 0) {
                        await decreaseOrderInventory(productId, selected.client_id, -orderQuantity); // Negative to decrease
                    }
                }
            }

            // Refresh data
            await refreshOrderInventory();
            await fetchOrders();

            // Reload and update the view
            const fresh = await reloadOrderById(selected.id);
            if (fresh) {
                setSelected(fresh);
                setHeader({
                    ...header,
                    status: "Cancelled"
                });
            }

            console.log("Order successfully cancelled");
        } catch (err) {
            console.error("Error cancelling order:", err);
            alert("Failed to cancel order: " + (err.message || "Unknown error"));
        }
    }

    // ===== ORDER INVENTORY helpers (ADD/REMOVE demand) =====
    async function decreaseOrderInventory(product_id, selectedClientId, qty) {
        if (!product_id || qty === 0) return;
        const delta = Number(qty); // Can be positive (add demand) or negative (remove demand)
        const scopeClientId = oiClientScope(product_id, selectedClientId);

        // 1) Read existing row (NULL-safe on client_id)
        let q = supabase
            .from("order_inventory")
            .select("id, qty_available")
            .eq("product_id", product_id)
            .limit(1);

        q = scopeClientId == null ? q.is("client_id", null) : q.eq("client_id", scopeClientId);

        const { data: existingRows, error: readErr } = await q;
        if (readErr) {
            console.error("order_inventory SELECT failed:", readErr);
            return;
        }
        const existing = existingRows?.[0] || null;

        // 2) Insert or update with delta (can be positive or negative)
        if (!existing) {
            // If no existing record and we're removing demand, we shouldn't create a negative record
            // This shouldn't happen in normal flow, but handle it gracefully
            if (delta < 0) {
                console.warn("Attempting to remove demand from non-existent order_inventory record");
                return;
            }

            const { error: insErr } = await supabase
                .from("order_inventory")
                .upsert(
                    [
                        {
                            product_id,
                            client_id: scopeClientId ?? null,   // NULL for generic
                            qty_available: delta,               // ADD demand
                            last_change_at: new Date(),
                        },
                    ],
                    { onConflict: "product_id,client_id" }
                )
                .select();
            if (insErr) {
                console.error("order_inventory UPSERT failed:", insErr);
                return;
            }
        } else {
            const newQty = Number(existing.qty_available || 0) + delta;
            // Ensure we don't go negative (though it shouldn't happen in normal flow)
            const finalQty = Math.max(0, newQty);

            const { error: updErr } = await supabase
                .from("order_inventory")
                .update({ qty_available: finalQty, last_change_at: new Date() })
                .eq("id", existing.id);
            if (updErr) {
                console.error("order_inventory UPDATE failed:", updErr);
                return;
            }
        }
    }

    // Rare race fallback, if you keep it:
    async function increaseOrderInventoryBy(product_id, scopeClientId, delta) {
        let q = supabase
            .from("order_inventory")
            .select("id, qty_available")
            .eq("product_id", product_id)
            .limit(1);

        q = scopeClientId == null ? q.is("client_id", null) : q.eq("client_id", scopeClientId);

        const { data: rowArr, error } = await q;
        if (error) {
            console.error("order_inventory re-read failed:", error);
            return;
        }
        const row = rowArr?.[0];
        if (!row) return;
        const newQty = Number(row.qty_available || 0) + Number(delta || 0); // still additive
        const { error: updErr } = await supabase
            .from("order_inventory")
            .update({ qty_available: newQty, last_change_at: new Date() })
            .eq("id", row.id);
        if (updErr) console.error("order_inventory UPDATE (fallback) failed:", updErr);
    }

    async function refreshOrderInventory() {
        const { data: oi } = await supabase
            .from("order_inventory")
            .select("id,product_id,client_id,qty_available")
            .order("product_id");
        setOrderInventory(oi || []);
    }

    // Optional: refresh stock if needed
    async function refreshInventory() {
        const { data: inv } = await supabase
            .from("inventory")
            .select("id,product_id,client_id,qty_available")
            .order("product_id");
        setInventory(inv || []);
    }

    async function reloadOrderById(id) {
        const { data: o } = await supabase
            .from("orders")
            .select("id,order_code,client_id,order_at,status,description,created_at")
            .eq("id", id)
            .single();
        return o || null;
    }

    // SAVE (create)
    async function handleSave(e) {
        e.preventDefault();
        if (!header.client_id) { alert("Select client"); return; }
        if (lines.length === 0) { alert("Add at least one line"); return; }
        if (lines.some((l) => !l.product_id || !l.quantity || !l.unit || l.unit_price === "")) {
            alert("Each line needs Product, Quantity, Unit and Unit Price"); return;
        }

        // 1) Create order (with order_code generated in JS; retry on collision)
        let created = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            const order_code = await generateOrderCode();

            const headerPayload = {
                client_id: header.client_id,
                order_at: istInputToUTCDate(header.order_at),
                description: header.description?.trim() || null,
                status: header.status || "Pending",
                order_code,
            };

            const res = await supabase.from("orders").insert([headerPayload]).select().single();

            if (!res.error) {
                created = res.data;
                break;
            }

            if (res.error && (res.error.code === "23505" || /duplicate key/i.test(res.error.message))) {
                console.warn("Order code collision; retrying…");
                continue;
            }

            alert("Create failed");
            console.error(res.error);
            return;
        }

        if (!created) {
            alert("Unable to create order (collisions). Try again.");
            return;
        }

        // 2) Create items
        const items = lines.map((ln) => ({
            order_id: created.id,
            product_id: ln.product_id,
            quantity: Number(ln.quantity),
            unit: ln.unit,
            unit_price: Number(ln.unit_price),
            tax_rate: ln.tax_rate,
        }));
        const { error: e2 } = await supabase.from("ordered_items").insert(items);
        if (e2) { alert("Item create failed"); console.error(e2); return; }

        // 3) Adjust ORDER INVENTORY (always ADD; open demand) with correct client scope
        for (const ln of lines) {
            await decreaseOrderInventory(ln.product_id, header.client_id, Number(ln.quantity));
        }

        await refreshOrderInventory();
        // inventory is unaffected by creating an order, but if you want a fresh read:
        // await refreshInventory();

        await fetchOrders();

        // Clear session storage on successful save
        clearSessionForm();

        const fresh = await reloadOrderById(created.id);
        if (fresh) { await openView(fresh); } else { setSelected(created); setIsEditing(false); }
    }

    // pager
    function goPrev() { setPage((p) => Math.max(1, p - 1)); }
    function goNext() { setPage((p) => Math.min(totalPages, p + 1)); }

    const modalTitle = selected ? (isEditing ? `Edit ${selected.order_code || "Order"}` : `Order ${selected.order_code || ""}`.trim()) : "Add Order";

    // Product options (orders are independent of stock; allow any product)
    const productOptions = useMemo(() => {
        const opts = products.map((p) => ({ id: p.id, label: p.name }));
        return opts.sort((a, b) => a.label.localeCompare(b.label));
    }, [products]);

    // Demand/Available scope label helper
    function demandScopeLabel(product_id) {
        const p = productMeta(product_id);
        return p?.product_type === "customised" ? "Client-specific" : "Generic";
    }

    return (
        <NavFrame>
            <div className="wrap">
                {showConfirmDialog && <ConfirmDialog />}

                <header className="bar">
                    <h1 className="title">Orders</h1>
                    <button className="btn primary modal-btn" onClick={openAdd}>+ Create Order</button>
                </header>

                {/* Filters Toolbar */}
                <div className="toolbar">
                    <input
                        className="input"
                        placeholder="Search by Order Code or Description…"
                        value={search}
                        onChange={(e) => { setPage(1); setSearch(e.target.value); }}
                    />

                    <SearchSelect
                        placeholder="Filter client…"
                        options={clients.map((c) => ({ id: c.id, label: c.name }))}
                        valueId={filterClient}
                        onChange={(opt) => { setPage(1); setFilterClient(opt?.id || ""); }}
                    />

                    <select
                        className="input"
                        value={statusFilter}
                        onChange={(e) => { setPage(1); setStatusFilter(e.target.value); }}
                    >
                        <option value="ALL">Status: All</option>
                        <option value="Pending">Pending</option>
                        <option value="Converted">Converted</option>
                        <option value="Cancelled">Cancelled</option>
                    </select>

                    {/* Single Date Preset Dropdown */}
                    <select
                        className="input"
                        value={datePreset}
                        onChange={(e) => {
                            setPage(1);
                            const v = e.target.value;
                            setDatePreset(v);
                            if (v !== "CUSTOM") { setCustomStart(""); setCustomEnd(""); }
                        }}
                    >
                        <option value="ALL_TIME">All Time</option>
                        <option value="TODAY">Today</option>
                        <option value="YESTERDAY">Yesterday</option>
                        <option value="THIS_WEEK">This Week</option>
                        <option value="LAST_WEEK">Last Week</option>
                        <option value="THIS_MONTH">This Month</option>
                        <option value="LAST_MONTH">Last Month</option>
                        <option value="THIS_YEAR">This Year</option>
                        <option value="LAST_YEAR">Last Year</option>
                        <option value="CUSTOM">Custom Range…</option>
                    </select>

                    {datePreset === "CUSTOM" && (
                        <div style={{ display: "flex", gap: 8 }}>
                            <input
                                className="input"
                                type="date"
                                value={customStart}
                                onChange={(e) => { setPage(1); setCustomStart(e.target.value); }}
                            />
                            <input
                                className="input"
                                type="date"
                                value={customEnd}
                                onChange={(e) => { setPage(1); setCustomEnd(e.target.value); }}
                            />
                        </div>
                    )}

                    <button className="btn" onClick={clearFilters}>Clear</button>
                </div>

                <div className="card">
                    <div className="table-wrap">
                        <table className="tbl">
                            <thead>
                                <tr>
                                    <th>Order Code</th>
                                    <th>Client</th>
                                    <th>Date</th>
                                    <th>Status</th>
                                    <th>Description</th>
                                    <th className="right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && <tr><td colSpan="6" className="muted center">Loading…</td></tr>}
                                {!loading && rows.length === 0 && <tr><td colSpan="6" className="muted center">No orders</td></tr>}
                                {!loading && rows.map((r) => (
                                    <tr key={r.id}>
                                        <td data-th="Order Code">{r.order_code || "-"}</td>
                                        <td data-th="Client">{clientName(r.client_id)}</td>
                                        <td data-th="Date">{new Date(r.order_at).toLocaleString("en-IN", { timeZone: IST_TZ })}</td>
                                        <td data-th="Status">
                                            <span className={`badge ${r.status === "Pending" ? "badge-warn"
                                                : r.status === "Cancelled" ? "badge-danger"
                                                    : "badge-ok"
                                                }`}>{r.status}</span>
                                        </td>
                                        <td data-th="Description" className="muted">{r.description || "-"}</td>
                                        <td className="right" data-th="Actions"><button className="btn ghost" onClick={() => openView(r)}>View</button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="pager">
                        <div className="muted">{count} total • Page {page} of {totalPages}</div>
                        <div className="pager-controls">
                            <button className="btn" onClick={goPrev} disabled={page <= 1}>Prev</button>
                            <button className="btn" onClick={goNext} disabled={page >= totalPages}>Next</button>
                        </div>
                    </div>
                </div>

                {/* Modal */}
                {modalOpen && (
                    <div className="modal">
                        <div className="modal-card modal-card--xl" style={{ width: "80vw" }}>
                            <div className="modal-head">
                                <h2 className="modal-title">{modalTitle}</h2>
                                <button className="btn icon" onClick={closeModal} aria-label="Close">×</button>
                            </div>

                            {/* VIEW MODE */}
                            {!isEditing && selected ? (
                                <div>
                                    <div className="details-grid">
                                        <div className="details-col">
                                            <div className="detail-row">
                                                <div className="detail-label">Client</div>
                                                <div className="detail-value">{clientName(header.client_id)}</div>
                                            </div>
                                            <div className="detail-row">
                                                <div className="detail-label">Order Date & Time</div>
                                                <div className="detail-value">
                                                    {new Date(istInputToUTCDate(header.order_at) || new Date()).toLocaleString("en-IN", { timeZone: IST_TZ })}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="details-col">
                                            <div className="detail-row">
                                                <div className="detail-label">Status</div>
                                                <div className="detail-value">
                                                    <span className={`badge ${header.status === "Pending" ? "badge-warn" : header.status === "Cancelled" ? "badge-danger" : "badge-ok"}`}>
                                                        {header.status}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="detail-row">
                                                <div className="detail-label">Description</div>
                                                <div className="detail-value">{header.description || "-"}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Items */}
                                    <div style={{ marginTop: 12, marginBottom: 8, fontWeight: 700 }}>Ordered Items</div>
                                    <div className="card" style={{ padding: 12, maxHeight: "52vh", overflow: "auto" }}>
                                        <div className="table-wrap">
                                            <table className="tbl">
                                                <thead style={{ zIndex: "0" }}>
                                                    <tr><th>Product</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Tax Rate</th><th>Available (Inv−OI)</th></tr>
                                                </thead>
                                                <tbody>{lines.map((ln, idx) => {
                                                    const scopeLabel = demandScopeLabel(ln.product_id);
                                                    return (
                                                        <tr key={idx}>
                                                            <td data-th="Product">{productName(ln.product_id)}</td>
                                                            <td data-th="Qty">{ln.quantity}</td>
                                                            <td data-th="Unit">{ln.unit}</td>
                                                            <td data-th="Unit Price">{inr(ln.unit_price)}</td>
                                                            <td data-th="Tax Rate">{ln.tax_rate}</td>
                                                            <td data-th="Available (Inv−OI)">
                                                                {availableFor(ln.product_id, header.client_id)} <span className="muted">({scopeLabel})</span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}</tbody>
                                            </table>
                                        </div>
                                    </div>

                                    {/* Totals */}
                                    <div className="modal-actions between margin-bottom" style={{ marginTop: 8 }}>
                                        <div className="muted">Subtotal: {inr(totals.sub)} • Tax: {inr(totals.tax)} • Estimated Total: <b>{inr(totals.grand)}</b></div>
                                    </div>

                                    {/* Updated Actions with Converted/Cancelled buttons */}
                                    <div className="order-actions-container margin-bottom">
                                        <button
                                            className="order-action-btn order-action-btn--close btn"
                                            onClick={closeModal}
                                        >
                                            Close
                                        </button>
                                        {header.status === "Pending" && (
                                            <>
                                                <button
                                                    className="order-action-btn order-action-btn--convert btn primary"
                                                    onClick={() => {
                                                        setDialogMessage('Are you sure you want to mark this order as converted?');
                                                        setPendingAction('convert');
                                                        setShowConfirmDialog(true);
                                                    }}
                                                >
                                                    Mark Converted
                                                </button>
                                                <button
                                                    className="order-action-btn order-action-btn--cancel btn danger"
                                                    onClick={() => {
                                                        setDialogMessage('Are you sure you want to cancel this order? This action cannot be undone.');
                                                        setPendingAction('cancel');
                                                        setShowConfirmDialog(true);
                                                    }}
                                                >
                                                    Mark Cancelled
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                /* CREATE MODE */
                                <form onSubmit={handleSave}>
                                    <div className="details-grid">
                                        <div className="details-col">
                                            <label className="lbl">
                                                <span className="lbl-text">Client *</span>
                                                <SearchSelect
                                                    placeholder="Search client…"
                                                    options={clients.map((c) => ({ id: c.id, label: c.name }))}
                                                    valueId={header.client_id}
                                                    onChange={(opt) => setHeader({ ...header, client_id: opt?.id || "" })}
                                                />
                                            </label>
                                            <label className="lbl">
                                                <span className="lbl-text">Order Date &amp; Time</span>
                                                <input className="input" type="datetime-local" value={header.order_at} onChange={(e) => setHeader({ ...header, order_at: e.target.value })} required />
                                            </label>
                                        </div>

                                        <div className="details-col">
                                            <label className="lbl">
                                                <span className="lbl-text">Status</span>
                                                <select className="input" value={header.status} onChange={(e) => setHeader({ ...header, status: e.target.value })}>
                                                    <option value="Pending">Pending</option>
                                                    <option value="Converted">Converted</option>
                                                    <option value="Cancelled">Cancelled</option>
                                                </select>
                                            </label>

                                            <label className="lbl">
                                                <span className="lbl-text">Brief Description</span>
                                                <input className="input input--sm" maxLength={160} placeholder="Brief description…" value={header.description} onChange={(e) => setHeader({ ...header, description: e.target.value })} />
                                            </label>
                                        </div>
                                    </div>

                                    <div style={{ marginTop: 12, marginBottom: 8, fontWeight: 700 }}>Line Items</div>
                                    <div className="card" style={{ padding: 12, maxHeight: "52vh", overflow: "auto" }}>
                                        <div className="line-head">
                                            <div>Product</div><div>Qty</div><div>Unit</div><div>Unit Price</div><div>Tax Rate</div><div></div>
                                        </div>

                                        {lines.map((ln, idx) => {
                                            const p = productMeta(ln.product_id);
                                            const scopeLabel = demandScopeLabel(ln.product_id);
                                            const availVal = ln.product_id ? availableFor(ln.product_id, header.client_id) : 0;
                                            return (
                                                <div key={idx} className="line-wrap">
                                                    <div className="line-row line-row--uniform">
                                                        <div className="uniform-field">
                                                            <SearchSelect
                                                                placeholder="Search product…"
                                                                options={productOptions}
                                                                valueId={ln.product_id || ""}
                                                                onChange={(opt) => onProductChange(idx, opt?.id || "")}
                                                            />
                                                        </div>

                                                        <input
                                                            className="input uniform-input"
                                                            type="number"
                                                            inputMode="decimal"
                                                            step="0.001"
                                                            placeholder="Qty"
                                                            value={ln.quantity}
                                                            onChange={(e) => setLine(idx, { quantity: e.target.value })}
                                                            required
                                                        />

                                                        <input
                                                            className="input uniform-input"
                                                            placeholder="Unit"
                                                            value={ln.unit}
                                                            onChange={(e) => setLine(idx, { unit: e.target.value })}
                                                            required
                                                        />

                                                        <input
                                                            className="input uniform-input"
                                                            type="number"
                                                            inputMode="decimal"
                                                            step="0.01"
                                                            placeholder="Unit Price"
                                                            value={ln.unit_price}
                                                            onChange={(e) => setLine(idx, { unit_price: e.target.value })}
                                                            required
                                                        />

                                                        <select
                                                            className="input uniform-input"
                                                            value={ln.tax_rate}
                                                            onChange={(e) => setLine(idx, { tax_rate: e.target.value })}
                                                            disabled={p?.tax_rate === "Tax Exemption"}
                                                            required
                                                        >
                                                            {TAX_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                                                        </select>

                                                        <button type="button" className="btn danger" onClick={() => removeLine(idx)}>Remove</button>
                                                    </div>

                                                    {ln.product_id && header.client_id && (
                                                        <div className="line-hint">
                                                            Available (Inventory − Demand): <b>{availVal}</b>{" "}
                                                            <span className="muted">({scopeLabel}; generic = no client binding)</span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}

                                        <div style={{ marginTop: 8 }}>
                                            <button type="button" className="btn" onClick={addLine}>+ Add Line</button>
                                        </div>
                                    </div>

                                    <div className="modal-actions between margin-bottom" style={{ marginTop: 8 }}>
                                        <div className="muted">Subtotal: {inr(totals.sub)} • Tax: {inr(totals.tax)} • Estimated Total: <b>{inr(totals.grand)}</b></div>
                                    </div>
                                    <div className="modal-actions margin-bottom">
                                        {hasSignificantData && (
                                            <button 
                                                type="button" 
                                                className="btn danger modal-btn width-100" 
                                                onClick={clearAllFormData}
                                                style={{marginRight: 'auto'}}
                                            >
                                                Clear All
                                            </button>
                                        )}
                                        <button type="button" className="btn modal-btn" onClick={closeModal}>Cancel</button>
                                        <button type="submit" className="btn primary modal-btn">Create</button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </NavFrame>
    );
}

/* ===== Portaled Searchable Select (same UX as sales.js) ===== */
function SearchSelect({ options, valueId, onChange, placeholder = "Search…" }) {
    const [open, setOpen] = useState(false);
    const [term, setTerm] = useState("");
    const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
    const inputRef = useRef(null);
    const containerRef = useRef(null);

    const valueLabel = useMemo(() => options.find((o) => o.id === valueId)?.label || "", [options, valueId]);
    useEffect(() => { setTerm(valueLabel); }, [valueLabel]);

    function updatePosition() {
        const el = inputRef.current; if (!el) return;
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
        return options.filter((o) => o.label.toLowerCase().includes(t)).slice(0, 120);
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
                    {filtered.map((opt) => (
                        <div key={opt.id} className="search-option" onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { onChange?.(opt); setTerm(opt.label); setOpen(false); }}>
                            {opt.label}
                        </div>
                    ))}
                    {valueId && (
                        <div className="search-option" style={{ color: "#b91c1c", fontWeight: 500 }} onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { onChange?.(null); setTerm(""); setOpen(false); }}>
                            Clear selection
                        </div>
                    )}
                </div>, document.body)}
        </div>
    );
}