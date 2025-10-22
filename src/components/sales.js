// sales.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { createPortal } from "react-dom";
import "../styles/clients.css";
import b2bLogo from "../assets/b2b_logo.png"; // logo for invoice header
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
  const parts = fmt.format(date).split(", "); // ["YYYY-MM-DD", "HH:mm"]
  return `${parts[0]}T${parts[1]}`;
}

// Parse an <input type="datetime-local"> (assume IST) → JS Date (UTC)
function istInputToUTCDate(inputValue /* "YYYY-MM-DDTHH:mm" */) {
  if (!inputValue) return null;
  return new Date(inputValue + ":00+05:30");
}

// Convenience now() in IST for inputs
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

const TAX_OPTIONS = ["Tax Exemption", "2.5%", "5%", "12%", "18%"];

const EMPTY_HEADER = {
  client_id: "",
  sale_at: istNowInput(),
  with_tax: true,
  description: "",
  delivered: false,
  delivery_at: "",
};

const EMPTY_LINE = {
  product_id: "",
  from_bucket: "GENERIC", // GENERIC | CLIENT
  quantity: "",
  unit: "",
  unit_price: "",
  tax_rate: "Tax Exemption",
  max_qty: 0, // available in selected bucket (from GROUPED inventory)
};

// --- Invoice helpers ---
function inrFmt(n) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(n || 0));
}
function fmtISTDate(d) {
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: IST_TZ,
    });
  } catch {
    return "-";
  }
}

// Convert number to words (Indian system)
function numberToWords(num) {
  if (num === 0) return "Zero";

  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function convertLessThanThousand(n) {
    if (n === 0) return "";
    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? " " + ones[n % 10] : "");
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 !== 0 ? " " + convertLessThanThousand(n % 100) : "");
  }

  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const remainder = num % 1000;

  let result = "";
  if (crore > 0) result += convertLessThanThousand(crore) + " Crore ";
  if (lakh > 0) result += convertLessThanThousand(lakh) + " Lakh ";
  if (thousand > 0) result += convertLessThanThousand(thousand) + " Thousand ";
  if (remainder > 0) result += convertLessThanThousand(remainder);

  return result.trim();
}

