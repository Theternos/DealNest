// purchases.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { createPortal } from "react-dom";
import "../styles/clients.css";

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

export default function Purchases() {
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

  // ref data
  const [vendors, setVendors] = useState([]);
  const [clients, setClients] = useState([]);
  const [products, setProducts] = useState([]);

  // ui
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // filters
  const [filterStatus, setFilterStatus] = useState("Any");
  const [filterVendorId, setFilterVendorId] = useState("");
  const [filterClientId, setFilterClientId] = useState("");
  const [filterDelivered, setFilterDelivered] = useState("Any"); // Any / All Delivered / Any Undelivered

  // modal
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

  // load refs
  useEffect(() => {
    (async () => {
      const [{ data: v }, { data: p }, { data: c }] = await Promise.all([
        supabase.from("vendors").select("id,name").order("name"),
        supabase
          .from("products")
          .select("id,name,unit,tax_rate,purchase_price")
          .order("name"),
        supabase.from("clients").select("id,name").order("name"),
      ]);
      setVendors(v || []);
      setProducts(p || []);
      setClients(c || []);
    })();
  }, []);

  // fetch list (with filters)
  async function fetchPurchases() {
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
  }, [page, search, filterStatus, filterVendorId, filterClientId, filterDelivered]);

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

  // openers
  function openAdd() {
    setSelected(null);
    setHeader({
      ...EMPTY_HEADER,
      purchase_at: formatForDatetimeLocalIST(), // IST now
    });
    setLines([{ ...EMPTY_LINE }]);
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
    } else {
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
    }

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

  // ===== INVENTORY MERGE (fixes duplicates) =====
  // For each selected undelivered line, accumulate by product and merge into inventory
  // Rule: if (product_id exists AND client_id IS NULL) => UPDATE (add qty); else INSERT (client_id: null)
  async function mergeDeliveredIntoInventory(purchaseRow, pickedLineIds) {
    if (!purchaseRow || pickedLineIds.length === 0) return;

    // 1) Gather the selected lines we just marked delivered
    const picked = lines.filter((l) => pickedLineIds.includes(l.id));
    if (picked.length === 0) return;

    // 2) Group quantities by product_id (sum)
    const groups = picked.reduce((acc, l) => {
      const key = l.product_id;
      acc[key] = acc[key] || {
        product_id: l.product_id,
        qty: 0,
        unit: l.unit,
        tax_rate: l.tax_rate,
      };
      acc[key].qty += Number(l.quantity) || 0;
      return acc;
    }, {});

    const productIds = Object.keys(groups);
    if (productIds.length === 0) return;

    // 3) For each product, update existing (client_id IS NULL) or insert new
    for (const pid of productIds) {
      const g = groups[pid];
      // IMPORTANT: use .is('client_id', null) — NOT .eq(..., null)
      const { data: existingRows, error: selErr } = await supabase
        .from("inventory")
        .select("id,quantity,product_id,client_id")
        .eq("product_id", pid)
        .is("client_id", null) // <— this prevents the duplicates you saw
        .limit(1);

      if (selErr) {
        console.error("Inventory select error:", selErr);
        continue;
      }

      const p = productById(pid);

      if (existingRows && existingRows.length > 0) {
        // UPDATE existing row: add quantity and refresh a couple fields
        const row = existingRows[0];
        const newQty = Number(row.quantity || 0) + Number(g.qty || 0);

        const { error: updErr } = await supabase
          .from("inventory")
          .update({
            quantity: newQty,
            unit: g.unit || p?.unit || null,
            tax_rate: g.tax_rate || p?.tax_rate || null,
            // any other fields you maintain can be refreshed here safely
          })
          .eq("id", row.id);

        if (updErr) {
          console.error("Inventory update error:", updErr);
          alert(
            `Failed to update inventory for ${productName(pid)}: ${updErr.message}`
          );
        }
      } else {
        // INSERT a new inventory row for this product with client_id: null
        const { error: insErr } = await supabase.from("inventory").insert([
          {
            product_id: pid,
            client_id: null, // <— critical for your rule
            quantity: Number(g.qty || 0),
            unit: g.unit || p?.unit || null,
            tax_rate: g.tax_rate || p?.tax_rate || "Tax Exemption",
          },
        ]);

        if (insErr) {
          console.error("Inventory insert error:", insErr);
          alert(
            `Failed to insert inventory for ${productName(pid)}: ${insErr.message}`
          );
        }
      }
    }
  }

  // save delivery (mark selected lines delivered + split freight + merge inventory)
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
        alert(`Failed to update line items: ${firstErr.message || "Unknown error"}`);
        return;
      }

      // --- Immediately reflect delivery in local state so allDelivered recomputes ---
      setLines((prev) =>
        prev.map((ln) => {
          const upd = perLineUpdates.find((u) => u.id === ln.id);
          return upd
            ? {
                ...ln,
                delivered: true,
                freight_charge_split: upd.new_split,
              }
            : ln;
        })
      );
    } catch (err) {
      console.error("Update crash:", err);
      alert("Failed to update line items (client exception). See console for details.");
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

    // 3) Merge delivered quantities into INVENTORY (this fixes duplicates)
    try {
      await mergeDeliveredIntoInventory(selected, selectedIds);
    } catch (e) {
      console.error("Inventory merge exception:", e);
      alert("Delivered, but failed to merge inventory. See console.");
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

  return (
    <div className="wrap">
      <header className="bar">
        <h1 className="title">Purchases</h1>
        <button className="btn primary modal-btn" onClick={openAdd}>
          + Add Purchase
        </button>
      </header>

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
                    <td data-th="Date">{new Date(r.purchase_at).toLocaleString()}</td>
                    <td data-th="Status">
                      <span
                        className={`status ${
                          r.status === "Closed" ? "status--active" : "status--inactive"
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
                      <div style={{ marginTop: 12, marginBottom: 8, fontWeight: 700 }}>
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
                      <div className="purchase-view-actions margin-bottom" role="toolbar" aria-label="Purchase actions">
                        <button type="button" className="btn modal-btn" onClick={closeModal}>
                          Close
                        </button>

                        {selected && !allDelivered && (
                          <button
                            type="button"
                            className="btn modal-btn"
                            style={{ backgroundColor: "#2563eb", color: "white" }}
                            onClick={() => setDeliverMode(true)}
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
                                setHeader({ ...header, mode_of_payment: e.target.value })
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
                                setHeader({ ...header, purchase_at: e.target.value })
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
                      <div style={{ marginTop: 12, marginBottom: 8, fontWeight: 700 }}>
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
                              options={products.map((p) => ({ id: p.id, label: p.name }))}
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
                              onChange={(e) => setLine(idx, { quantity: e.target.value })}
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
                              onChange={(e) => setLine(idx, { tax_rate: e.target.value })}
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
                        <div className="modal-footer margin-bottom ">
                          {selected && (
                            <button
                              type="button"
                              className="btn danger modal-btn"
                              onClick={() => setConfirmOpen(true)}
                            >
                              Remove
                            </button>
                          )}
                          <button type="submit" className="btn primary width-100 modal-btn">
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
                  This cannot be undone. Remove <b>{selected.purchase_id}</b>?
                </p>
                <div className="confirm-actions">
                  <button className="btn modal-btn" onClick={() => setConfirmOpen(false)}>
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
    </div>
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
