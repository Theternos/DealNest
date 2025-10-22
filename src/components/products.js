// products.js
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "../styles/clients.css";
import NavFrame from "./nav";

const TAX_OPTIONS = ["Tax Exemption", "2.5%", "5%", "12%", "18%"];
const UNIT_OPTIONS = [
  "Pieces", "Numbers", "Kilograms", "Box", "Packs", "Meters", "Sets", "Square Feet",
  "Pouch", "Bottles", "Bags", "Grams", "Feet", "Case", "Rolls", "Pairs", "Quintal",
  "Tonnes", "Bundles", "Tin", "Barrel", "Packets", "Length", "Dozens", "Grums",
  "Litres", "Tanks", "Qualtity"
];
const CATEGORY_OPTIONS = ["Packages", "Groceries", "Oil"];

const EMPTY_PRODUCT = {
  name: "",
  purchase_price: "",
  selling_price: "",
  tax_rate: "Tax Exemption",
  unit: "Pieces",
  description: "",
  active: true,
  hsn_sac: "",
  category: "Packages"
};

export default function Products() {
  // Table state
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // UI state
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selected, setSelected] = useState(null); // null + isEditing = ADD
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_PRODUCT);

  // Pagination helpers
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((count || 0) / pageSize)),
    [count, pageSize]
  );
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Fetch
  async function fetchData() {
    setLoading(true);
    let query = supabase
      .from("products")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (search.trim()) {
      query = query.ilike("name", `%${search.trim()}%`);
    }

    const { data, error, count: c } = await query;
    setLoading(false);
    if (error) {
      console.error("fetch products error:", error);
      return;
    }
    setRows(data || []);
    setCount(c || 0);
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search]);

  // Openers
  function openAdd() {
    setSelected(null);
    setForm(EMPTY_PRODUCT);
    setIsEditing(true);
    setConfirmOpen(false);
    setModalOpen(true);
  }

  function openView(row) {
    setSelected(row);
    setForm({
      name: row.name || "",
      purchase_price: row.purchase_price ?? "",
      selling_price: row.selling_price ?? "",
      tax_rate: row.tax_rate || "Tax Exemption",
      unit: row.unit || "Pieces",
      description: row.description || "",
      active: !!row.active,
      hsn_sac: row.hsn_sac || "",               // NEW
      category: row.category || "Packages",      // NEW
    });
    setIsEditing(false);
    setConfirmOpen(false);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setSelected(null);
    setIsEditing(false);
    setConfirmOpen(false);
    setForm(EMPTY_PRODUCT);
  }

  // Save (insert/update)
  async function handleSave(e) {
    e.preventDefault();
    const payload = {
      ...form,
      name: form.name?.trim(),
      purchase_price:
        form.purchase_price === "" ? null : Number(form.purchase_price),
      selling_price:
        form.selling_price === "" ? null : Number(form.selling_price),
      description: form.description?.trim() || null,
      hsn_sac: form.hsn_sac?.trim() || null,                    // NEW (optional)
      category: form.category || null,                          // NEW
    };
    if (!payload.name) {
      alert("Product name is required");
      return;
    }

    if (selected) {
      const { error } = await supabase
        .from("products")
        .update(payload)
        .eq("id", selected.id);
      if (error) {
        alert("Update failed");
        console.error("update product error:", error);
        return;
      }
    } else {
      const { error } = await supabase.from("products").insert([payload]);
      if (error) {
        alert("Create failed");
        console.error("create product error:", error);
        return;
      }
    }

    await fetchData();
    closeModal();
  }

  // Delete
  async function confirmDelete() {
    if (!selected) return;
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", selected.id);
    if (error) {
      alert("Delete failed");
      console.error("delete product error:", error);
      return;
    }

    const newCount = count - 1;
    if (rows.length === 1 && page > 1 && (newCount % pageSize) === 0) {
      setPage((p) => Math.max(1, p - 1));
    } else {
      fetchData();
    }
    closeModal();
  }

  // Pager controls
  function goPrev() {
    setPage((p) => Math.max(1, p - 1));
  }
  function goNext() {
    setPage((p) => Math.min(totalPages, p + 1));
  }

  const modalTitle = selected
    ? isEditing
      ? "Edit Product"
      : "Product Details"
    : "Add Product";

  return (
    <NavFrame>
      <div className="wrap">
        <header className="bar">
          <h1 className="title">Products</h1>
          <button className="btn primary modal-btn" onClick={openAdd}>
            + Add Product
          </button>
        </header>

        <div className="toolbar" style={{ display: "block" }}>
          <input
            className="input"
            placeholder="Search by product name..."
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>

        <div className="card">
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>{/* NEW */}
                  <th>HSN/SAC</th>{/* NEW */}
                  <th>Purchase Price</th>
                  <th>Selling Price</th>
                  <th>Tax Rate</th>
                  <th>Unit</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan="8" className="muted center">Loading…</td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan="8" className="muted center">No products found</td>
                  </tr>
                )}
                {!loading && rows.map((r) => (
                  <tr key={r.id}>
                    <td data-th="Name">{r.name}</td>
                    <td data-th="Category">{r.category || "-"}</td>{/* NEW */}
                    <td data-th="HSN/SAC">{r.hsn_sac || "-"}</td>{/* NEW */}
                    <td data-th="Purchase Price">
                      ₹{Number(r.purchase_price || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                    </td>
                    <td data-th="Selling Price">
                      ₹{Number(r.selling_price || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                    </td>
                    <td data-th="Tax Rate">{r.tax_rate}</td>
                    <td data-th="Unit">{r.unit}</td>
                    <td className="right" data-th="Actions">
                      <button className="btn ghost" onClick={() => openView(r)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* PAGINATION */}
          <div className="pager">
            <div className="muted">
              {count} total • Page {page} of {totalPages}
            </div>
            <div className="pager-controls">
              <button className="btn" onClick={goPrev} disabled={page <= 1}>Prev</button>
              <button className="btn" onClick={goNext} disabled={page >= totalPages}>Next</button>
            </div>
          </div>
        </div>

        {modalOpen && (
          <div className="modal">
            <div className="modal-card modal-card--lg">
              <div className="modal-head">
                <h2 className="modal-title">{modalTitle}</h2>
                <button className="btn icon" onClick={closeModal} aria-label="Close">×</button>
              </div>

              <form onSubmit={handleSave}>
                <div className="details-grid">
                  <div className="details-col">
                    <DetailRow
                      label="Product Name"
                      edit={isEditing}
                      value={form.name}
                      onChange={(v) => setForm({ ...form, name: v })}
                      required
                    />
                    <DetailRow
                      label="Purchase Price (₹)"
                      edit={isEditing}
                      type="number"
                      value={form.purchase_price}
                      onChange={(v) => setForm({ ...form, purchase_price: v })}
                    />
                    <DetailRow
                      label="Selling Price (₹)"
                      edit={isEditing}
                      type="number"
                      value={form.selling_price}
                      onChange={(v) => setForm({ ...form, selling_price: v })}
                    />
                    <DetailRow
                      label="HSN/SAC"
                      edit={isEditing}
                      value={form.hsn_sac}
                      onChange={(v) => setForm({ ...form, hsn_sac: v })}
                    />
                  </div>

                  <div className="details-col">
                    <DetailRow
                      label="Tax Rate"
                      edit={isEditing}
                      type="select"
                      options={TAX_OPTIONS}
                      value={form.tax_rate}
                      onChange={(v) => setForm({ ...form, tax_rate: v })}
                    />
                    <DetailRow
                      label="Units"
                      edit={isEditing}
                      type="select"
                      options={UNIT_OPTIONS}
                      value={form.unit}
                      onChange={(v) => setForm({ ...form, unit: v })}
                    />
                    <DetailRow
                      label="Category"
                      edit={isEditing}
                      type="select"
                      options={CATEGORY_OPTIONS}
                      value={form.category}
                      onChange={(v) => setForm({ ...form, category: v })}
                    />
                    <DetailRow
                      label="Description"
                      edit={isEditing}
                      type="textarea"
                      value={form.description}
                      onChange={(v) => setForm({ ...form, description: v })}
                    />
                  </div>
                </div>

                <div className="modal-actions between">
                  {!isEditing ? (
                    <>
                      {selected && (
                        <>
                          <button
                            type="button"
                            className="btn modal-btn"
                            onClick={() => setIsEditing(true)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn danger modal-btn"
                            onClick={() => setConfirmOpen(true)}
                          >
                            Remove
                          </button>
                        </>
                      )}
                      {!selected && <span className="muted">Fill details and click “Create”.</span>}
                      <div />
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn modal-btn"
                        onClick={() => {
                          if (selected) { setIsEditing(false); openView(selected); }
                          else { closeModal(); }
                        }}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="btn primary modal-btn">
                        {selected ? "Save Changes" : "Create"}
                      </button>
                    </>
                  )}
                </div>
              </form>
            </div>

            {confirmOpen && selected && (
              <div className="confirm">
                <div className="confirm-card">
                  <div className="confirm-title">Delete Product?</div>
                  <p className="confirm-text">
                    This action cannot be undone. Remove <b>{selected.name}</b>?
                  </p>
                  <div className="confirm-actions">
                    <button className="btn modal-btn" onClick={() => setConfirmOpen(false)}>Cancel</button>
                    <button className="btn danger modal-btn" onClick={confirmDelete}>Delete</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </NavFrame>
  );
}

function DetailRow({ label, edit, type = "text", value, options, onChange, required = false }) {
  return (
    <div className="detail-row">
      <div className="detail-label">{label}{required ? " *" : ""}</div>
      {!edit ? (
        <div className="detail-value">{value ? String(value) : <span className="muted">-</span>}</div>
      ) : type === "textarea" ? (
        <textarea
          className="input area"
          rows={3}
          value={value || ""}
          onChange={(e) => onChange?.(e.target.value)}
        />
      ) : type === "select" ? (
        <select
          className="input"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
        >
          {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : (
        <input
          className="input"
          type={type}
          required={required}
          value={value ?? ""}
          onChange={(e) => onChange?.(e.target.value)}
        />
      )}
    </div>
  );
}
