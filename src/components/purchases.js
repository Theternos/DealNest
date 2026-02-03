// purchases.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { createPortal } from "react-dom";
import "../styles/clients.css";
import NavFrame from "./nav";
import { getSession } from "./login";

const TAX_OPTIONS = ["Tax Exemption", "5%", "2.5%", "12%", "18%"];
const MOP_OPTIONS = ["Cash", "Bank Transfer", "UPI"];

// --- IST time helpers ---
const IST_TIMEZONE = "Asia/Kolkata";

// Converts a Date to an ISO string formatted for <input type="datetime-local"> in IST
function formatForDatetimeLocalIST(date = new Date()) {
  const opts = {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  const parts = new Intl.DateTimeFormat("en-CA", opts)
    .formatToParts(date)
    .reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// Formats for human readable IST
function formatISTDisplay(date) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

const EMPTY_HEADER = {
  vendor_id: "",
  client_id: "",
  purchase_at: formatForDatetimeLocalIST(),
  mode_of_payment: "Cash",
  description: "",
};

const EMPTY_LINE = {
  product_id: "",
  quantity: "",
  unit: "",
  unit_price: "",
  tax_rate: "Tax Exemption",
  delivered: false,
  freight_charge_split: 0,
};

// delivered filter maps to status: "All Delivered" => Closed; "Any Undelivered" => not Closed
const DELIVERED_OPTIONS = ["Any", "All Delivered", "Any Undelivered"];
const STATUS_OPTIONS = ["Any", "Open", "Closed"];

/** ========= NEW: page view tabs ========= **/
const VIEW_TABS = {
  HISTORY: "HISTORY",
  DEMAND: "DEMAND",
};

// Session storage keys and helpers
const SESSION_KEYS = {
  PURCHASE_HEADER: "purchase_form_header",
  PURCHASE_LINES: "purchase_form_lines",
  TIMESTAMP: "purchase_form_timestamp"
};

const SESSION_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

function saveToSessionStorage(header, lines) {
  const data = {
    header,
    lines,
    timestamp: Date.now()
  };
  try {
    sessionStorage.setItem(SESSION_KEYS.PURCHASE_HEADER, JSON.stringify(header));
    sessionStorage.setItem(SESSION_KEYS.PURCHASE_LINES, JSON.stringify(lines));
    sessionStorage.setItem(SESSION_KEYS.TIMESTAMP, data.timestamp.toString());
  } catch (error) {
    console.warn("Failed to save to session storage:", error);
  }
}

function loadFromSessionStorage() {
  try {
    const timestamp = sessionStorage.getItem(SESSION_KEYS.TIMESTAMP);
    if (!timestamp) return null;

    const now = Date.now();
    if (now - parseInt(timestamp) > SESSION_EXPIRY_MS) {
      clearSessionStorage();
      return null;
    }

    const header = sessionStorage.getItem(SESSION_KEYS.PURCHASE_HEADER);
    const lines = sessionStorage.getItem(SESSION_KEYS.PURCHASE_LINES);

    if (header && lines) {
      return {
        header: JSON.parse(header),
        lines: JSON.parse(lines)
      };
    }
  } catch (error) {
    console.warn("Failed to load from session storage:", error);
  }
  return null;
}

function clearSessionStorage() {
  try {
    sessionStorage.removeItem(SESSION_KEYS.PURCHASE_HEADER);
    sessionStorage.removeItem(SESSION_KEYS.PURCHASE_LINES);
    sessionStorage.removeItem(SESSION_KEYS.TIMESTAMP);
  } catch (error) {
    console.warn("Failed to clear session storage:", error);
  }
}

function hasFormData(header, lines) {
  // Check if header has any non-empty fields (excluding purchase_at which is always set)
  const headerFields = Object.entries(header).filter(([key]) => key !== 'purchase_at');
  const hasHeaderData = headerFields.some(([key, value]) => {
    if (key === 'vendor_id' || key === 'client_id') {
      return value !== "";
    }
    return value !== "" && value !== EMPTY_HEADER[key];
  });

  // Check if lines have any data beyond the first empty line
  const hasLinesData = lines.some((line, index) => {
    if (index === 0 && lines.length === 1) {
      // For single line, check if any field has data
      return Object.values(line).some(value =>
        value !== "" &&
        value !== EMPTY_LINE[Object.keys(EMPTY_LINE)[Object.values(EMPTY_LINE).indexOf(value)]]
      );
    }
    return true;
  });

  return hasHeaderData || hasLinesData || lines.length > 1;
}

export default function Purchases() {
  /** ========== Tab state ========== */
  const [view, setView] = useState(
    localStorage.getItem("purchases.view") || VIEW_TABS.HISTORY
  );
  useEffect(() => {
    localStorage.setItem("purchases.view", view);
  }, [view]);

  // list + pagination (history tab)
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

  // ref data
  const [vendors, setVendors] = useState([]);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);

  // ui
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // filters (history tab)
  const [filterStatus, setFilterStatus] = useState("Any");
  const [filterVendorId, setFilterVendorId] = useState("");
  const [filterClientId, setFilterClientId] = useState("");
  const [filterDelivered, setFilterDelivered] = useState("Any"); // Any / All Delivered / Any Undelivered
  // add near your other state
  const [purchaseFilter, setPurchaseFilter] = useState(''); // '', 'fully', 'partial', 'none'

  // modal (history tab)
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selected, setSelected] = useState(null); // selected purchase row
  const [isEditing, setIsEditing] = useState(false);

  // delivery mode ui
  const [deliverMode, setDeliverMode] = useState(false);
  const [deliverSelected, setDeliverSelected] = useState({}); // {lineId: boolean}
  const [deliverAll, setDeliverAll] = useState(false);
  const [freightCharge, setFreightCharge] = useState("");

  // form
  const [header, setHeader] = useState(EMPTY_HEADER);
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);

  // Save to session storage whenever header or lines change in edit mode
  useEffect(() => {
    if (modalOpen && isEditing && !selected) {
      saveToSessionStorage(header, lines);
    }
  }, [header, lines, modalOpen, isEditing, selected]);

  // Check if form has data for Clear All button
  const hasFormDataState = useMemo(() =>
    hasFormData(header, lines),
    [header, lines]
  );

  const allDelivered = useMemo(
    () => lines.length > 0 && lines.every((l) => !!l.delivered),
    [lines]
  );

  // Prevent edits/deletes when all items delivered OR purchase is Closed
  const preventMutations = useMemo(
    () => !!allDelivered || selected?.status === "Closed",
    [allDelivered, selected]
  );

  // Split lines into delivered and undelivered for display
  const { deliveredLines, undeliveredLines } = useMemo(() => {
    const delivered = [];
    const undelivered = [];
    lines.forEach((line) => {
      if (line.delivered) {
        delivered.push(line);
      } else {
        undelivered.push(line);
      }
    });
    return { deliveredLines: delivered, undeliveredLines: undelivered };
  }, [lines]);

  /** ======= DEMAND tab state ======= */
  const [demandLoading, setDemandLoading] = useState(false);
  const [demandRows, setDemandRows] = useState([]); // computed rows
  const [filteredDemandRows, setFilteredDemandRows] = useState([]); // filtered rows for display
  const [demandHideCovered, setDemandHideCovered] = useState(false); // optionally hide NetNeeded=0
  const [demandSearch, setDemandSearch] = useState(''); // search term for product name
  const [selectedClientId, setSelectedClientId] = useState(''); // selected client ID for filter
  const [allClients, setAllClients] = useState([]); // all clients for filter dropdown
  const [demandPage, setDemandPage] = useState(1);
  const demandPageSize = 10;
  const demandTotalPages = useMemo(
    () => Math.max(1, Math.ceil((filteredDemandRows.length || 0) / demandPageSize)),
    [filteredDemandRows.length]
  );
  const demandFrom = (demandPage - 1) * demandPageSize;
  const demandTo = Math.min(demandFrom + demandPageSize, filteredDemandRows.length);
  const paginatedDemandRows = useMemo(
    () => filteredDemandRows.slice(demandFrom, demandTo),
    [filteredDemandRows, demandFrom, demandTo]
  );

  // Pagination handlers
  const goToDemandPage = (page) => {
    setDemandPage(page);
  };

  const goToPrevDemandPage = () => {
    setDemandPage(p => Math.max(1, p - 1));
  };

  const goToNextDemandPage = () => {
    setDemandPage(p => Math.min(demandTotalPages, p + 1));
  };

  // load refs
  useEffect(() => {
    (async () => {
      const [{ data: v }, { data: p }, { data: c }] = await Promise.all([
        supabase.from("vendors").select("id,name").order("name"),
        supabase
          .from("products")
          .select("id,name,unit,tax_rate,purchase_price,product_type")
          .order("name"),
        supabase.from("clients").select("id,name").order("name"),
      ]);
      setVendors(v || []);
      setProducts(p || []);
      setClients(c || []);
    })();
  }, []);

  /** =========================
   * HISTORY tab listing + filters
   * ========================= */
  async function fetchPurchases() {
    if (view !== VIEW_TABS.HISTORY) return;
    setLoading(true);

    let q = supabase
      .from("purchases")
      .select(
        "id,purchase_id,vendor_id,client_id,purchase_at,mode_of_payment,description,status,freight_charge_total,created_at,deleted",
        { count: "exact" }
      )
      .eq("deleted", false)
      .order("created_at", { ascending: false })
      .range(from, to);

    const term = (search || "").trim();
    if (term) {
      const orExprs = [
        `purchase_id.ilike.%${term}%`,
        `description.ilike.%${term}%`,
        `mode_of_payment.ilike.%${term}%`,
      ];
      q = q.or(orExprs.join(","));
    }

    if (filterStatus === "Open") q = q.neq("status", "Closed");
    if (filterStatus === "Closed") q = q.eq("status", "Closed");

    if (filterDelivered === "All Delivered") q = q.eq("status", "Closed");
    if (filterDelivered === "Any Undelivered") q = q.neq("status", "Closed");

    if (filterVendorId) q = q.eq("vendor_id", filterVendorId);
    if (filterClientId) q = q.eq("client_id", filterClientId);

    const { data, count: c, error } = await q;
    setLoading(false);
    if (error) {
      console.error("fetch purchases error:", error);
      return;
    }
    setRows(data || []);
    setCount(c || 0);
  }
  useEffect(() => {
    fetchPurchases(); // eslint-disable-line
  }, [view, page, search, filterStatus, filterVendorId, filterClientId, filterDelivered]);

  // helpers
  const vendorName = (id) => vendors.find((v) => v.id === id)?.name || "-";
  const clientName = (id) => clients.find((c) => c.id === id)?.name || "-";
  const productName = (id) => products.find((p) => p.id === id)?.name || "-";
  const productById = (id) => products.find((p) => p.id === id);
  const inr = (n) =>
    `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  function clearFilters() {
    setSearch("");
    setFilterStatus("Any");
    setFilterVendorId("");
    setFilterClientId("");
    setFilterDelivered("Any");
    setPage(1);
  }

  // Clear all form fields
  const clearAllFields = () => {
    setHeader({
      ...EMPTY_HEADER,
      purchase_at: formatForDatetimeLocalIST(),
    });
    setLines([{ ...EMPTY_LINE }]);
    clearSessionStorage();
  };

  // Set up delivery mode with all items selected by default
  const handleSetDeliverMode = (value) => {
    setDeliverMode(value);
    if (value) {
      // When entering deliver mode, select all undelivered items by default
      const selected = {};
      undeliveredLines.forEach((line) => {
        selected[line.id] = true;
      });
      setDeliverSelected(selected);
      setDeliverAll(undeliveredLines.length > 0);
    } else {
      // When exiting deliver mode, clear selections
      setDeliverSelected({});
      setDeliverAll(false);
    }
  };

  // openers
  function openAdd() {
    setSelected(null);

    // Load from session storage if available
    const savedData = loadFromSessionStorage();
    if (savedData) {
      setHeader({
        ...savedData.header,
        purchase_at: savedData.header.purchase_at || formatForDatetimeLocalIST(),
      });
      setLines(savedData.lines.length > 0 ? savedData.lines : [{ ...EMPTY_LINE }]);
    } else {
      setHeader({
        ...EMPTY_HEADER,
        purchase_at: formatForDatetimeLocalIST(),
      });
      setLines([{ ...EMPTY_LINE }]);
    }

    setIsEditing(true);
    setConfirmOpen(false);
    setDeliverMode(false);
    setDeliverSelected({});
    setDeliverAll(false);
    setFreightCharge("");
    setModalOpen(true);
  }

  async function openView(row) {
    setSelected(row);
    setHeader({
      vendor_id: row.vendor_id,
      client_id: row.client_id || "",
      purchase_at: formatForDatetimeLocalIST(new Date(row.purchase_at)), // convert UTC→IST
      mode_of_payment: row.mode_of_payment,
      description: row.description || "",
    });
    const { data: li } = await supabase
      .from("purchase_items")
      .select(
        "id,product_id,quantity,unit,unit_price,tax_rate,delivered,freight_charge_split"
      )
      .eq("purchase_id", row.id)
      .order("id");
    setLines((li || []).map((x) => ({ ...x })));
    setIsEditing(false);
    setConfirmOpen(false);

    // reset delivery state
    setDeliverMode(false);
    setDeliverSelected({});
    setDeliverAll(false);
    setFreightCharge("");

    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setSelected(null);
    setIsEditing(false);
    setConfirmOpen(false);
    setDeliverMode(false);
    setDeliverSelected({});
    setDeliverAll(false);
    setFreightCharge("");
    setHeader(EMPTY_HEADER);
    setLines([{ ...EMPTY_LINE }]);

    // Clear session storage when modal closes if not creating new purchase
    if (!isEditing || selected) {
      clearSessionStorage();
    }
  }

  // lines
  function addLine() {
    setLines((arr) => [...arr, { ...EMPTY_LINE }]);
  }
  function removeLine(idx) {
    setLines((arr) => arr.filter((_, i) => i !== idx));
  }
  function setLine(idx, patch) {
    setLines((arr) => arr.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)));
  }
  function onProductChange(idx, opt) {
    if (!opt) {
      setLine(idx, {
        product_id: "",
        unit: "",
        unit_price: "",
        tax_rate: "Tax Exemption",
      });
      return;
    }
    const p = products.find((x) => x.id === opt.id);
    setLine(idx, {
      product_id: opt.id,
      unit: p?.unit || "",
      unit_price: p?.purchase_price ?? "",
      tax_rate: p?.tax_rate || "Tax Exemption",
    });
  }

  // ===== INVENTORY UPSERT/ACCUMULATE (generic bucket, client_id NULL) =====
  async function upsertInventoryAdd(product_id, qty, unit, tax_rate) {
    if (!product_id || !qty) return;
    const delta = Math.abs(Number(qty));

    const { data: existingInv, error: invSelErr } = await supabase
      .from("inventory")
      .select("id,quantity,product_id,client_id")
      .eq("product_id", product_id)
      .is("client_id", null)
      .limit(1);

    if (invSelErr) {
      console.error("Inventory select error:", invSelErr);
      return;
    }

    if (existingInv && existingInv.length > 0) {
      const row = existingInv[0];
      const newQty = Number(row.quantity || 0) + delta;

      const { error: updErr } = await supabase
        .from("inventory")
        .update({
          quantity: newQty,
          unit: unit || null,
          tax_rate: tax_rate || null,
        })
        .eq("id", row.id);

      if (updErr) console.error("Inventory update error:", updErr);
    } else {
      const { error: insErr } = await supabase.from("inventory").insert([
        {
          product_id,
          client_id: null,
          quantity: Number(delta),
          unit: unit || null,
          tax_rate: tax_rate || "Tax Exemption",
        },
      ]);

      if (insErr) console.error("Inventory insert error:", insErr);
    }
  }

  // save (create/update)
  async function handleSave(e) {
    e.preventDefault();
    if (!header.vendor_id) {
      alert("Select vendor");
      return;
    }
    if (!header.mode_of_payment) {
      alert("Select mode of payment");
      return;
    }
    if (lines.length === 0) {
      alert("Add at least one line");
      return;
    }
    if (
      lines.some(
        (l) => !l.product_id || !l.quantity || !l.unit || l.unit_price === ""
      )
    ) {
      alert("Each line needs Product, Quantity, Unit and Unit Price");
      return;
    }

    const headerPayload = {
      vendor_id: header.vendor_id,
      client_id: header.client_id || null,
      purchase_at: new Date(header.purchase_at),
      mode_of_payment: header.mode_of_payment,
      description: header.description?.trim() || null,
    };

    if (!selected) {
      // ---------- CREATE ----------
      // Add current user's name to created_by column
      const session = getSession();
      if (session?.name) {
        headerPayload.created_by = session.name;
      }
      
      const { data: inserted, error: e1 } = await supabase
        .from("purchases")
        .insert([headerPayload])
        .select()
        .single();
      if (e1) {
        alert("Create failed");
        console.error(e1);
        return;
      }

      const items = lines.map((l) => ({
        purchase_id: inserted.id,
        product_id: l.product_id,
        quantity: Number(l.quantity),
        unit: l.unit,
        unit_price: Number(l.unit_price),
        tax_rate: l.tax_rate,
        delivered: !!l.delivered,
        freight_charge_split: Number(l.freight_charge_split || 0),
      }));
      const { error: e2 } = await supabase.from("purchase_items").insert(items);
      if (e2) {
        alert("Items create failed");
        console.error(e2);
        return;
      }

      // Update inventory only
      try {
        // Group by product_id to minimize queries
        const grouped = items.reduce((acc, it) => {
          const key = it.product_id;
          acc[key] = acc[key] || { qty: 0, unit: it.unit, tax_rate: it.tax_rate };
          acc[key].qty += Number(it.quantity) || 0;
          return acc;
        }, {});

        for (const pid of Object.keys(grouped)) {
          const g = grouped[pid];
          // INVENTORY generic bucket (client_id NULL)
          await upsertInventoryAdd(pid, g.qty, g.unit, g.tax_rate);
        }
      } catch (x) {
        console.error("Post-create inventory update failed:", x);
        alert("Created, but failed to update inventory. See console.");
      }
    } else {
      // ---------- UPDATE ----------
      // ---- Harden purchase_at and payload types ----
      const parsedAt = new Date(header.purchase_at); // from <input type="datetime-local">
      if (isNaN(parsedAt.getTime())) {
        alert("Invalid Purchase Date & Time");
        return;
      }

      const updatePayload = {
        ...headerPayload,
        client_id: header.client_id ? header.client_id : null,
        purchase_at: parsedAt.toISOString(),
      };

      if (!selected?.id) {
        alert("No purchase selected (missing id).");
        return;
      }

      const { error: e1 } = await supabase
        .from("purchases")
        .update(updatePayload)
        .eq("id", selected.id);

      if (e1) {
        console.error("Update failed:", e1);
        alert(`Update failed: ${e1.message || e1.code || "unknown error"}`);
        return;
      }

      // Replace items (simple)
      const { error: delErr } = await supabase
        .from("purchase_items")
        .delete()
        .eq("purchase_id", selected.id);
      if (delErr) {
        console.error("Items delete failed:", delErr);
        alert(`Items delete failed: ${delErr.message}`);
        return;
      }

      const items = lines.map((l) => ({
        purchase_id: selected.id,
        product_id: l.product_id,
        quantity: Number(l.quantity),
        unit: l.unit,
        unit_price: Number(l.unit_price),
        tax_rate: l.tax_rate,
        delivered: !!l.delivered,
        freight_charge_split: Number(l.freight_charge_split || 0),
      }));

      const { error: e2 } = await supabase.from("purchase_items").insert(items);
      if (e2) {
        console.error("Items update failed:", e2);
        alert(`Items update failed: ${e2.message}`);
        return;
      }

      // NOTE: For updates, we are not auto-adjusting inventory diffs here,
      // because computing deltas vs. previous state is non-trivial.
    }

    // Clear session storage on successful save
    clearSessionStorage();
    await fetchPurchases();
    closeModal();
  }

  // delete
  async function confirmDelete() {
    if (!selected) return;
    const { error } = await supabase
      .from("purchases")
      .update({ deleted: true })
      .eq("id", selected.id);

    if (error) {
      alert(`Delete failed: ${error.message}`);
      console.error(error);
      return;
    }

    await fetchPurchases();
    closeModal();
  }

  // delivery helpers
  function toggleSelectAll(flag) {
    setDeliverAll(flag);
    const next = {};
    for (const ln of lines) {
      if (!ln.delivered) {
        next[ln.id] = !!flag;
      }
    }
    setDeliverSelected(next);
  }
  function toggleSelectOne(id, flag) {
    const next = { ...deliverSelected, [id]: !!flag };
    setDeliverSelected(next);
    const allIds = lines.map((l) => l.id);
    setDeliverAll(
      allIds.length > 0 &&
      allIds.every((i) => next[i] || lines.find((l) => l.id === i)?.delivered)
    );
  }

  // save delivery (mark selected lines delivered + split freight)
  async function handleSaveDelivery(e) {
    e.preventDefault();

    // Only undelivered items are actionable
    const selectedIds = lines
      .filter((l) => deliverSelected[l.id] && !l.delivered)
      .map((l) => l.id);

    if (selectedIds.length === 0) {
      alert("Select at least one undelivered item");
      return;
    }

    const freight = Number(freightCharge || 0);
    if (isNaN(freight) || freight < 0) {
      alert("Enter a valid freight charge");
      return;
    }

    // Proportional split across selected lines (by quantity * unit_price)
    const selectedLines = lines.filter((l) => selectedIds.includes(l.id));
    const subtotals = selectedLines.map(
      (l) => Number(l.quantity) * Number(l.unit_price)
    );
    const base = subtotals.reduce((a, b) => a + b, 0) || 0;

    // Build new values per line
    const perLineUpdates = [];
    if (freight > 0 && base > 0) {
      let allocated = 0;
      selectedLines.forEach((l, idx) => {
        let part = Math.round((freight * (subtotals[idx] / base)) * 100) / 100;
        if (idx === selectedLines.length - 1) {
          part = Math.round((freight - allocated) * 100) / 100; // fix rounding residue
        }
        allocated += part;
        perLineUpdates.push({
          id: l.id,
          delivered: true,
          new_split: Number(l.freight_charge_split || 0) + part,
        });
      });
    } else {
      // No freight to split: just mark delivered
      selectedLines.forEach((l) => {
        perLineUpdates.push({
          id: l.id,
          delivered: true,
          new_split: Number(l.freight_charge_split || 0),
        });
      });
    }

    // 1) Update each line with an UPDATE (no UPSERT)
    try {
      const results = await Promise.all(
        perLineUpdates.map((u) =>
          supabase
            .from("purchase_items")
            .update({
              delivered: u.delivered,
              freight_charge_split: u.new_split,
            })
            .eq("id", u.id)
        )
      );
      const firstErr = results.find((r) => r.error)?.error;
      if (firstErr) {
        console.error("Line update error:", firstErr);
        alert(
          `Failed to update line items: ${firstErr.message || "Unknown error"}`
        );
        return;
      }

      // --- Immediately reflect delivery in local state so allDelivered recomputes ---
      setLines((prev) =>
        prev.map((ln) => {
          const upd = perLineUpdates.find((u) => u.id === ln.id);
          return upd
            ? { ...ln, delivered: true, freight_charge_split: upd.new_split }
            : ln;
        })
      );
    } catch (err) {
      console.error("Update crash:", err);
      alert(
        "Failed to update line items (client exception). See console for details."
      );
      return;
    }

    // 2) Accumulate freight on purchase header (if any)
    if (freight > 0) {
      const { error: rpcErr } = await supabase.rpc("increment_purchase_freight", {
        p_id: selected.id,
        delta: freight,
      });
      if (rpcErr) {
        const { error: updErr } = await supabase
          .from("purchases")
          .update({
            freight_charge_total: (selected.freight_charge_total || 0) + freight,
          })
          .eq("id", selected.id);
        if (updErr) {
          console.error("Header freight update error:", updErr);
          alert(`Failed to update purchase freight: ${updErr.message}`);
          return;
        }
      }
    }

    // Refresh and return to view mode
    await openView(selected);
    setDeliverMode(false);
  }

  // pager
  function goPrev() {
    setPage((p) => Math.max(1, p - 1));
  }
  function goNext() {
    setPage((p) => Math.min(totalPages, p + 1));
  }

  const modalTitle = selected
    ? isEditing
      ? `Edit ${selected.purchase_id}`
      : `Purchase ${selected.purchase_id}`
    : "Add Purchase";

  /** =========================
   * DEMAND TAB: Simplified version without order_inventory
   * ========================= */
  const productMap = useMemo(
    () =>
      Object.fromEntries(
        (products || []).map((p) => [
          p.id,
          { name: p.name, unit: p.unit, product_type: p.product_type },
        ])
      ),
    [products]
  );
  const clientMap = useMemo(
    () => Object.fromEntries((clients || []).map((c) => [c.id, c.name])),
    [clients]
  );

  async function loadDemand() {
    if (view !== VIEW_TABS.DEMAND) return;
    setDemandLoading(true);

    try {
      // Fetch ordered quantities (per product/client)
      const { data: orderInvRows, error: eOrderInv } = await supabase
        .from("order_inventory")
        .select("product_id, client_id, qty_available");
      if (eOrderInv) throw eOrderInv;

      // Fetch available inventory (per product/client, can have multiple vendor rows)
      const { data: invRows, error: eInv } = await supabase
        .from("inventory")
        .select("product_id, client_id, qty_available");
      if (eInv) throw eInv;

      // Fetch undelivered purchase items
      const { data: piRows, error: ePI } = await supabase
        .from("purchase_items")
        .select("id, purchase_id, product_id, quantity, delivered")
        .eq("delivered", false);
      if (ePI) throw ePI;

      // Fetch parent purchases (to get client_id and deleted flag)
      const purchaseIds = Array.from(new Set((piRows || []).map((r) => r.purchase_id)));
      let purchasesMap = {};
      if (purchaseIds.length) {
        const { data: purRows, error: ePur } = await supabase
          .from("purchases")
          .select("id, client_id, deleted")
          .in("id", purchaseIds);
        if (!ePur) {
          purchasesMap = Object.fromEntries((purRows || []).map((p) => [p.id, p]));
        }
      }

      // Use existing maps if present; otherwise fetch actives
      let localProductMap = productMap;
      let localClientMap = clientMap;

      if (Object.keys(productMap).length === 0) {
        const { data: productsData, error: eProd } = await supabase
          .from("products")
          .select("id, name, unit, product_type")
          .eq("active", true);
        if (!eProd && productsData) {
          localProductMap = Object.fromEntries(
            productsData.map((p) => [
              p.id,
              { name: p.name, unit: p.unit, product_type: p.product_type },
            ])
          );
        }
      }

      if (Object.keys(clientMap).length === 0) {
        const { data: clientsData, error: eClient } = await supabase
          .from("clients")
          .select("id, name")
          .eq("active", true);
        if (!eClient && clientsData) {
          localClientMap = Object.fromEntries(clientsData.map((c) => [c.id, c.name]));
        }
      }

      // ==== SUM by (product_id|client_id) for both ordered and available ====
      const orderInvMap = {};
      for (const item of orderInvRows || []) {
        const key = `${item.product_id}|${item.client_id || "null"}`;
        const qty = Number(item.qty_available || 0);
        orderInvMap[key] = (orderInvMap[key] || 0) + qty;
      }

      const invMap = {};
      for (const item of invRows || []) {
        const key = `${item.product_id}|${item.client_id || "null"}`;
        const qty = Number(item.qty_available || 0);
        invMap[key] = (invMap[key] || 0) + qty; // sum across vendors / rows
      }

      // Build undelivered purchases map (already summed)
      const purchasedUndeliveredMap = {};
      for (const item of piRows || []) {
        const parent = purchasesMap[item.purchase_id];
        if (!parent || parent.deleted) continue;
        const key = `${item.product_id}|${parent.client_id || "null"}`;
        purchasedUndeliveredMap[key] = (purchasedUndeliveredMap[key] || 0) + Number(item.quantity || 0);
      }

      // Build rows
      const demandData = [];
      const allKeys = new Set([
        ...Object.keys(orderInvMap),
        ...Object.keys(invMap),
        ...Object.keys(purchasedUndeliveredMap),
      ]);

      for (const key of allKeys) {
        const ordered = orderInvMap[key] || 0;
        const available = invMap[key] || 0;
        const purchased_undelivered = purchasedUndeliveredMap[key] || 0;

        // Visibility: keep rows until ordered - available is 0 (ignore undelivered POs)
        const raw_demand = Math.max(ordered - available, 0);
        if (raw_demand <= 0) continue;

        // Displayed demand (never negative)
        const demand = Math.max(ordered - available - purchased_undelivered, 0);

        const [product_id, client_id_str] = key.split("|");
        const client_id = client_id_str === "null" ? null : client_id_str;

        const pMeta = localProductMap[product_id];
        if (!pMeta) continue;

        // Purchase coverage status
        let purchase_status = "none"; // not purchased
        if (purchased_undelivered >= raw_demand && raw_demand > 0) {
          purchase_status = "fully";
        } else if (purchased_undelivered > 0 && purchased_undelivered < raw_demand) {
          purchase_status = "partial";
        }

        demandData.push({
          product_id,
          product_name: pMeta.name || "(Unknown product)",
          client_id,
          client_name: client_id ? localClientMap[client_id] || "(Unknown client)" : "-",
          unit: pMeta.unit || "",
          ordered,
          available,
          purchased_undelivered,
          demand,        // non-negative displayed value
          raw_demand,    // used to decide visibility / coverage calc
          purchase_status, // 'none' | 'partial' | 'fully'
        });
      }

      // For client filter dropdown
      const clientSet = new Set();
      demandData.forEach((row) => {
        if (row.client_id) {
          clientSet.add(JSON.stringify({ id: row.client_id, name: row.client_name }));
        }
      });
      setAllClients(Array.from(clientSet).map((str) => JSON.parse(str)));

      // Push to state and apply filters (includes purchaseFilter)
      setDemandRows(demandData);
      applyDemandFilters(
        demandData,
        demandHideCovered,
        demandSearch,
        selectedClientId,
        purchaseFilter
      );
    } catch (err) {
      setDemandRows([]);
      setFilteredDemandRows([]);
    } finally {
      setDemandLoading(false);
    }
  }



  function applyDemandFilters(rows, hideCovered, searchTerm, clientId, purchaseState) {
    let filtered = [...(rows || [])];

    // Product name search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((r) => r.product_name.toLowerCase().includes(term));
    }

    // Client filter
    if (clientId) {
      filtered = filtered.filter((r) =>
        clientId === "no-client" ? !r.client_id : r.client_id === clientId
      );
    }

    // Purchase status filter: '', 'none', 'partial', 'fully'
    if (purchaseState) {
      filtered = filtered.filter((r) => r.purchase_status === purchaseState);
    }

    setFilteredDemandRows(filtered);
    setDemandPage(1); // reset pagination on filter change
  }




  useEffect(() => {
    applyDemandFilters(demandRows, demandHideCovered, demandSearch, selectedClientId, purchaseFilter);
  }, [demandRows, demandHideCovered, demandSearch, selectedClientId, purchaseFilter]);

  useEffect(() => {
    if (view === VIEW_TABS.DEMAND) {
      loadDemand();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  /** =========================
   * Render
   * ========================= */
  return (
    <NavFrame>
      <div className="wrap">
        {/* Top bar with tabs */}
        <header className="bar" style={{ gap: 12, alignItems: "center" }}>
          {view === VIEW_TABS.HISTORY && (
            <h1 className="title">Purchases</h1>
          )}
          {view !== VIEW_TABS.HISTORY && (
            <h1 className="title">Demand (Undelivered Purchases)</h1>
          )}
          <div className="tabs" role="tablist" aria-label="Select view">
            <button
              type="button"
              className="tab-btn"
              role="tab"
              aria-selected={view === VIEW_TABS.HISTORY}
              onClick={() => setView(VIEW_TABS.HISTORY)}
              title="Purchase history"
            >
              Purchase History
            </button>
            <button
              type="button"
              className="tab-btn"
              role="tab"
              aria-selected={view === VIEW_TABS.DEMAND}
              onClick={() => setView(VIEW_TABS.DEMAND)}
              title="Undelivered purchases"
            >
              Demand
            </button>
          </div>

        </header>
        {view === VIEW_TABS.HISTORY && (
          <button className="btn primary modal-btn" onClick={openAdd}>
            + Add Purchase
          </button>
        )}

        {/* ====== HISTORY VIEW ====== */}
        {view === VIEW_TABS.HISTORY && (
          <>
            {/* ------- Filters Toolbar ------- */}
            <div className="toolbar">
              <select
                className="input"
                value={filterStatus}
                onChange={(e) => {
                  setPage(1);
                  setFilterStatus(e.target.value);
                }}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{`Status: ${s}`}</option>
                ))}
              </select>

              <SearchSelect
                placeholder="Filter vendor…"
                options={vendors.map((v) => ({ id: v.id, label: v.name }))}
                valueId={filterVendorId}
                onChange={(opt) => {
                  setPage(1);
                  setFilterVendorId(opt?.id || "");
                }}
              />

              <SearchSelect
                placeholder="Filter client…"
                options={clients.map((c) => ({ id: c.id, label: c.name }))}
                valueId={filterClientId}
                onChange={(opt) => {
                  setPage(1);
                  setFilterClientId(opt?.id || "");
                }}
              />

              <select
                className="input"
                value={filterDelivered}
                onChange={(e) => {
                  setPage(1);
                  setFilterDelivered(e.target.value);
                }}
              >
                {DELIVERED_OPTIONS.map((d) => (
                  <option key={d} value={d}>{`Delivered: ${d}`}</option>
                ))}
              </select>
              <button className="btn" onClick={clearFilters}>
                Clear
              </button>
            </div>

            <div className="card">
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Purchase ID</th>
                      <th>Vendor</th>
                      <th>Client</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th className="right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan="7" className="muted center">
                          Loading…
                        </td>
                      </tr>
                    )}
                    {!loading && rows.length === 0 && (
                      <tr>
                        <td colSpan="7" className="muted center">
                          No purchases
                        </td>
                      </tr>
                    )}
                    {!loading &&
                      rows.map((r) => (
                        <tr key={r.id}>
                          <td data-th="Purchase ID">{r.purchase_id}</td>
                          <td data-th="Vendor">{vendorName(r.vendor_id)}</td>
                          <td data-th="Client">{clientName(r.client_id)}</td>
                          <td data-th="Date">
                            {new Date(r.purchase_at).toLocaleString()}
                          </td>
                          <td data-th="Status">
                            <span
                              className={`status ${r.status === "Closed"
                                ? "status--active"
                                : "status--inactive"
                                }`}
                            >
                              <span className="dot" />
                              {r.status || "Open"}
                            </span>
                          </td>
                          <td className="right" data-th="Actions">
                            <button className="btn ghost" onClick={() => openView(r)}>
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div className="pager">
                <div className="muted">
                  {count} total • Page {page} of {totalPages}
                </div>
                <div className="pager-controls">
                  <button className="btn" onClick={goPrev} disabled={page <= 1}>
                    Prev
                  </button>
                  <button className="btn" onClick={goNext} disabled={page >= totalPages}>
                    Next
                  </button>
                </div>
              </div>
            </div>

            {modalOpen && (
              <div className="modal">
                <div className="modal-card modal-card--xl" style={{ width: "80vw" }}>
                  <div className="modal-head">
                    <h2 className="modal-title">{modalTitle}</h2>
                    <button className="btn icon" onClick={closeModal} aria-label="Close">
                      ×
                    </button>
                  </div>

                  <form onSubmit={handleSave}>
                    {/* ---------- DELIVERY MODE ---------- */}
                    {deliverMode ? (
                      <>
                        <div className="details-grid">
                          <div className="details-col">
                            <div className="detail-row">
                              <div className="detail-label">Purchase</div>
                              <div className="detail-value">{selected?.purchase_id}</div>
                            </div>
                            <div className="detail-row">
                              <div className="detail-label">Vendor</div>
                              <div className="detail-value">
                                {vendorName(header.vendor_id)}
                              </div>
                            </div>
                          </div>
                          <div className="details-col">
                            <label className="lbl">
                              <span className="lbl-text">Freight Charge (this delivery)</span>
                              <input
                                className="input input--sm"
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={freightCharge}
                                onChange={(e) => setFreightCharge(e.target.value)}
                              />
                            </label>
                          </div>
                        </div>

                        <div
                          style={{
                            marginTop: 12,
                            marginBottom: 8,
                            fontWeight: 700,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <span>Select Items to mark as Delivered</span>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={deliverAll}
                              onChange={(e) => toggleSelectAll(e.target.checked)}
                            />
                            <span>Select all</span>
                          </label>
                        </div>

                        <div className="card" style={{ padding: 12 }}>
                          <div className="table-wrap">
                            <table className="tbl">
                              <thead>
                                <tr>
                                  <th style={{ width: 60 }}>Pick</th>
                                  <th>Product</th>
                                  <th>Qty</th>
                                  <th>Unit</th>
                                  <th>Unit Price</th>
                                  <th>Delivered?</th>
                                </tr>
                              </thead>
                              <tbody>
                                {undeliveredLines.map((ln) => {
                                  const checked = !!deliverSelected[ln.id];
                                  return (
                                    <tr key={ln.id}>
                                      <td className="check" data-th="Pick">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) =>
                                            toggleSelectOne(ln.id, e.target.checked)
                                          }
                                        />
                                      </td>
                                      <td data-th="Product">{productName(ln.product_id)}</td>
                                      <td data-th="Qty">{ln.quantity}</td>
                                      <td data-th="Unit">{ln.unit}</td>
                                      <td data-th="Unit Price">{inr(ln.unit_price)}</td>
                                      <td data-th="Delivered?">No</td>
                                    </tr>
                                  );
                                })}
                                {undeliveredLines.length === 0 && (
                                  <tr>
                                    <td colSpan="6" className="muted center">
                                      All items have been delivered
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="modal-actions between" style={{ marginTop: 12 }}>
                          <button
                            type="button"
                            className="btn modal-btn"
                            onClick={() => setDeliverMode(false)}
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            className="btn primary modal-btn"
                            onClick={handleSaveDelivery}
                          >
                            Save Delivery
                          </button>
                        </div>
                      </>
                    ) : (
                      /* ---------- NORMAL MODE: VIEW or EDIT ---------- */
                      <>
                        {/* ---------- VIEW MODE (read-only) ---------- */}
                        {!isEditing ? (
                          <>
                            {/* Header: Vendor + Client same row */}
                            <div className="details-grid">
                              <div className="details-col">
                                <div className="detail-row">
                                  <div className="detail-label">Vendor</div>
                                  <div className="detail-value">
                                    {vendorName(header.vendor_id)}
                                  </div>
                                </div>

                                <div className="detail-row">
                                  <div className="detail-label">Mode of Payment</div>
                                  <div className="detail-value">
                                    {header.mode_of_payment}
                                  </div>
                                </div>

                                <div className="detail-row">
                                  <div className="detail-label">
                                    Purchase Date & Time
                                  </div>
                                  <div className="detail-value">
                                    {new Date(header.purchase_at).toLocaleString()}
                                  </div>
                                </div>
                              </div>

                              <div className="details-col">
                                <div className="detail-row">
                                  <div className="detail-label">Client</div>
                                  <div className="detail-value">
                                    {clientName(header.client_id)}
                                  </div>
                                </div>
                                <div className="detail-row">
                                  <div className="detail-label">Brief Description</div>
                                  <div className="detail-value">
                                    {header.description || (
                                      <span className="muted">-</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Line items (read-only table) */}
                            <div
                              style={{ marginTop: 12, marginBottom: 8, fontWeight: 700 }}
                            >
                              Line Items
                            </div>
                            <div className="card" style={{ padding: 12 }}>
                              <div className="table-wrap">
                                <table className="tbl">
                                  <thead>
                                    <tr>
                                      <th>Product</th>
                                      <th>Qty</th>
                                      <th>Unit</th>
                                      <th>Unit Price</th>
                                      <th>Tax Rate</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {lines.length === 0 && (
                                      <tr>
                                        <td colSpan="5" className="muted center">
                                          No items
                                        </td>
                                      </tr>
                                    )}
                                    {lines.map((ln, idx) => (
                                      <tr key={idx}>
                                        <td data-th="Product">{productName(ln.product_id)}</td>
                                        <td data-th="Qty">{ln.quantity}</td>
                                        <td data-th="Unit">{ln.unit}</td>
                                        <td data-th="Unit Price">
                                          {(() => {
                                            const split = Number(ln.freight_charge_split || 0);
                                            const qty = Number(ln.quantity || 0);
                                            const perUnitFreight = qty > 0 ? split / qty : 0;
                                            const totalPerUnit =
                                              Number(ln.unit_price) + perUnitFreight;
                                            return `${inr(totalPerUnit)} = (${inr(
                                              ln.unit_price
                                            )} + ${inr(perUnitFreight)})`;
                                          })()}
                                        </td>
                                        <td data-th="Tax Rate">{ln.tax_rate}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            {/* Footer actions (view-only) */}
                            <div
                              className="purchase-view-actions margin-bottom"
                              role="toolbar"
                              aria-label="Purchase actions"
                            >
                              <button
                                type="button"
                                className="btn modal-btn"
                                onClick={closeModal}
                              >
                                Close
                              </button>

                              {selected && !allDelivered && (
                                <button
                                  type="button"
                                  className="btn modal-btn"
                                  style={{ backgroundColor: "#2563eb", color: "white" }}
                                  onClick={() => handleSetDeliverMode(true)}
                                >
                                  Mark as Delivered
                                </button>
                              )}

                              {selected && (
                                <>
                                  {!preventMutations && (
                                    <button
                                      type="button"
                                      className="btn modal-btn danger"
                                      onClick={() => setConfirmOpen(true)}
                                    >
                                      Delete
                                    </button>
                                  )}
                                  {!preventMutations && (
                                    <button
                                      type="button"
                                      className="btn modal-btn primary"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setIsEditing(true);
                                      }}
                                    >
                                      Edit
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </>
                        ) : (
                          /* ---------- EDIT MODE (inputs) ---------- */
                          <>
                            {/* Header */}
                            <div className="details-grid">
                              <div className="details-col">
                                {/* Vendor */}
                                <label className="lbl">
                                  <span className="lbl-text">Vendor *</span>
                                  <SearchSelect
                                    placeholder="Search vendor…"
                                    options={vendors.map((v) => ({
                                      id: v.id,
                                      label: v.name,
                                    }))}
                                    valueId={header.vendor_id}
                                    onChange={(opt) =>
                                      setHeader({ ...header, vendor_id: opt?.id || "" })
                                    }
                                  />
                                </label>

                                <label className="lbl">
                                  <span className="lbl-text">Mode of Payment</span>
                                  <select
                                    className="input"
                                    value={header.mode_of_payment}
                                    onChange={(e) =>
                                      setHeader({
                                        ...header,
                                        mode_of_payment: e.target.value,
                                      })
                                    }
                                    required
                                  >
                                    {MOP_OPTIONS.map((m) => (
                                      <option key={m} value={m}>
                                        {m}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="lbl">
                                  <span className="lbl-text">Purchase Date &amp; Time</span>
                                  <input
                                    className="input"
                                    type="datetime-local"
                                    value={header.purchase_at}
                                    onChange={(e) =>
                                      setHeader({
                                        ...header,
                                        purchase_at: e.target.value,
                                      })
                                    }
                                    required
                                  />
                                </label>
                              </div>

                              <div className="details-col">
                                {/* Client */}
                                <label className="lbl">
                                  <span className="lbl-text">Client (optional)</span>
                                  <SearchSelect
                                    placeholder="Search client…"
                                    options={clients.map((c) => ({
                                      id: c.id,
                                      label: c.name,
                                    }))}
                                    valueId={header.client_id}
                                    onChange={(opt) =>
                                      setHeader({ ...header, client_id: opt?.id || "" })
                                    }
                                  />
                                </label>

                                <label className="lbl">
                                  <span className="lbl-text">Brief Description</span>
                                  <input
                                    className="input input--sm"
                                    maxLength={160}
                                    placeholder="Brief description…"
                                    value={header.description}
                                    onChange={(e) =>
                                      setHeader({ ...header, description: e.target.value })
                                    }
                                  />
                                </label>
                              </div>
                            </div>

                            {/* Line items (editable) */}
                            <div
                              style={{ marginTop: 12, marginBottom: 8, fontWeight: 700 }}
                            >
                              Line Items
                            </div>
                            <div className="card" style={{ padding: 12 }}>
                              <div className="line-head">
                                <div>Product</div>
                                <div>Qty</div>
                                <div>Unit</div>
                                <div>Unit Price</div>
                                <div>Tax Rate</div>
                                <div></div>
                              </div>

                              {lines.map((ln, idx) => (
                                <div key={idx} className="line-row">
                                  <SearchSelect
                                    placeholder="Search product…"
                                    options={products.map((p) => ({
                                      id: p.id,
                                      label: p.name,
                                    }))}
                                    valueId={ln.product_id}
                                    onChange={(opt) => onProductChange(idx, opt)}
                                  />

                                  <input
                                    className="input"
                                    type="number"
                                    inputMode="decimal"
                                    step="0.001"
                                    placeholder="Qty"
                                    value={ln.quantity}
                                    onChange={(e) =>
                                      setLine(idx, { quantity: e.target.value })
                                    }
                                    required
                                  />

                                  <input
                                    className="input"
                                    placeholder="Unit"
                                    value={ln.unit}
                                    onChange={(e) => setLine(idx, { unit: e.target.value })}
                                    required
                                  />

                                  <input
                                    className="input"
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    placeholder="Unit Price"
                                    value={ln.unit_price}
                                    onChange={(e) =>
                                      setLine(idx, { unit_price: e.target.value })
                                    }
                                    required
                                  />

                                  <select
                                    className="input"
                                    value={ln.tax_rate}
                                    onChange={(e) =>
                                      setLine(idx, { tax_rate: e.target.value })
                                    }
                                    required
                                  >
                                    {TAX_OPTIONS.map((t) => (
                                      <option key={t} value={t}>
                                        {t}
                                      </option>
                                    ))}
                                  </select>

                                  <button
                                    type="button"
                                    className="btn danger"
                                    onClick={() => removeLine(idx)}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}

                              <div style={{ marginTop: 8 }}>
                                <button type="button" className="btn" onClick={addLine}>
                                  + Add Line
                                </button>
                              </div>
                            </div>

                            {/* Footer actions (edit mode) */}
                            <div className="modal-actions between" style={{ marginTop: 12 }}>
                              {!selected && hasFormDataState && (
                                <button
                                  type="button"
                                  className="btn modal-btn danger width-100"
                                  onClick={clearAllFields}
                                  style={{ marginRight: '8px' }}
                                >
                                  Clear All
                                </button>
                              )}
                              {selected && (
                                <button
                                  type="button"
                                  className="btn danger modal-btn width-100"
                                  onClick={() => setConfirmOpen(true)}
                                >
                                  Remove
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn modal-btn"
                                onClick={() => {
                                  if (selected) {
                                    setIsEditing(false);
                                    openView(selected);
                                  } else {
                                    closeModal();
                                  }
                                }}
                              >
                                Cancel
                              </button>
                              <div className="modal-footer margin-bottom">
                                <button
                                  type="submit"
                                  className="btn primary width-100 modal-btn"
                                >
                                  {selected ? "Save Changes" : "Create"}
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </form>
                </div>

                {confirmOpen && selected && (
                  <div className="confirm">
                    <div className="confirm-card">
                      <div className="confirm-title">Delete Purchase?</div>
                      <p className="confirm-text">
                        This cannot be undone. Remove{" "}
                        <b>{selected.purchase_id}</b>?
                      </p>
                      <div className="confirm-actions">
                        <button
                          className="btn modal-btn"
                          onClick={() => setConfirmOpen(false)}
                        >
                          Cancel
                        </button>
                        <button className="btn danger modal-btn" onClick={confirmDelete}>
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ====== DEMAND VIEW ====== */}
        {view === VIEW_TABS.DEMAND && (
          <>
            <div className="demand-bar">
              <div className="demand-bar__controls">
                {/* Search by product name */}
                <div className="search-box" style={{ flex: '1', minWidth: '200px' }}>
                  <input
                    type="text"
                    className="input"
                    placeholder="Search by product name..."
                    value={demandSearch}
                    onChange={(e) => setDemandSearch(e.target.value)}
                  />
                </div>

                {/* Client filter dropdown */}
                <div className="filter-dropdown" style={{ minWidth: '200px' }}>
                  <select
                    className="input"
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value || '')}
                  >
                    <option value="">All Clients</option>
                    <option value="no-client">No Client (Generic)</option>
                    {allClients.map(client => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Purchase status filter */}
                <div className="filter-dropdown" style={{ minWidth: '200px' }}>
                  <select
                    className="input"
                    value={purchaseFilter}
                    onChange={(e) => setPurchaseFilter(e.target.value)}
                    title="Filter by purchase coverage"
                  >
                    <option value="">All Purchase States</option>
                    <option value="none">Not purchased</option>
                    <option value="partial">Partially purchased</option>
                    <option value="fully">Fully purchased</option>
                  </select>
                </div>


                {/* Clear filters button */}
                <button
                  className="btn"
                  onClick={() => {
                    setDemandSearch('');
                    setSelectedClientId('');
                    setDemandHideCovered(false);
                    setPurchaseFilter(''); // NEW

                  }}
                  style={{ marginLeft: 'auto' }}
                >
                  Clear Filters
                </button>
              </div>
            </div>

            <div className="card">
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Client</th>
                      <th className="right">Available Qty</th>
                      <th className="right">Purchased (Undelivered)</th>
                      <th className="right">Demand</th>
                      <th>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {demandLoading ? (
                      <tr>
                        <td colSpan="6" className="muted center">Loading…</td>
                      </tr>
                    ) : filteredDemandRows.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="muted center">
                          {demandRows.length === 0 ? 'No demand (all orders covered)' : 'No matching items found'}
                        </td>
                      </tr>
                    ) : (
                      paginatedDemandRows.map((r, i) => (
                        <tr key={`${r.product_id}-${r.client_id || "NULL"}-${i}`}>
                          <td data-th="Product">{r.product_name}</td>
                          <td data-th="Client">{r.client_name}</td>
                          <td data-th="Available Qty" className="right">
                            {Number(r.available).toLocaleString("en-IN")}
                          </td>
                          <td data-th="Purchased (Undelivered)" className="right" style={{ color: '#0984e3' }}>
                            {Number(r.purchased_undelivered).toLocaleString("en-IN")}
                          </td>
                          <td data-th="Demand" className="right" style={{ fontWeight: 'bold', color: '#d63031' }}>
                            {Number(r.demand).toLocaleString("en-IN")}
                          </td>
                          <td data-th="Unit">{r.unit}</td>
                        </tr>
                      )))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {filteredDemandRows.length > 0 && (
                <div className="pager">
                  <div className="muted">
                    Showing {demandFrom + 1} to {Math.min(demandTo, filteredDemandRows.length)} of {filteredDemandRows.length} • Page {demandPage} of {demandTotalPages}
                  </div>
                  <div className="pager-controls">
                    <button
                      className="btn"
                      onClick={goToPrevDemandPage}
                      disabled={demandPage <= 1}
                    >
                      Prev
                    </button>
                    <button
                      className="btn"
                      onClick={goToNextDemandPage}
                      disabled={demandPage >= demandTotalPages}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Scoped styles for the tabs (re-using your dashboard look) */}
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
        `}</style>
      </div>
    </NavFrame>
  );
}