export default function Sales() {
  // list + pagination
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const totalPages = useMemo(() => Math.max(1, Math.ceil((count || 0) / pageSize)), [count]);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // refs
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]); // id, name, unit, selling_price, tax_rate, hsn_sac?
  const [inventory, setInventory] = useState([]); // raw rows

  // NEW: orders for selected client
  const [clientOrders, setClientOrders] = useState([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [orderItemsSnapshot, setOrderItemsSnapshot] = useState([]); // cache last loaded order items (for shortage banner)

  // ui
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // filters (single date dropdown + optional custom range)
  const [filterClient, setFilterClient] = useState("");
  const [datePreset, setDatePreset] = useState("ALL_TIME"); // ALL_TIME|TODAY|YESTERDAY|THIS_WEEK|LAST_WEEK|THIS_MONTH|LAST_MONTH|THIS_YEAR|LAST_YEAR|CUSTOM
  const [customStart, setCustomStart] = useState(""); // "YYYY-MM-DD"
  const [customEnd, setCustomEnd] = useState(""); // "YYYY-MM-DD"
  const [filterTax, setFilterTax] = useState("ALL"); // ALL | WITH_TAX | WITHOUT_TAX

  // modal
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(null); // sale row
  const [confirmDeliverOpen, setConfirmDeliverOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // "Create Invoice" mini-form modal
  const [invoicePromptOpen, setInvoicePromptOpen] = useState(false);
  const [invoiceDueAt, setInvoiceDueAt] = useState(istNowInput());
  const [invoiceWithGST, setInvoiceWithGST] = useState(true);

  // form
  const [header, setHeader] = useState(EMPTY_HEADER);
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);

  // fetch refs
  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: p }, { data: inv }] = await Promise.all([
        supabase.from("clients").select("id,name,contact,billing_address,shipping_address,credit").order("name"),
        supabase.from("products").select("id,name,unit,selling_price,tax_rate,hsn_sac").order("name"),
        supabase.from("inventory").select("id,product_id,client_id,qty_available,total_value").order("product_id"),
      ]);
      setClients(c || []);
      setProducts(p || []);
      setInventory(inv || []);
    })();
  }, []);

  // -------- GROUP inventory by (product_id, client_id) ----------
  const groupedInventory = useMemo(() => {
    const map = new Map();
    for (const r of inventory || []) {
      const clientKey = r.client_id ?? "NULL";
      const key = `${r.product_id}::${clientKey}`;
      const g = map.get(key) || {
        product_id: r.product_id,
        client_id: r.client_id ?? null,
        qty_available: 0,
        total_value: 0,
        __rows: [],
      };
      g.qty_available += Number(r.qty_available || 0);
      g.total_value += Number(r.total_value || 0);
      g.__rows.push({ id: r.id, qty_available: Number(r.qty_available || 0), total_value: Number(r.total_value || 0) });
      map.set(key, g);
    }
    return map;
  }, [inventory]);

  // helpers
  const clientName = (id) => clients.find((x) => x.id === id)?.name || "-";
  const productName = (id) => products.find((x) => x.id === id)?.name || "-";
  const productMeta = (id) => products.find((x) => x.id === id);
  const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  // inventory helpers using GROUPED map
  const genericKey = (product_id) => `${product_id}::NULL`;
  const clientKey = (product_id, cid) => `${product_id}::${cid}`;

  function availableFor(product_id, cid, bucket) {
    if (!product_id) return 0;
    if (bucket === "CLIENT" && cid) {
      return groupedInventory.get(clientKey(product_id, cid))?.qty_available || 0;
    }
    return groupedInventory.get(genericKey(product_id))?.qty_available || 0;
  }
  // NEW: total available across (GENERIC + CLIENT)
  function availableTotalFor(product_id, cid) {
    const gen = groupedInventory.get(genericKey(product_id))?.qty_available || 0;
    const cli = cid ? (groupedInventory.get(clientKey(product_id, cid))?.qty_available || 0) : 0;
    return Number(gen) + Number(cli);
  }

  // NEW: compute shortages for current order items (or current lines)
  const shortages = useMemo(() => {
    // Prefer to show shortages for the selected order snapshot (so it's stable even if user edits lines),
    // otherwise infer from current lines.
    const basis = orderItemsSnapshot.length > 0 ? orderItemsSnapshot : lines.map(l => ({
      product_id: l.product_id,
      quantity: Number(l.quantity || 0),
      unit: l.unit,
    }));
    const list = [];
    for (const it of basis) {
      if (!it?.product_id) continue;
      const need = Number(it.quantity || 0);
      if (need <= 0) continue;
      const have = availableTotalFor(it.product_id, header.client_id);
      if (need > have) {
        list.push({
          product_id: it.product_id,
          name: productName(it.product_id),
          need,
          have,
          shortage: Number((need - have).toFixed(3)),
          unit: it.unit || productMeta(it.product_id)?.unit || ""
        });
      }
    }
    return list;
  }, [orderItemsSnapshot, lines, header.client_id, groupedInventory]);

  // open modal
  async function openAdd() {
    setSelected(null);
    setHeader({ ...EMPTY_HEADER, sale_at: istNowInput(), with_tax: false });
    setLines([{ ...EMPTY_LINE }]);
    setIsEditing(true);
    setModalOpen(true);
    setClientOrders([]);
    setSelectedOrderId("");
    setOrderItemsSnapshot([]);
  }

  async function openView(row) {
    setSelected(row);
    setHeader({
      client_id: row.client_id,
      sale_at: dateToISTInputValue(new Date(row.sale_at)),
      with_tax: !!row.with_tax,
      description: row.description || "",
      delivered: !!row.delivered,
      delivery_at: row.delivery_at ? dateToISTInputValue(new Date(row.delivery_at)) : "",
    });

    const { data: li } = await supabase
      .from("sales_items")
      .select("id,product_id,quantity,unit,unit_price,tax_rate")
      .eq("sale_id", row.id)
      .order("created_at");
    setLines((li || []).map((x) => ({ ...x, from_bucket: "GENERIC", max_qty: 0 })));

    // load that client's active orders so user can relate, but don't preselect
    await loadOrdersForClient(row.client_id);

    setIsEditing(false);
    setModalOpen(true);
    setSelectedOrderId("");
    setOrderItemsSnapshot([]);
  }

  function closeModal() {
    setModalOpen(false);
    setSelected(null);
    setIsEditing(false);
    setConfirmDeliverOpen(false);
    setInvoicePromptOpen(false);
    setHeader(EMPTY_HEADER);
    setLines([{ ...EMPTY_LINE }]);
    setClientOrders([]);
    setSelectedOrderId("");
    setOrderItemsSnapshot([]);
  }

  // line ops
  function addLine() { setLines((arr) => [...arr, { ...EMPTY_LINE }]); }
  function removeLine(idx) { setLines((arr) => arr.filter((_, i) => i !== idx)); }
  function setLine(idx, patch) { setLines((arr) => arr.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln))); }

  function onProductChange(idx, opt) {
    if (!opt) {
      setLine(idx, { product_id: "", from_bucket: "GENERIC", unit: "", unit_price: "", tax_rate: "Tax Exemption", max_qty: 0, quantity: "" });
      return;
    }
    const p = productMeta(opt.product_id);
    const max = availableFor(opt.product_id, header.client_id, opt.bucket);
    setLine(idx, {
      product_id: opt.product_id,
      from_bucket: opt.bucket,
      unit: p?.unit || "",
      unit_price: p?.selling_price ?? "",
      tax_rate: p?.tax_rate || "Tax Exemption",
      max_qty: max,
      quantity: "",
    });
  }

  // recompute max_qty if client changes or inventory refreshes
  useEffect(() => {
    setLines((arr) =>
      arr.map((ln) =>
        ln.product_id
          ? { ...ln, max_qty: availableFor(ln.product_id, header.client_id, ln.from_bucket) }
          : ln
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.client_id, groupedInventory]);

  // totals
  const totals = useMemo(() => {
    let sub = 0, tax = 0;
    for (const ln of lines) {
      const q = Number(ln.quantity || 0);
      const up = Number(ln.unit_price || 0);
      const lineSub = q * up;
      sub += lineSub;

      let lineTaxPct = 0;
      if (header.with_tax && ln.tax_rate && ln.tax_rate !== "Tax Exemption") {
        if (ln.tax_rate.endsWith("%")) {
          lineTaxPct = parseFloat(ln.tax_rate.replace("%", "")) / 100;
        }
      }
      tax += lineSub * lineTaxPct;
    }
    return { sub, tax, grand: sub + tax };
  }, [lines, header.with_tax]);

  // clear filters
  function clearFilters() {
    setSearch("");
    setFilterClient("");
    setDatePreset("ALL_TIME");
    setCustomStart("");
    setCustomEnd("");
    setFilterTax("ALL");
    setPage(1);
  }

  // list sales
  async function fetchSales() {
    setLoading(true);
    let q = supabase
      .from("sales")
      .select("id,sale_id,client_id,sale_at,with_tax,delivered,delivery_at,created_at,invoice_date,invoice_due_date,invoice_with_gst", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (search.trim()) q = q.ilike("sale_id", `%${search.trim()}%`);
    if (filterClient) q = q.eq("client_id", filterClient);
    if (filterTax === "WITH_TAX") q = q.eq("with_tax", true);
    if (filterTax === "WITHOUT_TAX") q = q.eq("with_tax", false);

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
            q = q.gte("sale_at", startISO).lte("sale_at", endISO);
          }
        }
      } else {
        const range = getPresetRangeIST(datePreset);
        if (range) {
          q = q.gte("sale_at", range.startISO).lte("sale_at", range.endISO);
        }
      }
    }

    const { data, count: c, error } = await q;
    setLoading(false);
    if (error) { console.error(error); return; }
    setRows(data || []);
    setCount(c || 0);
  }
  useEffect(() => { fetchSales(); /* eslint-disable-next-line */ }, [page, search, filterClient, datePreset, customStart, customEnd, filterTax]);

  // save (create)
  async function handleSubmit(e) {
    e.preventDefault();
    if (!header.client_id) { alert("Select client"); return; }
    if (lines.length === 0) { alert("Add at least one line"); return; }
    if (lines.some((l) => !l.product_id || !l.quantity || !l.unit || l.unit_price === "")) {
      alert("Each line needs Product, Quantity, Unit and Unit Price"); return;
    }
    for (const ln of lines) {
      const q = Number(ln.quantity);
      const max = Number(availableFor(ln.product_id, header.client_id, ln.from_bucket) || 0);
      if (q <= 0 || q > max) { alert(`Quantity for "${productName(ln.product_id)}" exceeds available (${max}).`); return; }
    }

    const headerPayload = {
      client_id: header.client_id,
      sale_at: istInputToUTCDate(header.sale_at),
      with_tax: false, // Always set to false by default
      description: header.description?.trim() || null,
      delivered: !!header.delivered,
      delivery_at: header.delivery_at ? istInputToUTCDate(header.delivery_at) : null,
    };

    // Pre-compute total right now to apply to credit later
    const saleTotalAmount = Number(totals.grand || 0);

    // Start transaction
    try {
      // 1) Create sale
      const { data: created, error: e1 } = await supabase.from("sales").insert([headerPayload]).select().single();
      if (e1) throw new Error("Create sale failed: " + e1.message);

      // 2) Create items
      const items = lines.map((ln) => ({
        sale_id: created.id,
        product_id: ln.product_id,
        quantity: Number(ln.quantity),
        unit: ln.unit,
        unit_price: Number(ln.unit_price),
        tax_rate: ln.tax_rate,
      }));
      const { error: e2 } = await supabase.from("sales_items").insert(items);
      if (e2) throw new Error("Create items failed: " + e2.message);

      // 3) Deduct inventory
      for (const ln of lines) {
        const q = Number(ln.quantity);
        const clientId = ln.from_bucket === "CLIENT" && header.client_id ? header.client_id : null;

        // Update regular inventory
        await decrementInventoryAcrossRows(ln.product_id, clientId, q);
      }

      // 4) Update order inventory and status ONLY if this sale is from an order
      if (selectedOrderId) {
        // Fetch the ordered items to get the exact quantities from the order
        const { data: orderedItems, error: orderItemsError } = await supabase
          .from("ordered_items")
          .select("product_id, quantity")
          .eq("order_id", selectedOrderId);

        if (orderItemsError) throw new Error("Fetch ordered items failed: " + orderItemsError.message);

        // Decrement order inventory for each product in the order
        for (const item of orderedItems || []) {
          const productId = item.product_id;
          const orderQuantity = Number(item.quantity || 0);

          if (orderQuantity > 0) {
            await decrementOrderInventory(productId, header.client_id, orderQuantity);
          }
        }

        // 5) Update order status to Converted and set active to false
        const { error: orderErr } = await supabase
          .from("orders")
          .update({ status: "Converted", active: false })
          .eq("id", selectedOrderId);

        if (orderErr) throw new Error("Update order status failed: " + orderErr.message);
      }

      // 6) Update client's credit (add grand total of this sale)
      const { data: cRow, error: cErr } = await supabase
        .from("clients")
        .select("credit")
        .eq("id", header.client_id)
        .single();

      if (cErr) throw new Error("Fetch client credit failed: " + cErr.message);

      const currentCredit = Number(cRow?.credit || 0);
      const newCredit = currentCredit + saleTotalAmount;
      const { error: updErr } = await supabase
        .from("clients")
        .update({ credit: newCredit })
        .eq("id", header.client_id);

      if (updErr) throw new Error("Update client credit failed: " + updErr.message);

      await refreshInventory();
      await fetchSales();

      const fresh = await reloadSaleById(created.id);
      if (fresh) {
        await openView(fresh);
      } else {
        setSelected(created);
        setIsEditing(false);
      }
    } catch (err) {
      console.error("Error in sale creation:", err);
      alert("Failed to create sale: " + (err.message || "Unknown error"));
    }
  }

  // inventory decrement
  async function decrementInventoryAcrossRows(product_id, client_id, qtyNeeded) {
    if (!qtyNeeded || qtyNeeded <= 0) return;
    let query = supabase.from("inventory").select("id,qty_available,total_value").eq("product_id", product_id);
    if (client_id) query = query.eq("client_id", client_id); else query = query.is("client_id", null);
    const { data: rows, error } = await query;
    if (error || !rows || rows.length === 0) return;

    const list = [...rows].sort((a, b) => Number(b.qty_available || 0) - Number(a.qty_available || 0));
    let remaining = Number(qtyNeeded);
    for (const r of list) {
      if (remaining <= 0) break;
      const have = Number(r.qty_available || 0);
      if (have <= 0) continue;
      const take = Math.min(have, remaining);
      const newQty = have - take;
      if (newQty <= 0) {
        await supabase.from("inventory").delete().eq("id", r.id);
      } else {
        const ratio = newQty / have;
        const newVal = Math.max(0, Number(r.total_value || 0) * ratio);
        await supabase.from("inventory").update({ qty_available: newQty, total_value: newVal }).eq("id", r.id);
      }
      remaining -= take;
    }
  }

  // FIXED: order_inventory decrement with product_type logic
  async function decrementOrderInventory(product_id, client_id, qtyNeeded) {
    if (!qtyNeeded || qtyNeeded <= 0) return;

    console.log(`Decrementing order inventory: product=${product_id}, client=${client_id}, qty=${qtyNeeded}`);

    // First, get the product type to determine the logic
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("product_type")
      .eq("id", product_id)
      .single();

    if (productError) {
      console.error("Error fetching product:", productError);
      throw new Error("Fetch product failed: " + productError.message);
    }

    const productType = product?.product_type || 'generic';
    console.log(`Product type: ${productType}`);

    // Determine the client_id to use based on product type
    const targetClientId = productType === 'generic' ? null : client_id;

    console.log(`Using client_id: ${targetClientId} for product_type: ${productType}`);

    // First try to find an existing row
    let query = supabase
      .from("order_inventory")
      .select("id, qty_available")
      .eq("product_id", product_id);

    if (targetClientId) {
      query = query.eq("client_id", targetClientId);
    } else {
      query = query.is("client_id", null);
    }

    const { data: rows, error } = await query;
    if (error) {
      console.error("Error fetching order inventory:", error);
      throw new Error("Fetch order inventory failed: " + error.message);
    }

    // If no row exists, we need to create one with negative quantity
    if (!rows || rows.length === 0) {
      console.log(`No order_inventory record found for product ${product_id} with client ${targetClientId}, creating one with negative quantity`);

      const newQty = -qtyNeeded; // This will be negative since we're consuming from order inventory

      const { data: newRow, error: createError } = await supabase
        .from("order_inventory")
        .insert([
          {
            product_id: product_id,
            client_id: targetClientId,
            qty_available: newQty,
            last_change_at: new Date().toISOString()
          }
        ])
        .select()
        .single();

      if (createError) {
        console.error("Error creating order inventory:", createError);
        throw new Error("Create order inventory failed: " + createError.message);
      }

      console.log(`Created new order_inventory record with qty: ${newQty} for client: ${targetClientId}`);
      return;
    }

    // Update existing row(s) - should only be one due to unique constraint
    for (const row of rows) {
      const currentQty = Number(row.qty_available || 0);
      const newQty = currentQty - qtyNeeded;

      const { error: updateError } = await supabase
        .from("order_inventory")
        .update({
          qty_available: newQty,
          last_change_at: new Date().toISOString()
        })
        .eq("id", row.id);

      if (updateError) {
        console.error("Error updating order inventory:", updateError);
        throw new Error("Update order inventory failed: " + updateError.message);
      }

    }
  }

  async function refreshInventory() {
    const { data: inv } = await supabase.from("inventory").select("id,product_id,client_id,qty_available,total_value").order("product_id");
    setInventory(inv || []);
  }

  async function reloadSaleById(id) {
    const { data: s } = await supabase
      .from("sales")
      .select("id,sale_id,client_id,sale_at,with_tax,delivered,delivery_at,created_at,invoice_date,invoice_due_date,invoice_with_gst")
      .eq("id", id)
      .single();
    return s || null;
  }

  // mark delivered
  async function markDeliveredNow() {
    if (!selected) return;
    const at = header.delivery_at ? istInputToUTCDate(header.delivery_at) : new Date();
    const { error } = await supabase.from("sales").update({ delivered: true, delivery_at: at }).eq("id", selected.id);
    if (error) { alert("Failed to mark delivered"); console.error(error); return; }
    setHeader((h) => ({ ...h, delivered: true, delivery_at: dateToISTInputValue(new Date(at)) }));
    const fresh = await reloadSaleById(selected.id);
    if (fresh) setSelected(fresh);
    await fetchSales();
    setConfirmDeliverOpen(false);
  }

  /** ------------------------------------------------------
   * Create Invoice flow
   * ----------------------------------------------------- */
  function beginCreateInvoice() {
    const oneMonthLater = new Date();
    oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
    setInvoiceDueAt(dateToISTInputValue(oneMonthLater));
    setInvoiceWithGST(true);
    setInvoicePromptOpen(true);
  }

  async function confirmCreateInvoice() {
    if (!selected) return;
    const invoice_date = new Date(); // now
    const invoice_due_date = istInputToUTCDate(invoiceDueAt);
    const { error } = await supabase
      .from("sales")
      .update({ invoice_date, invoice_due_date, invoice_with_gst: !!invoiceWithGST })
      .eq("id", selected.id);
    if (error) { alert("Failed saving invoice details"); console.error(error); return; }

    const fresh = await reloadSaleById(selected.id);
    if (fresh) setSelected(fresh);
    setInvoicePromptOpen(false);
    await openInvoiceTab(selected.id);
  }

  // Opens printable invoice tab
  async function openInvoiceTab(saleId) {
    const { data: sale, error: eSale } = await supabase
      .from("sales")
      .select("id,sale_id,client_id,sale_at,with_tax,description,delivery_at,invoice_date,invoice_due_date,invoice_with_gst")
      .eq("id", saleId)
      .single();
    if (eSale || !sale) { alert("Unable to load sale"); console.error(eSale); return; }

    const { data: client, error: eClient } = await supabase
      .from("clients")
      .select("id,name,contact,billing_address,shipping_address")
      .eq("id", sale.client_id)
      .single();
    if (eClient) { alert("Unable to load client"); console.error(eClient); return; }

    const { data: items, error: eItems } = await supabase
      .from("sales_items")
      .select("product_id,quantity,unit,unit_price,tax_rate")
      .eq("sale_id", sale.id)
      .order("created_at");
    if (eItems) { alert("Unable to load items"); console.error(eItems); return; }

    // NEW: fetch products with hsn_sac
    const { data: products, error: eProducts } = await supabase
      .from("products")
      .select("id,name,hsn_sac")
      .order("name");
    if (eProducts) { alert("Unable to load products"); console.error(eProducts); return; }

    const productById = Object.fromEntries((products || []).map(p => [p.id, p]));
    const useGST = (sale.invoice_with_gst ?? sale.with_tax) ? true : false;

    const parsePct = (txt) => (txt && txt.endsWith("%") ? parseFloat(txt.replace("%", "")) / 100 : 0);
    const rows = (items || []).map((ln, idx) => {
      const rate = Number(ln.unit_price || 0);
      const qty = Number(ln.quantity || 0);
      const taxable = rate * qty;
      const pct = useGST && ln.tax_rate !== "Tax Exemption" ? parsePct(ln.tax_rate) : 0;
      const tax = taxable * pct;
      const amount = taxable + tax;
      const prod = productById[ln.product_id] || {};
      return { idx: idx + 1, ...ln, rate, qty, taxable, pct, tax, amount, pname: prod.name || "", hsn_sac: prod.hsn_sac ?? null };
    });

    const showHSN = rows.some(r => r.hsn_sac && String(r.hsn_sac).trim() !== "");
    const subtotal = rows.reduce((s, r) => s + r.taxable, 0);
    const taxTotal = rows.reduce((s, r) => s + r.tax, 0);
    const grand = subtotal + taxTotal;

    const inrFmtLoc = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(n || 0));
    const safe = (s) => (s ?? "").toString().replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
    const fmtISTDateLoc = (d) => {
      try {
        return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
      } catch { return "-"; }
    };

    const custAddress = client?.billing_address || client?.shipping_address || "-";

    // Generate filename
    const clientNameUpper = (client?.name || "CUSTOMER").toUpperCase().replace(/\s+/g, "_");
    const currentDate = new Date().toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).replace(/\//g, "-");
    const filename = `B2B_TRADERS-${clientNameUpper}-${currentDate}`;

    const supabaseUrl = supabase.supabaseUrl;
    const supabaseKey = supabase.supabaseKey;

    const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title style="display:none">${filename}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  *{box-sizing:border-box}
  :root{--ink:#0f172a;--muted:#6b7280;--line:#e5e7eb;--soft:#f3f4f6}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,"Helvetica Neue",Arial,"Noto Sans","Apple Color Emoji","Segoe UI Emoji";margin:0;padding:28px;background:#fff;color:#6b7280}
  b{color:#111}
  .wrap{max-width:900px;margin:0 auto}
  .actions{display:flex;gap:8px;margin-bottom:16px;align-items:center}
  .btn{padding:8px 12px;border:1px solid var(--line);background:#fff;border-radius:8px;cursor:pointer}
  .btn.primary{background:#2563eb;color:#fff;border-color:#2563eb}
  .print-btn{background:#2563eb;color:#fff;border-color:#2563eb}
  .type-selector{display:flex;gap:6px;align-items:center;margin-left:auto}
  .type-selector label{font-size:13px;font-weight:600}
  .type-selector select{padding:6px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px;cursor:pointer}
  .edit-section{background:var(--soft);padding:12px;border-radius:8px;margin-bottom:12px;display:none}
  .edit-section.active{display:block}
  .edit-row{display:flex;gap:12px;align-items:center;margin-bottom:8px}
  .edit-row label{font-size:13px;font-weight:600;min-width:120px}
  .edit-row input,.edit-row select{padding:6px 10px;border:1px solid var(--line);border-radius:6px;font-size:13px}
  .topbar{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px}
  .title{letter-spacing:.18em;color:#2563eb;font-weight:600;font-size:13px}
  .copytag{font-size:11px;color:#9ca3af;text-transform:uppercase;font-weight:600;letter-spacing:.18em}
  .copytag.hidden{display:none}
  .totalbar{display:grid;grid-template-columns:1fr 280px;gap:12px;margin-top:8px}
  .totalbar.challan-mode{grid-template-columns:1fr}
  .brandrow{display:grid;grid-template-columns:1.2fr .8fr;gap:16px;align-items:center;padding:10px 0;border-top:2px solid var(--line);border-bottom:2px solid var(--line);margin-bottom:10px}
  .leftbrand h1{margin:0 0 6px;font-size:20px;line-height:1.2;color:#111}
  .leftbrand .gst{font-size:12px}
  .addr{margin-top:6px;font-size:12px}
  .logo{justify-self:end}
  .logo img{height:120px;width:auto;object-fit:contain}
  .meta{display:flex;gap:16px;justify-content:space-between;flex-wrap:wrap;border-radius:12px;padding:12px;margin-bottom:12px}
  .meta .col b{display:block;margin-bottom:6px;font-size:12px}
  .meta .kvs{display:grid;grid-template-columns:auto auto;column-gap:10px;row-gap:6px;font-size:13px}
  .kv-label{color:#6b7280}
  .grid{display:grid;grid-template-columns:1.1fr .9fr;gap:12px;margin-bottom:12px}
  .box{border-radius:12px;padding:12px}
  .box h3{margin:0 0 8px;font-size:12px;color:#374151;text-transform:uppercase;letter-spacing:.04em}
  .box .muted{color:var(--muted);font-size:12px}
  table{width:100%;border-collapse:collapse}
  thead th{font-size:12px;border-bottom:2px solid var(--line);padding:8px}
  tbody td{padding:8px;border-bottom:1px solid var(--soft);font-size:12px}
  tfoot td{padding:8px;border-top:2px solid var(--line)}
  th.right,td.right{text-align:right}
  th.center,td.center{text-align:center}
  .totals{border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .totals.hidden{display:none}
  .amount-section{margin-top:16px;display:flex;justify-content:space-between;align-items:center;padding:12px;border-top:2px solid var(--line);border-bottom:2px solid var(--line)}
  .amount-section.hidden{display:none}
  .totals table{width:100%}
  .grand td{font-weight:500;border-top:2px solid var(--line)}
  .notes{margin-top:6px;font-size:12px;color:#6b7280}
  .for{margin-top:24px;text-align:right;font-size:12px}
  .sign{margin-top:42px;text-align:right;font-size:12px;color:#6b7280}
  @media print{.actions{display:none !important} .edit-section{display:none !important} body{padding:0} .wrap{margin:0}}
</style>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
</head>
<body>
  <div class="wrap">
    <div class="actions">
      <button class="btn" onclick="toggleEdit()">Edit Invoice Details</button>
      <button class="btn print-btn" onclick="printAndClose()">Download / Print PDF</button>
      <button class="btn" onclick="window.close()">Close Tab</button>
      <div class="type-selector">
        <label>Type:</label>
        <select id="invoiceType" onchange="updateInvoiceType()">
          <option value="ORIGINAL FOR RECIPIENT">Customer</option>
          <option value="DUPLICATE FOR TRANSPORTER">Transport</option>
          <option value="TRIPLICATE FOR SUPPLIER">Supplier</option>
          <option value="DELIVERY CHALLAN">Delivery Challan</option>
        </select>
      </div>
    </div>

    <div class="edit-section" id="editSection">
      <h3 style="margin:0 0 12px;font-size:14px">Edit Invoice Details</h3>
      <div class="edit-row">
        <label>Due Date:</label>
        <input type="datetime-local" id="editDueDate" value="${dateToISTInputValue(new Date(sale.invoice_due_date || sale.invoice_date || sale.sale_at))}" />
      </div>
      <div class="edit-row">
        <label>Tax Mode:</label>
        <select id="editGST">
          <option value="true" ${useGST ? 'selected' : ''}>With GST</option>
          <option value="false" ${!useGST ? 'selected' : ''}>Without GST</option>
        </select>
      </div>
      <div class="edit-row">
        <button class="btn primary" onclick="saveInvoiceChanges()"> Save Changes</button>
        <button class="btn" onclick="toggleEdit()">Cancel</button>
      </div>
    </div>

    <div class="topbar">
      <div class="title" id="invoiceTitle">TAX INVOICE</div>
      <div class="copytag" id="copyTag">ORIGINAL FOR RECIPIENT</div>
    </div>

    <div class="brandrow">
      <div class="leftbrand">
        <h1>B2B TRADERS</h1>
        <div class="gst"><b>GSTIN: 33BVNPV3588H1ZV</b></div>
        <div class="addr">
          D.NO.299-B<br/>
          NACHIMUTHU PUDUR, Dharapuram<br/>
          Tiruppur, TAMIL NADU, 638656<br/>
          <b>Mobile:</b> +91 9080122817 &nbsp; <b>Email:</b> b2btradersb2@gmail.com
        </div>
      </div>
      <div class="logo"><img src="${b2bLogo}" alt="B2B Traders Logo"/></div>
    </div>

    <div class="meta">
      <div class="col">
        <b>Invoice #: ${safe(sale.sale_id || "")}</b>
        <div class="kvs">
          <div class="kv-label">Invoice Date:</div><div>${safe(fmtISTDateLoc(sale.invoice_date || sale.sale_at))}</div>
          <div class="kv-label">Due Date:</div><div>${safe(fmtISTDateLoc(sale.invoice_due_date || sale.invoice_date || sale.sale_at))}</div>
        </div>
      </div>
      <div class="col">
        <b>Customer</b>
        <div style="font-size:13px"><b>${safe(client?.name || "-")}</b></div>
        <div style="font-size:12px">${safe(custAddress)}</div>
        ${client?.contact ? `<div style="font-size:12px">Ph: ${safe(client.contact)}</div>` : ''}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:36px" class="center">#</th>
          <th>Item</th>
          ${showHSN ? '<th>HSN/SAC</th>' : ''}
          <th class="right">Rate / Item</th>
          <th class="right">Qty</th>
          <th class="right">Total Value</th>
          ${useGST ? '<th class="right">Tax Amount</th>' : ''}
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="center">${r.idx}</td>
            <td>${safe(r.pname)}</td>
            ${showHSN ? `<td>${safe(r.hsn_sac || "")}</td>` : ''}
            <td class="right">${inrFmtLoc(r.rate)}</td>
            <td class="right">${r.qty} ${safe(r.unit || "")}</td>
            <td class="right">${inrFmtLoc(r.taxable)}</td>
            ${useGST ? `<td class="right">${inrFmtLoc(r.tax)}</td>` : ''}
            <td class="right">${inrFmtLoc(r.amount)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    <div class="totalbar" id="totalBar">
      <div class="notes">Total items / Qty: ${rows.length} / ${rows.reduce((a, r) => a + Number(r.qty || 0), 0)}</div>
      <div class="totals" id="totalsSection">
        <table>
          <tbody>
            <tr><td>Subtotal</td><td class="right">${inrFmtLoc(subtotal)}</td></tr>
            ${useGST ? `<tr><td>Tax</td><td class="right">${inrFmtLoc(taxTotal)}</td></tr>` : ''}
          </tbody>
          <tfoot>
            <tr class="grand"><td><b>Total</b></td><td class="right"><b>${inrFmtLoc(grand)}</b></td></tr>
          </tfoot>
        </table>
      </div>
    </div>

    <div class="amount-section" id="amountSection">
      <div style="font-size:13px">
        <div style="margin-bottom:6px"><b>Total Amount (in words): </b> ${numberToWords(Math.floor(grand))} Rupees Only</div>
      </div>
      <div style="font-size:14px;font-weight:500">Amount Payable</div>
      <div style="font-size:18px;font-weight:600;color:#2563eb">${inrFmtLoc(grand)}</div>
    </div>

    <div class="for">For B2B TRADERS</div>
    <div class="sign">Authorized Signatory</div>
  </div>

  <script>
    const { createClient } = supabase;
    const sb = createClient('${supabaseUrl}', '${supabaseKey}');
    const saleId = '${sale.id}';

    function toggleEdit() {
      const section = document.getElementById('editSection');
      section.classList.toggle('active');
    }

    function printAndClose() {
      window.print();
      window.addEventListener('afterprint', function() { window.close(); }, { once: true });
      setTimeout(function() { if (!window.closed) window.close(); }, 1000);
    }

    function updateInvoiceType() {
      const select = document.getElementById('invoiceType');
      const selectedValue = select.value;
      const copyTag = document.getElementById('copyTag');
      const invoiceTitle = document.getElementById('invoiceTitle');
      const isChallan = selectedValue === 'DELIVERY CHALLAN';
      if (isChallan) {
        copyTag.classList.add('hidden');
        invoiceTitle.textContent = 'DELIVERY CHALLAN';
      } else {
        copyTag.classList.remove('hidden');
        copyTag.textContent = selectedValue;
        invoiceTitle.textContent = 'TAX INVOICE';
      }
      toggleChallanMode(isChallan);
    }

    let originalTableData = null;

    function toggleChallanMode(isChallan) {
      const table = document.querySelector('table');
      const thead = table.querySelector('thead tr');
      const tbody = table.querySelector('tbody');
      const totalsSection = document.getElementById('totalsSection');
      const amountSection = document.getElementById('amountSection');
      const totalBar = document.getElementById('totalBar');
      const notes = totalBar.querySelector('.notes');

      const hasHSN = Array.from(thead.querySelectorAll('th')).some(th => th.textContent.trim().toUpperCase().includes('HSN'));
      
      if (isChallan) {
        if (!originalTableData) {
          originalTableData = { thead: thead.innerHTML, tbody: tbody.innerHTML };
        }
        thead.innerHTML = \`
          <th style="width:36px" class="center">#</th>
          <th>Item</th>
          <th class="right">Qty</th>
        \`;
        const rows = Array.from(tbody.querySelectorAll('tr'));
        rows.forEach((row, idx) => {
          const cells = row.querySelectorAll('td');
          const itemIdx = 1;
          const qtyIdx  = hasHSN ? 4 : 3;
          const itemName = cells[itemIdx]?.textContent || '';
          const qty = cells[qtyIdx]?.textContent || '';
          row.innerHTML = \`
            <td class="center">\${idx + 1}</td>
            <td>\${itemName}</td>
            <td class="right">\${qty}</td>
          \`;
        });
        totalsSection.classList.add('hidden');
        amountSection.classList.add('hidden');
        totalBar.classList.add('challan-mode');

        notes.style.fontWeight = 'bold';
        notes.style.fontSize = '14px';
        notes.style.backgroundColor = '#eeeeee';
        notes.style.padding = '10px 12px';
        notes.style.borderRadius = '8px';
        notes.style.color = '#111111';
      } else {
        if (originalTableData) {
          thead.innerHTML = originalTableData.thead;
          tbody.innerHTML = originalTableData.tbody;
        }
        totalsSection.classList.remove('hidden');
        amountSection.classList.remove('hidden');
        totalBar.classList.remove('challan-mode');

        notes.style.fontWeight = '';
        notes.style.fontSize = '';
        notes.style.backgroundColor = '';
        notes.style.padding = '';
        notes.style.borderRadius = '';
        notes.style.color = '';
      }
    }

    function dateToISTInputValue(date) {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      });
      const parts = fmt.format(date).split(", ");
      return parts[0] + "T" + parts[1];
    }

    function istInputToUTCDate(inputValue) {
      if (!inputValue) return null;
      return new Date(inputValue + ":00+05:30");
    }

    function fmtISTDate(d) {
      try {
        return new Date(d).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          timeZone: "Asia/Kolkata",
        });
      } catch {
        return "-";
      }
    }

    async function refreshInvoiceContent() {
      const { data: sale } = await sb.from('sales')
        .select('id,sale_id,client_id,sale_at,with_tax,description,delivery_at,invoice_date,invoice_due_date,invoice_with_gst')
        .eq('id', saleId).single();
      if (!sale) return;

      const { data: client } = await sb.from('clients')
        .select('id,name,contact,billing_address,shipping_address')
        .eq('id', sale.client_id).single();

      const { data: items } = await sb.from('sales_items')
        .select('product_id,quantity,unit,unit_price,tax_rate')
        .eq('sale_id', sale.id).order('created_at');

      const { data: products } = await sb.from('products')
        .select('id,name,hsn_sac').order('name');

      const dueDateDisplay = document.querySelector('.meta .kvs div:nth-child(4)');
      if (dueDateDisplay) {
        dueDateDisplay.textContent = fmtISTDate(sale.invoice_due_date || sale.invoice_date || sale.sale_at);
      }

      document.getElementById('editDueDate').value = dateToISTInputValue(new Date(sale.invoice_due_date || sale.invoice_date || sale.sale_at));
      document.getElementById('editGST').value = sale.invoice_with_gst ? 'true' : 'false';

      const useGST = sale.invoice_with_gst ?? sale.with_tax;
      rebuildTable(items, products, useGST);
    }

    function rebuildTable(items, products, useGST) {
      const parsePct = (txt) => (txt && txt.endsWith("%") ? parseFloat(txt.replace("%", "")) / 100 : 0);
      const productById = Object.fromEntries((products || []).map(p => [p.id, p]));
      const rows = (items || []).map((ln, idx) => {
        const rate = Number(ln.unit_price || 0);
        const qty = Number(ln.quantity || 0);
        const taxable = rate * qty;
        const pct = useGST && ln.tax_rate !== "Tax Exemption" ? parsePct(ln.tax_rate) : 0;
        const tax = taxable * pct;
        const amount = taxable + tax;
        const prod = productById[ln.product_id] || {};
        return { idx: idx + 1, ...ln, rate, qty, taxable, pct, tax, amount, pname: prod.name || "", hsn_sac: prod.hsn_sac ?? null };
      });

      const showHSN = rows.some(r => r.hsn_sac && String(r.hsn_sac).trim() !== "");
      const subtotal = rows.reduce((s, r) => s + r.taxable, 0);
      const taxTotal = rows.reduce((s, r) => s + r.tax, 0);
      const grand = subtotal + taxTotal;

      const inrFmt = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(n || 0));
      const safe = (s) => (s ?? "").toString().replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

      const thead = document.querySelector('table thead tr');
      thead.innerHTML = \`
        <th style="width:36px" class="center">#</th>
        <th>Item</th>
        \${showHSN ? '<th>HSN/SAC</th>' : ''}
        <th class="right">Rate / Item</th>
        <th class="right">Qty</th>
        <th class="right">Taxable Value</th>
        \${useGST ? '<th class="right">Tax Amount</th>' : ''}
        <th class="right">Amount</th>
      \`;

      const tbody = document.querySelector('table tbody');
      tbody.innerHTML = rows.map(r => \`
        <tr>
          <td class="center">\${r.idx}</td>
          <td>\${safe(r.pname)}</td>
          \${showHSN ? \`<td>\${safe(r.hsn_sac || "")}</td>\` : ''}
          <td class="right">\${inrFmt(r.rate)}</td>
          <td class="right">\${r.qty} \${safe(r.unit || "")}</td>
          <td class="right">\${inrFmt(r.taxable)}</td>
          \${useGST ? \`<td class="right">\${inrFmt(r.tax)}</td>\` : ''}
          <td class="right">\${inrFmt(r.amount)}</td>
        </tr>
      \`).join('');

      const totalsBody = document.querySelector('.totals table tbody');
      totalsBody.innerHTML = \`
        <tr><td>Subtotal</td><td class="right">\${inrFmt(subtotal)}</td></tr>
        \${useGST ? \`<tr><td>Tax</td><td class="right">\${inrFmt(taxTotal)}</td></tr>\` : ''}
      \`;
      const totalsFoot = document.querySelector('.totals table tfoot');
      totalsFoot.innerHTML = \`<tr class="grand"><td><b>Total</b></td><td class="right"><b>\${inrFmt(grand)}</b></td></tr>\`;

      const numberToWords = ${numberToWords.toString()};
      const amountSection = document.getElementById('amountSection');
      if (amountSection) {
        amountSection.innerHTML = \`
          <div style="font-size:13px">
            <div style="margin-bottom:6px"><b>Total Amount (in words): </b> \${numberToWords(Math.floor(grand))} Rupees Only</div>
          </div>
          <div style="font-size:14px;font-weight:500">Amount Payable</div>
          <div style="font-size:18px;font-weight:600;color:#2563eb">\${inrFmt(grand)}</div>
        \`;
      }

      const select = document.getElementById('invoiceType');
      if (select && select.value === 'DELIVERY CHALLAN') toggleChallanMode(true);
    }

    async function saveInvoiceChanges() {
      const dueDate = document.getElementById('editDueDate').value;
      const withGST = document.getElementById('editGST').value === 'true';
      const invoice_due_date = istInputToUTCDate(dueDate);

      const { error } = await sb
        .from('sales')
        .update({ invoice_due_date, invoice_with_gst: withGST })
        .eq('id', saleId);

      if (error) {
        alert('Failed to save changes: ' + error.message);
        console.error(error);
        return;
      }
      toggleEdit();
      await refreshInvoiceContent();
    }
  </script>
</body>
</html>
  `;

    const w = window.open("", "_blank");
    if (!w) { alert("Pop-up blocked. Please allow pop-ups for this site."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  // NEW: Load active orders for selected client
  async function loadOrdersForClient(clientId) {
    setClientOrders([]);
    setSelectedOrderId("");
    setOrderItemsSnapshot([]);
    if (!clientId) return;
    const { data, error } = await supabase
      .from("orders")
      .select("id,order_code,order_at,status")
      .eq("client_id", clientId)
      .eq("status", "Pending")
      .order("order_at", { ascending: false });
    if (error) { console.error(error); return; }
    setClientOrders(data || []);
  }

  // When client changes in the form, also load their active orders
  useEffect(() => {
    if (isEditing && header.client_id) {
      loadOrdersForClient(header.client_id);
    } else {
      setClientOrders([]);
      setSelectedOrderId("");
      setOrderItemsSnapshot([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header.client_id, isEditing]);

  // Auto-populate lines from selected order
  async function applyOrderToLines(orderId) {
    setSelectedOrderId(orderId || "");
    setOrderItemsSnapshot([]);
    if (!orderId) return;

    const [{ data: oi, error: e1 }] = await Promise.all([
      supabase
        .from("ordered_items")
        .select("product_id,quantity,unit,unit_price,tax_rate")
        .eq("order_id", orderId)
        .order("created_at"),
    ]);
    if (e1) { console.error(e1); return; }

    // Snapshot for shortage banner (use the exact order quantities)
    setOrderItemsSnapshot(
      (oi || []).map(it => ({
        product_id: it.product_id,
        quantity: Number(it.quantity || 0),
        unit: it.unit || productMeta(it.product_id)?.unit || "",
      }))
    );

    // Build sale lines: prefer ordered unit/unit_price if present; fallback to product meta
    const newLines = (oi || []).map(it => {
      const p = productMeta(it.product_id);
      // decide default bucket to show some availability if possible
      const clientAvail = availableFor(it.product_id, header.client_id, "CLIENT");
      const bucket = clientAvail > 0 ? "CLIENT" : "GENERIC";
      return {
        product_id: it.product_id,
        from_bucket: bucket,
        quantity: Number(it.quantity || 0),             // keep full order qty (may exceed availability; warning will show)
        unit: (it.unit || p?.unit || ""),
        unit_price: Number((it.unit_price ?? 0)) > 0 ? Number(it.unit_price) : (p?.selling_price ?? ""),
        tax_rate: it.tax_rate || p?.tax_rate || "Tax Exemption",
        max_qty: availableFor(it.product_id, header.client_id, bucket),
      };
    });

    setLines(newLines.length ? newLines : [{ ...EMPTY_LINE }]);
  }

  // pager
  function goPrev() { setPage((p) => Math.max(1, p - 1)); }
  function goNext() { setPage((p) => Math.min(totalPages, p + 1)); }

  const modalTitle = selected ? (isEditing ? `Edit ${selected.sale_id}` : `Sale ${selected.sale_id}`) : "Add Sale";

  // ----- Build product options from GROUPED inventory -----
  const genericOptions = useMemo(() => {
    const opts = [];
    for (const [, g] of groupedInventory.entries()) {
      if (g.client_id !== null) continue;
      if (Number(g.qty_available) <= 0) continue;
      const pid = g.product_id;
      opts.push({ id: `${pid}::GENERIC`, product_id: pid, bucket: "GENERIC", label: `${productName(pid)} (Any)` });
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [groupedInventory, products]);

  const clientOptions = useMemo(() => {
    if (!header.client_id) return [];
    const opts = [];
    for (const [, g] of groupedInventory.entries()) {
      if (g.client_id !== header.client_id) continue;
      if (Number(g.qty_available) <= 0) continue;
      const pid = g.product_id;
      opts.push({ id: `${pid}::CLIENT`, product_id: pid, bucket: "CLIENT", label: `${productName(pid)} (Client)` });
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [groupedInventory, header.client_id, products]);

  return (
    <NavFrame>
      <div className="wrap">
        <header className="bar">
          <h1 className="title">Sales</h1>
          <button className="btn primary modal-btn" onClick={openAdd}>+ Add Sale</button>
        </header>

        {/* Filters Toolbar */}
        <div className="toolbar">
          <input
            className="input"
            placeholder="Search by Sale ID…"
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

          <select
            className="input"
            value={filterTax}
            onChange={(e) => { setPage(1); setFilterTax(e.target.value); }}
          >
            <option value="ALL">Tax: All</option>
            <option value="WITH_TAX">Tax: With Tax</option>
            <option value="WITHOUT_TAX">Tax: Without Tax</option>
          </select>

          <button className="btn" onClick={clearFilters}>Clear</button>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Sale ID</th><th>Client</th><th>Date</th><th>With Tax</th><th>Delivered</th><th>Delivery Date</th><th className="right">Actions</th></tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan="7" className="muted center">Loading…</td></tr>}
                {!loading && rows.length === 0 && <tr><td colSpan="7" className="muted center">No sales</td></tr>}
                {!loading && rows.map((r) => (
                  <tr key={r.id}>
                    <td data-th="Sale ID">{r.sale_id}</td>
                    <td data-th="Client">{clientName(r.client_id)}</td>
                    <td data-th="Date">{new Date(r.sale_at).toLocaleString("en-IN", { timeZone: IST_TZ })}</td>
                    <td data-th="With Tax">{r.with_tax ? "Yes" : "No"}</td>
                    <td data-th="Delivered">{r.delivered ? "Yes" : "No"}</td>
                    <td data-th="Delivery Date">{r.delivery_at ? new Date(r.delivery_at).toLocaleString("en-IN", { timeZone: IST_TZ }) : "-"}</td>
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
                      <div className="detail-row"><div className="detail-label">Client</div><div className="detail-value">{clientName(header.client_id)}</div></div>
                      <div className="detail-row"><div className="detail-label">Sale Date & Time</div>
                        <div className="detail-value">{new Date(istInputToUTCDate(header.sale_at) || new Date()).toLocaleString("en-IN", { timeZone: IST_TZ })}</div>
                      </div>
                    </div>
                    <div className="details-col">
                      <div className="detail-row"><div className="detail-label">Tax Mode</div><div className="detail-value">{header.with_tax ? "With Tax" : "Without Tax"}</div></div>
                      <div className="detail-row"><div className="detail-label">Delivered</div><div className="detail-value">{header.delivered ? "Yes" : "No"}</div></div>
                    </div>
                  </div>

                  {/* Items */}
                  <div style={{ marginTop: 12, marginBottom: 8, fontWeight: 700 }}>Line Items</div>
                  <div className="card" style={{ padding: 12, maxHeight: "52vh", overflow: "auto" }}>
                    <div className="table-wrap">
                      <table className="tbl">
                        <thead style={{ zIndex: "0" }}><tr><th>Product</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Tax Rate</th></tr></thead>
                        <tbody>{lines.map((ln, idx) => (
                          <tr key={idx}>
                            <td data-th="Product">{productName(ln.product_id)}</td>
                            <td data-th="Qty">{ln.quantity}</td>
                            <td data-th="Unit">{ln.unit}</td>
                            <td data-th="Unit Price">{inr(ln.unit_price)}</td>
                            <td data-th="Tax Rate">{ln.tax_rate}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>

                  {/* Totals & Actions */}
                  <div className="modal-actions between margin-bottom" style={{ marginTop: 8 }}>
                    <div className="muted">Subtotal: {inr(totals.sub)} • Tax: {inr(totals.tax)} • Grand Total: <b>{inr(totals.grand)}</b></div>
                  </div>
                  <div className="totals-actions-bar margin-bottom">
                    <button className="btn" onClick={closeModal}>Close</button>
                    {!header.delivered && (
                      <button className="btn" onClick={() => setConfirmDeliverOpen(true)}>Mark as Delivered</button>
                    )}
                    {selected.invoice_date ? (
                      <button className="btn primary" onClick={() => openInvoiceTab(selected.id)}>View Invoice</button>
                    ) : (
                      <button className="btn primary" onClick={beginCreateInvoice}>Create Invoice</button>
                    )}
                  </div>

                  {/* Confirm Deliver */}
                  {confirmDeliverOpen && (
                    <div className="confirm">
                      <div className="confirm-card">
                        <div className="confirm-title">Mark as delivered?</div>
                        <div className="detail-row" style={{ margin: "8px 0 12px" }}>
                          <div className="detail-label">Delivery Date</div>
                          <input className="input" type="datetime-local" value={header.delivery_at || istNowInput()}
                            onChange={(e) => setHeader((h) => ({ ...h, delivery_at: e.target.value }))} />
                        </div>
                        <div className="confirm-actions">
                          <button className="btn modal-btn" onClick={() => setConfirmDeliverOpen(false)}>Cancel</button>
                          <button className="btn primary modal-btn" onClick={markDeliveredNow}>Confirm</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Create Invoice Prompt */}
                  {invoicePromptOpen && (
                    <div className="confirm">
                      <div className="confirm-card">
                        <div className="confirm-title">Create Invoice</div>
                        <label className="lbl" style={{ marginTop: 8 }}>
                          <span className="lbl-text">Invoice Due Date</span>
                          <input className="input" type="datetime-local" value={invoiceDueAt} onChange={(e) => setInvoiceDueAt(e.target.value)} />
                        </label>
                        <div className="detail-row" style={{ gridTemplateColumns: "180px 1fr", marginTop: 8 }}>
                          <div className="detail-label" style={{ paddingTop: 9 }}>Tax Mode</div>
                          <div className="detail-value" style={{ gap: 12 }}>
                            <label className="check" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              <input type="radio" name="inv_gst" checked={!!invoiceWithGST} onChange={() => setInvoiceWithGST(true)} />
                              <span>With GST</span>
                            </label>
                            <label className="check" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              <input type="radio" name="inv_gst" checked={!invoiceWithGST} onChange={() => setInvoiceWithGST(false)} />
                              <span>Without GST</span>
                            </label>
                          </div>
                        </div>
                        <div className="confirm-actions" style={{ marginTop: 12 }}>
                          <button className="btn modal-btn" onClick={() => setInvoicePromptOpen(false)}>Cancel</button>
                          <button className="btn primary modal-btn" onClick={confirmCreateInvoice}>Save & Open</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* EDIT/CREATE MODE */
                <form onSubmit={handleSubmit}>
                  {/* NEW: Shortage banner (only in edit/create) */}
                  {shortages.length > 0 && (
                    <div
                      className="card"
                      style={{
                        marginBottom: 12,
                        border: "1px solid #fecaca",
                        background: "#fef2f2",
                        color: "#991b1b",
                        padding: 12,
                        borderRadius: 12
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>
                        Not enough stock to fulfill the selected order:
                      </div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {shortages.map(s => (
                          <div key={s.product_id} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                            <span style={{ minWidth: 220 }}>{s.name}</span>
                            <span className="muted">Needed: {s.need} {s.unit}</span>
                            <span className="muted">Available: {s.have} {s.unit}</span>
                            <b>Shortage: {s.shortage} {s.unit}</b>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="details-grid">
                    <div className="details-col">
                      <label className="lbl">
                        <span className="lbl-text">Client *</span>
                        <SearchSelect
                          placeholder="Search client…"
                          options={clients.map((c) => ({ id: c.id, label: c.name }))}
                          valueId={header.client_id}
                          onChange={(opt) => {
                            // Reset order selection when client changes
                            setSelectedOrderId("");
                            setOrderItemsSnapshot([]);
                            setHeader({ ...header, client_id: opt?.id || "" });
                            // Clear lines to avoid mixing cross-client data
                            setLines([{ ...EMPTY_LINE }]);
                          }}
                        />
                      </label>

                      {/* NEW: Active Orders dropdown */}


                      <label className="lbl">
                        <span className="lbl-text">Sale Date &amp; Time</span>
                        <input
                          className="input"
                          type="datetime-local"
                          value={header.sale_at}
                          onChange={(e) => setHeader({ ...header, sale_at: e.target.value })}
                          required
                        />
                      </label>
                    </div>

                    <div className="details-col">
                      <label className="lbl">
                        <span className="lbl-text">Active Orders for Client</span>
                        <select
                          className="input"
                          value={selectedOrderId}
                          onChange={(e) => applyOrderToLines(e.target.value)}
                          disabled={!header.client_id || clientOrders.length === 0}
                        >
                          <option value="">
                            {header.client_id
                              ? (clientOrders.length ? "Choose an order…" : "No active orders")
                              : "Select client first"}
                          </option>
                          {clientOrders.map(o => (
                            <option key={o.id} value={o.id}>
                              {`${o.order_code || o.id.slice(0, 8)} — ${fmtISTDate(o.order_at)} — ${o.status}`}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="lbl">
                        <span className="lbl-text">Brief Description</span>
                        <input
                          className="input input--sm"
                          maxLength={160}
                          placeholder="Brief description…"
                          value={header.description}
                          onChange={(e) => setHeader({ ...header, description: e.target.value })}
                        />
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
                      const isTaxExempt = ln.tax_rate === "Tax Exemption";
                      const opts = [...genericOptions, ...clientOptions];
                      const currentValueId = ln.product_id ? `${ln.product_id}::${ln.from_bucket}` : "";
                      return (
                        <div key={idx} className="line-wrap">
                          <div className="line-row line-row--uniform">
                            <div className="uniform-field">
                              <SearchSelect
                                placeholder="Search product…"
                                options={opts}
                                valueId={currentValueId}
                                onChange={(opt) => {
                                  if (!opt) return onProductChange(idx, null);
                                  onProductChange(idx, { product_id: opt.product_id, bucket: opt.bucket });
                                }}
                              />
                            </div>

                            <input
                              className="input uniform-input"
                              type="number"
                              inputMode="decimal"
                              step="0.001"
                              placeholder="Qty"
                              value={ln.quantity}
                              onChange={(e) => {
                                const v = e.target.value; const n = Number(v);
                                const max = Number(availableFor(ln.product_id, header.client_id, ln.from_bucket) || 0);
                                if (v === "" || (n >= 0 && n <= max)) setLine(idx, { quantity: v });
                              }}
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
                              disabled={p?.tax_rate === "Tax Exemption" || isTaxExempt}
                              required
                            >
                              {TAX_OPTIONS.map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>

                            <button type="button" className="btn danger" onClick={() => removeLine(idx)}>
                              Remove
                            </button>
                          </div>

                          {/* helper text */}
                          {ln.product_id && (
                            <div className="line-hint">
                              Bucket: {ln.from_bucket === "CLIENT" ? "Client-specific" : "Generic"} • Available:{" "}
                              {availableFor(ln.product_id, header.client_id, ln.from_bucket)}
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
                    <div className="muted">Subtotal: {inr(totals.sub)} • Tax: {inr(totals.tax)} • Grand Total: <b>{inr(totals.grand)}</b></div>
                  </div>
                  <div className="modal-actions margin-bottom">
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

/* ===== Portaled Searchable Select ===== */
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