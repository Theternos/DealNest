// investments.js
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "../styles/clients.css";

/** ---------- IST (Asia/Kolkata) helpers ---------- **/
const IST_TZ = "Asia/Kolkata";

// Convert a JS Date (UTC) → "YYYY-MM-DDTHH:mm" string in IST for <input type="datetime-local">
function dateToISTInputValue(date = new Date()) {
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

// Parse an <input type="datetime-local"> as IST and return a UTC Date object
function istInputToUTCDate(inputValue /* "YYYY-MM-DDTHH:mm" */) {
    if (!inputValue) return null;
    // Construct date as if it's in IST, then convert to UTC by subtracting IST offset at that time
    const [d, t] = inputValue.split("T");
    const [y, m, day] = d.split("-").map(Number);
    const [hh, mm] = t.split(":").map(Number);

    // Create a Date for that wall time in IST by first creating a date in UTC,
    // then shifting by the IST offset difference
    const ist = new Date(Date.UTC(y, m - 1, day, hh, mm, 0));

    // Figure out IST offset in minutes for that instant (to handle DST-equivalent changes if any)
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: IST_TZ,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });

    const parts = Object.fromEntries(
        fmt.formatToParts(ist).map((p) => [p.type, p.value])
    );

    // Rebuild the same instant interpreted as IST -> get the actual UTC by comparing.
    // Simpler: compute the timezone offset at that timestamp by comparing local strings.
    // We'll just return the date that corresponds to that IST wall time in UTC by subtracting IST offset (330 min)
    // India is UTC+5:30 with no DST; safe to subtract 5h30m.
    const utcMillis = ist.getTime() - (5 * 60 + 30) * 60 * 1000;
    return new Date(utcMillis);
}

// Format a UTC date to a pretty IST string for table display
function formatIST(dt) {
    if (!dt) return "";
    const d = typeof dt === "string" ? new Date(dt) : dt;
    const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: IST_TZ,
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
    });
    return fmt.format(d);
}

const PAGE_SIZE = 10;
const PEOPLE = ["Kavin", "Vicky"];

