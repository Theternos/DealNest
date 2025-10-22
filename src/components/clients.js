// clients.js
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "../styles/clients.css";
import NavFrame from "./nav";

const EMPTY_CLIENT = {
    name: "",
    contact: "",
    billing_address: "",
    shipping_address: "",
    credit: "",
    active: true,
    notes: "",
    gstin: "", // NEW
};

// Strict-ish GSTIN pattern: 15 chars → 2 digits + 5 letters + 4 digits + 1 letter + 1 alnum + 'Z' + 1 alnum
const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;

export default function Clients() {
    const [rows, setRows] = useState([]);
    const [count, setCount] = useState(0);
    const [page, setPage] = useState(1);
    const pageSize = 10;

    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");

    const [modalOpen, setModalOpen] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [selected, setSelected] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [form, setForm] = useState(EMPTY_CLIENT);

    const totalPages = useMemo(
        () => Math.max(1, Math.ceil((count || 0) / pageSize)),
        [count]
    );
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    async function fetchData() {
        setLoading(true);
        let query = supabase
            .from("clients")
            .select("*", { count: "exact" })
            .order("created_at", { ascending: false })
            .range(from, to);

        if (search.trim()) {
            // Search by name OR GSTIN
            query = query.or(
                `name.ilike.%${search.trim()}%,gstin.ilike.%${search.trim().toUpperCase()}%`
            );
        }

        const { data, error, count: c } = await query;
        setLoading(false);
        if (error) {
            console.error(error);
            return;
        }
        setRows(data || []);
        setCount(c || 0);
    }

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line
    }, [page, search]);

    function openAdd() {
        setSelected(null);
        setForm(EMPTY_CLIENT);
        setIsEditing(true);
        setConfirmOpen(false);
        setModalOpen(true);
    }

    function openView(row) {
        setSelected(row);
        setForm({
            name: row.name || "",
            contact: row.contact || "",
            billing_address: row.billing_address || "",
            shipping_address: row.shipping_address || "",
            credit: row.credit ?? "",
            active: !!row.active,
            notes: row.notes || "",
            gstin: row.gstin || "", // NEW
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
        setForm(EMPTY_CLIENT);
    }

    function normalizeGSTIN(input) {
        return (input || "").replace(/\s+/g, "").toUpperCase();
    }

    async function handleSave(e) {
        e.preventDefault();

        const cleanedGSTIN = normalizeGSTIN(form.gstin);

        // Optional field, but if provided, validate format
        if (cleanedGSTIN && !GSTIN_REGEX.test(cleanedGSTIN)) {
            alert("Invalid GSTIN format. It must be 15 characters and match the GSTIN pattern.");
            return;
        }

        const payload = {
            ...form,
            name: form.name?.trim(),
            contact: form.contact?.trim() || null,
            billing_address: form.billing_address?.trim() || null,
            shipping_address: form.shipping_address?.trim() || null,
            notes: form.notes?.trim() || null,
            credit: form.credit === "" ? null : Number(form.credit),
            gstin: cleanedGSTIN || null, // NEW
        };

        if (!payload.name) {
            alert("Client name is required");
            return;
        }

        if (selected) {
            const { error } = await supabase.from("clients").update(payload).eq("id", selected.id);
            if (error) {
                alert(error.message || "Update failed");
                console.error(error);
                return;
            }
        } else {
            const { error } = await supabase.from("clients").insert([payload]);
            if (error) {
                alert(error.message || "Create failed");
                console.error(error);
                return;
            }
        }

        await fetchData();
        closeModal();
    }

    async function confirmDelete() {
        if (!selected) return;

        const { error } = await supabase.from("clients").delete().eq("id", selected.id);
        if (error) {
            alert("Delete failed");
            console.error(error);
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

    function goPrev() {
        setPage((p) => Math.max(1, p - 1));
    }

    function goNext() {
        setPage((p) => Math.min(totalPages, p + 1));
    }

    const modalTitle = selected ? (isEditing ? "Edit Client" : "Client Details") : "Add Client";

    return (
        <NavFrame>
        <div className="wrap">
            <header className="bar">
                <h1 className="title">Clients</h1>
                <button className="btn primary modal-btn" onClick={openAdd}>
                    + Add Client
                </button>
            </header>

            <div className="toolbar" style={{ display: "block" }}>
                <input
                    className="input"
                    placeholder="Search by name or GSTIN…"
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
                                <th>Contact</th>
                                <th>Shipping Address</th>
                                <th>Credit (₹)</th>
                                <th>Status</th>
                                <th className="right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr>
                                    <td colSpan="6" className="muted center">
                                        Loading…
                                    </td>
                                </tr>
                            )}
                            {!loading && rows.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="muted center">
                                        No clients found
                                    </td>
                                </tr>
                            )}
                            {!loading &&
                                rows.map((r) => (
                                    <tr key={r.id}>
                                        <td data-th="Name">{r.name}</td>
                                        <td data-th="Contact">{r.contact || "-"}</td>
                                        <td className="truncate" data-th="Shipping Address">
                                            {r.shipping_address || "-"}
                                        </td>
                                        <td data-th="Credit (₹)">
                                            {r.credit ?? r.credit === 0
                                                ? "₹ " + Number(r.credit).toLocaleString("en-IN", {
                                                    maximumFractionDigits: 2,
                                                })
                                                : "-"}
                                        </td>
                                        <td data-th="Status">
                                            <span className={`status ${r.active ? "status--active" : "status--inactive"}`}>
                                                <span className="dot" />
                                                {r.active ? "Active" : "Inactive"}
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
                    <div className="modal-card modal-card--lg">
                        <div className="modal-head">
                            <h2 className="modal-title">{modalTitle}</h2>
                            <button className="btn icon" onClick={closeModal} aria-label="Close">
                                ×
                            </button>
                        </div>

                        <form onSubmit={handleSave}>
                            <div className="details-grid">
                                <div className="details-col">
                                    <DetailRow
                                        label="Name"
                                        edit={isEditing}
                                        value={form.name}
                                        onChange={(v) => setForm({ ...form, name: v })}
                                        required
                                    />
                                    <DetailRow
                                        label="Contact"
                                        edit={isEditing}
                                        value={form.contact}
                                        onChange={(v) => setForm({ ...form, contact: v })}
                                    />
                                    <DetailRow
                                        label="Credit (₹)"
                                        edit={isEditing}
                                        type="number"
                                        step="0.01"
                                        value={form.credit}
                                        onChange={(v) => setForm({ ...form, credit: v })}
                                    />
                                    <DetailRow
                                        label="Active"
                                        edit={isEditing}
                                        type="checkbox"
                                        checked={!!form.active}
                                        onChangeChecked={(c) => setForm({ ...form, active: c })}
                                        value={form.active ? "Yes" : "No"}
                                    />
                                </div>

                                <div className="details-col">
                                    <DetailRow
                                        label="Billing Address"
                                        edit={isEditing}
                                        type="textarea"
                                        value={form.billing_address}
                                        onChange={(v) => setForm({ ...form, billing_address: v })}
                                    />
                                    <DetailRow
                                        label="Shipping Address"
                                        edit={isEditing}
                                        type="textarea"
                                        value={form.shipping_address}
                                        onChange={(v) => setForm({ ...form, shipping_address: v })}
                                    />
                                    <DetailRow
                                        label="Notes"
                                        edit={isEditing}
                                        type="textarea"
                                        value={form.notes}
                                        onChange={(v) => setForm({ ...form, notes: v })}
                                    />
                                    <DetailRow
                                        label="GSTIN (optional)"
                                        edit={isEditing}
                                        value={form.gstin}
                                        onChange={(v) => setForm({ ...form, gstin: v.toUpperCase() })}
                                        maxLength={15}
                                    />
                                </div>
                            </div>

                            <div className="modal-actions between">
                                {!isEditing ? (
                                    <>
                                        {selected && (
                                            <button
                                                type="button"
                                                className="btn modal-btn"
                                                onClick={() => setIsEditing(true)}
                                            >
                                                Edit
                                            </button>
                                        )}
                                        {selected && (
                                            <button
                                                type="button"
                                                className="btn danger modal-btn"
                                                onClick={() => setConfirmOpen(true)}
                                            >
                                                Remove
                                            </button>
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
                                <div className="confirm-title">Delete Client?</div>
                                <p className="confirm-text">
                                    This action cannot be undone. Remove <b>{selected.name}</b>?
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
        </NavFrame>
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
                    rows={3}
                    value={value || ""}
                    onChange={(e) => onChange?.(e.target.value)}
                />
            ) : type === "checkbox" ? (
                <label className="check">
                    <input
                        type="checkbox"
                        checked={!!checked}
                        onChange={(e) => onChangeChecked?.(e.target.checked)}
                    />
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
                    onChange={(e) => onChange?.(e.target.value)}
                />
            )}
        </div>
    );
}