/* ======= Portaled Searchable Select (never clipped by modal) ======= */
function SearchSelect({ options, valueId, onChange, placeholder = "Search…" }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  const valueLabel = useMemo(
    () => options.find((o) => o.id === valueId)?.label || "",
    [options, valueId]
  );
  useEffect(() => {
    setTerm(valueLabel);
  }, [valueLabel]);

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
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target) &&
        !inputRef.current.contains(e.target)
      )
        setOpen(false);
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
    return options.filter((o) => o.label.toLowerCase().includes(t)).slice(0, 80);
  }, [options, term]);

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        className="input"
        placeholder={placeholder}
        value={term}
        onFocus={() => {
          setOpen(true);
          updatePosition();
        }}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
      />

      {open &&
        createPortal(
          <div
            ref={containerRef}
            className="search-dropdown-portal"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
          >
            {filtered.length === 0 && (
              <div className="search-option muted">No matches</div>
            )}
            {filtered.map((opt) => (
              <div
                key={opt.id}
                className="search-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange?.(opt);
                  setTerm(opt.label);
                  setOpen(false);
                }}
              >
                {opt.label}
              </div>
            ))}
            {valueId && (
              <div
                className="search-option"
                style={{ color: "#b91c1c", fontWeight: 500 }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange?.(null);
                  setTerm("");
                  setOpen(false);
                }}
              >
                Clear selection
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}