export default function Investments() {
    const [rows, setRows] = useState([]);
    const [count, setCount] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);

    // Create Modal
    const [modalOpen, setModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        name: PEOPLE[0],
        amount: "",
        created_at_local: dateToISTInputValue(new Date()),
    });

    // Delete confirm
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [toDelete, setToDelete] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const totalPages = useMemo(
        () => Math.max(1, Math.ceil((count || 0) / PAGE_SIZE)),
        [count]
    );


    useEffect(() => {
        fetchInvestments();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page]);

    // Calculate total investments and individual shares
    const { total, kavinShare, vickyShare } = useMemo(() => {
        const totalInvested = rows.reduce((sum, row) => sum + parseFloat(row.amount || 0), 0);
        const kavinTotal = rows
            .filter(row => row.name === 'Kavin')
            .reduce((sum, row) => sum + parseFloat(row.amount || 0), 0);
        const vickyTotal = rows
            .filter(row => row.name === 'Vicky')
            .reduce((sum, row) => sum + parseFloat(row.amount || 0), 0);

        return {
            total: totalInvested,
            kavinShare: kavinTotal,
            vickyShare: vickyTotal
        };
    }, [rows]);

    // Format currency for display
    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    };



    async function fetchInvestments() {
        setLoading(true);
        const from = (page - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data, error, count: total } = await supabase
            .from("investments")
            .select("*", { count: "exact" })
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to);

        if (error) {
            console.error(error);
            alert("Failed to load investments");
        } else {
            setRows(data || []);
            setCount(total || 0);
        }
        setLoading(false);
    }

    function resetForm() {
        setForm({
            name: PEOPLE[0],
            amount: "",
            created_at_local: dateToISTInputValue(new Date()),
        });
    }

    function openCreate() {
        resetForm();
        setModalOpen(true);
    }

    function closeCreate() {
        setModalOpen(false);
    }

    function openConfirmDelete(row) {
        setToDelete(row);
        setConfirmOpen(true);
    }

    function closeConfirm() {
        setToDelete(null);
        setConfirmOpen(false);
    }

    async function handleSave(e) {
        e?.preventDefault?.();
        if (!form.name || !PEOPLE.includes(form.name)) {
            alert("Please choose a valid name.");
            return;
        }
        const amt = parseFloat(form.amount);
        if (Number.isNaN(amt) || amt <= 0) {
            alert("Amount must be a positive number.");
            return;
        }

        setSaving(true);
        const createdUTC = istInputToUTCDate(form.created_at_local) || new Date();

        const { error } = await supabase.from("investments").insert({
            name: form.name,
            amount: amt,
            created_at: createdUTC.toISOString(),
        });

        setSaving(false);
        if (error) {
            console.error(error);
            alert("Failed to record investment");
            return;
        }
        closeCreate();
        // Refresh to show newest first
        setPage(1);
        fetchInvestments();
    }

    async function handleDelete() {
        if (!toDelete) return;
        setDeleting(true);
        const { error } = await supabase
            .from("investments")
            .delete()
            .eq("id", toDelete.id);

        setDeleting(false);
        if (error) {
            console.error(error);
            alert("Failed to delete");
            return;
        }
        closeConfirm();
        // If the last item on last page deleted, shift page back if needed
        const newCount = count - 1;
        const maxPage = Math.max(1, Math.ceil(newCount / PAGE_SIZE));
        if (page > maxPage) setPage(maxPage);
        fetchInvestments();
    }

    const currency = new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
    });

    return (
        <div className="wrap">
            <div className="bar">
                <div className="title">Investments</div>
                <button className="btn primary modal-btn" onClick={openCreate}>
                    Record Investment
                </button>
            </div>
            {/* Summary Cards */}
            <div className="grid" style={{ marginBottom: '16px' }}>
                <div className="card" style={{ padding: '16px' }}>
                    <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '8px' }}>Total Investments</div>
                    <div style={{ fontSize: '24px', fontWeight: '700' }}>{formatCurrency(total)}</div>
                </div>
                <div className="card" style={{ padding: '16px' }}>
                    <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '8px' }}>Kavin's Share</div>
                    <div style={{ fontSize: '20px', fontWeight: '600' }}>{formatCurrency(kavinShare)}</div>
                </div>
                <div className="card" style={{ padding: '16px' }}>
                    <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '8px' }}>Vicky's Share</div>
                    <div style={{ fontSize: '20px', fontWeight: '600' }}>{formatCurrency(vickyShare)}</div>
                </div>
            </div>
            <div className="card">
                <div className="table-wrap">
                    <table className="tbl">
                        <thead>
                            <tr>
                                <th>Date &amp; Time (IST)</th>
                                <th>Name</th>
                                <th className="right">Amount (₹)</th>
                                <th className="right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td data-th="Loading" colSpan={5} className="center">
                                        Loading…
                                    </td>
                                </tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td data-th="Empty" colSpan={5} className="center muted">
                                        No investments recorded yet.
                                    </td>
                                </tr>
                            ) : (
                                rows.map((r) => (
                                    <tr key={r.id}>
                                        <td data-th="Date & Time">{formatIST(r.created_at)}</td>
                                        <td data-th="Name">{r.name || "-"}</td>
                                        <td data-th="Amount" className="right">
                                            {currency.format(Number(r.amount || 0))}
                                        </td>
                                        <td data-th="Actions" className="center">
                                            <div className="actions">
                                                <button
                                                    className="btn danger"
                                                    onClick={() => openConfirmDelete(r)}
                                                    title="Delete investment"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="pager">
                    <div className="muted">
                        {count} total • Page {page} / {totalPages}
                    </div>
                    <div className="pager-controls">
                        <button
                            className="btn"
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page <= 1 || loading}
                        >
                            ‹ Prev
                        </button>
                        <button
                            className="btn"
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page >= totalPages || loading}
                        >
                            Next ›
                        </button>
                    </div>
                </div>
            </div>

            {/* Create / Record Investment Modal */}
            {modalOpen && (
                <div className="modal" role="dialog" aria-modal="true">
                    <div className="modal-card">
                        <div className="modal-head">
                            <div className="modal-title">Record Investment</div>
                            <button className="btn icon" onClick={closeCreate} aria-label="Close">
                                ✕
                            </button>
                        </div>

                        <form className="form" onSubmit={handleSave}>
                            <div className="grid">
                                <label className="lbl">
                                    <span className="lbl-text">Name</span>
                                    <select
                                        className="input"
                                        value={form.name}
                                        onChange={(e) =>
                                            setForm((f) => ({ ...f, name: e.target.value }))
                                        }
                                    >
                                        {PEOPLE.map((p) => (
                                            <option key={p} value={p}>
                                                {p}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <label className="lbl">
                                    <span className="lbl-text">Amount (₹)</span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        className="input"
                                        placeholder="0.00"
                                        value={form.amount}
                                        onChange={(e) =>
                                            setForm((f) => ({ ...f, amount: e.target.value }))
                                        }
                                    />
                                </label>

                                <label className="lbl span-2">
                                    <span className="lbl-text">Timestamp (IST)</span>
                                    <input
                                        type="datetime-local"
                                        className="input"
                                        value={form.created_at_local}
                                        onChange={(e) =>
                                            setForm((f) => ({ ...f, created_at_local: e.target.value }))
                                        }
                                    />
                                </label>
                            </div>

                            <div className="modal-actions margin-bottom">
                                <button type="button" className="btn modal-btn ghost" onClick={closeCreate}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn modal-btn primary" disabled={saving}>
                                    {saving ? "Saving…" : "Save"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete confirm */}
            {confirmOpen && (
                <div className="confirm" role="dialog" aria-modal="true">
                    <div className="confirm-card">
                        <div className="confirm-title">Delete investment?</div>
                        <div className="confirm-text">
                            This action cannot be undone. Proceed to delete{" "}
                            <b>#{toDelete?.id}</b> ({toDelete?.name},{" "}
                            {currency.format(Number(toDelete?.amount || 0))})?
                        </div>
                        <div className="confirm-actions">
                            <button className="btn modal-btn" onClick={closeConfirm} disabled={deleting}>
                                Cancel
                            </button>
                            <button
                                className="btn modal-btn danger"
                                onClick={handleDelete}
                                disabled={deleting}
                            >
                                {deleting ? "Deleting…" : "Delete"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
