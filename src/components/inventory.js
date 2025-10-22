// inventory.js
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "../styles/clients.css";
import NavFrame from "./nav";

export default function Inventory() {
    // data
    const [rows, setRows] = useState([]);
    const [count, setCount] = useState(0);

    // refs
    const [products, setProducts] = useState([]);
    const [clients, setClients] = useState([]);

    // ui
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [clientFilter, setClientFilter] = useState("ALL"); // ALL | GENERIC | SPECIFIC:<id>

    // pagination
    const [page, setPage] = useState(1);
    const pageSize = 10;
    const totalPages = useMemo(
        () => Math.max(1, Math.ceil((count || 0) / pageSize)),
        [count, pageSize]
    );

    // modal
    const [modalOpen, setModalOpen] = useState(false);
    const [selected, setSelected] = useState(null);
    const [confirmOpen, setConfirmOpen] = useState(false); // confirm remove client

    const inr = (n) =>
        `₹${Number(n || 0).toLocaleString("en-IN", {
            maximumFractionDigits: 2,
        })}`;

    const productName = (id) => products.find((p) => p.id === id)?.name || "-";
    const productUnit = (id) => products.find((p) => p.id === id)?.unit || "";
    const clientName = (id) => clients.find((c) => c.id === id)?.name || "Any";

    // load refs
    useEffect(() => {
        (async () => {
            const [{ data: p }, { data: c }] = await Promise.all([
                supabase.from("products").select("id,name,unit").order("name"),
                supabase.from("clients").select("id,name").order("name"),
            ]);
            setProducts(p || []);
            setClients(c || []);
        })();
    }, []);

    // fetch + GROUP BY (product_id, client_id)
    async function fetchInventory() {
        setLoading(true);

        // NOTE: to group reliably, we fetch ALL matching rows (no range)
        let q = supabase
            .from("inventory")
            .select(
                "id,product_id,client_id,qty_available,total_value,last_in_at",
                { count: "exact" }
            );

        // client filter
        if (clientFilter !== "ALL") {
            if (clientFilter === "GENERIC") q = q.is("client_id", null);
            else if (clientFilter.startsWith("SPECIFIC:")) {
                const id = clientFilter.split(":")[1];
                q = q.eq("client_id", id);
            }
        }

        const { data, error } = await q.order("last_in_at", {
            ascending: false,
        });
        setLoading(false);
        if (error) {
            console.error("inventory fetch error:", error);
            return;
        }

        // product name search filter (pre-group so we only group relevant)
        const preFiltered = (data || []).filter((r) =>
            productName(r.product_id)
                .toLowerCase()
                .includes(search.trim().toLowerCase())
        );

        // GROUP by (product_id, client_id) — treating null as its own key
        const groups = new Map();
        for (const r of preFiltered) {
            const clientKey = r.client_id ?? "NULL";
            const key = `${r.product_id}::${clientKey}`;
            const g = groups.get(key) || {
                // synthetic row representing the group
                __key: key,
                __ids: [],
                product_id: r.product_id,
                client_id: r.client_id ?? null,
                qty_available: 0,
                total_value: 0,
                last_in_at: null,
            };
            g.__ids.push(r.id);
            g.qty_available += Number(r.qty_available || 0);
            g.total_value += Number(r.total_value || 0);

            // max(last_in_at)
            const cur = r.last_in_at ? new Date(r.last_in_at).getTime() : 0;
            const prev = g.last_in_at ? new Date(g.last_in_at).getTime() : 0;
            if (cur >= prev) g.last_in_at = r.last_in_at || g.last_in_at;

            groups.set(key, g);
        }

        // Convert back to array
        const groupedRows = Array.from(groups.values());

        // Sort by last_in_at desc (nulls last)
        groupedRows.sort((a, b) => {
            const at = a.last_in_at ? new Date(a.last_in_at).getTime() : -1;
            const bt = b.last_in_at ? new Date(b.last_in_at).getTime() : -1;
            return bt - at;
        });

        // pagination AFTER grouping
        const total = groupedRows.length;
        const from = (page - 1) * pageSize;
        const to = from + pageSize;
        const pageSlice = groupedRows.slice(from, to);

        setRows(pageSlice);
        setCount(total);
    }

    useEffect(() => {
        fetchInventory();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, clientFilter, search]);

    function goPrev() {
        setPage((p) => Math.max(1, p - 1));
    }
    function goNext() {
        const tp = Math.max(1, Math.ceil((count || 0) / pageSize));
        setPage((p) => Math.min(tp, p + 1));
    }

    function openView(row) {
        setSelected(row);
        setModalOpen(true);
    }
    function closeModal() {
        setSelected(null);
        setConfirmOpen(false);
        setModalOpen(false);
    }

    // Only allow remove client when the grouped row maps to EXACTLY one underlying record
    const canRemoveClient =
        selected &&
        selected.client_id &&
        Array.isArray(selected.__ids) &&
        selected.__ids.length === 1;

    async function confirmRemoveClient() {
        if (!canRemoveClient) return;
        const targetId = selected.__ids[0];
        const { error } = await supabase
            .from("inventory")
            .update({ client_id: null })
            .eq("id", targetId);
        if (error) {
            alert("Failed to remove client");
            console.error(error);
            return;
        }
        setConfirmOpen(false);
        // refresh table and close modal (group may merge/change after update)
        await fetchInventory();
        closeModal();
    }

    return (
        <NavFrame>
            <div className="wrap">
                <header className="bar">
                    <h1 className="title">Inventory</h1>
                </header>

                {/* Filters */}
                <div
                    className="toolbar inventory-toolbar"
                >
                    <input
                        className="input"
                        placeholder="Search product…"
                        value={search}
                        onChange={(e) => {
                            setPage(1);
                            setSearch(e.target.value);
                        }}
                    />

                    <select
                        className="input"
                        value={clientFilter}
                        onChange={(e) => {
                            setPage(1);
                            setClientFilter(e.target.value);
                        }}
                    >
                        <option value="ALL">Client Scope: All</option>
                        <option value="GENERIC">Client Scope: Generic (Any client)</option>
                        {clients.map((c) => (
                            <option key={c.id} value={`SPECIFIC:${c.id}`}>
                                Client Scope: {c.name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Table */}
                <div className="card">
                    <div className="table-wrap">
                        <table className="tbl">
                            <thead>
                                <tr>
                                    <th>Product</th>
                                    <th style={{ maxWidth: '100px' }}>Client Scope</th>
                                    <th className="right" style={{ maxWidth: '80px' }}>Qty Available</th>
                                    <th className="center" style={{ maxWidth: '80px' }}>Unit</th>
                                    <th className="right" style={{ maxWidth: '80px' }}>Avg Unit Cost</th>
                                    <th className="right" style={{ maxWidth: '80px' }}>Total Value</th>
                                    <th className="right" style={{ maxWidth: '80px' }}>Actions</th>
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
                                            No inventory
                                        </td>
                                    </tr>
                                )}
                                {!loading &&
                                    rows.map((r) => {
                                        const avg =
                                            Number(r.qty_available) > 0
                                                ? Number(r.total_value) /
                                                Number(r.qty_available)
                                                : 0;
                                        return (
                                            <tr key={r.__key}>
                                                <td className="truncate" data-th="Product">
                                                    {productName(r.product_id)}
                                                </td>
                                                <td data-th="Client Scope" style={{ maxWidth: '130px' }}>
                                                    <div className="truncate" style={{ maxWidth: '100%' }}>
                                                        {r.client_id
                                                            ? clientName(r.client_id)
                                                            : "Any"}
                                                    </div>
                                                </td>
                                                <td className="right" data-th="Qty Available" style={{ maxWidth: '100px' }}>
                                                    {Number(
                                                        r.qty_available
                                                    ).toLocaleString("en-IN")}
                                                </td>
                                                <td data-th="Unit" style={{ maxWidth: '100px' }}>
                                                    {productUnit(r.product_id)}
                                                </td>
                                                <td className="right" data-th="Avg Unit Cost" style={{ maxWidth: '100px' }}>{inr(avg)}</td>
                                                <td className="right" data-th="Total Value" style={{ maxWidth: '100px' }}>
                                                    {inr(r.total_value)}
                                                </td>
                                                <td className="right" data-th="Actions" style={{ maxWidth: '100px' }}>
                                                    <div className="actions">
                                                        <button
                                                            className="btn ghost"
                                                            onClick={() => openView(r)}
                                                        >
                                                            View
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                    </div>

                    <div className="pager">
                        <div className="muted">
                            {count} shown • Page {page} of {totalPages}
                        </div>
                        <div className="pager-controls">
                            <button
                                className="btn"
                                onClick={goPrev}
                                disabled={page <= 1}
                            >
                                Prev
                            </button>
                            <button
                                className="btn"
                                onClick={goNext}
                                disabled={page >= totalPages}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </div>

                {/* View Modal */}
                {modalOpen && selected && (
                    <div className="modal">
                        <div className="modal-card modal-card--lg">
                            <div className="modal-head">
                                <h2 className="modal-title">Inventory Details</h2>
                                <button
                                    className="btn icon"
                                    onClick={() => setModalOpen(false)}
                                    aria-label="Close"
                                >
                                    ×
                                </button>
                            </div>

                            <div className="details-grid">
                                <div className="details-col">
                                    <div className="detail-row">
                                        <div className="detail-label">Product</div>
                                        <div className="detail-value">
                                            {productName(selected.product_id)}
                                        </div>
                                    </div>
                                    <div className="detail-row">
                                        <div className="detail-label">
                                            Client Scope
                                        </div>
                                        <div className="detail-value">
                                            {selected.client_id
                                                ? clientName(selected.client_id)
                                                : "Any"}
                                        </div>
                                    </div>
                                    <div className="detail-row">
                                        <div className="detail-label">Last In</div>
                                        <div className="detail-value">
                                            {selected.last_in_at
                                                ? new Date(
                                                    selected.last_in_at
                                                ).toLocaleString()
                                                : "-"}
                                        </div>
                                    </div>
                                </div>
                                <div className="details-col">
                                    <div className="detail-row">
                                        <div className="detail-label">
                                            Qty Available
                                        </div>
                                        <div className="detail-value">
                                            {Number(
                                                selected.qty_available
                                            ).toLocaleString("en-IN")}
                                        </div>
                                    </div>
                                    <div className="detail-row">
                                        <div className="detail-label">
                                            Avg Unit Cost
                                        </div>
                                        <div className="detail-value">
                                            {inr(
                                                Number(selected.qty_available) > 0
                                                    ? Number(
                                                        selected.total_value
                                                    ) /
                                                    Number(
                                                        selected.qty_available
                                                    )
                                                    : 0
                                            )}
                                        </div>
                                    </div>
                                    <div className="detail-row">
                                        <div className="detail-label">
                                            Total Value
                                        </div>
                                        <div className="detail-value">
                                            {inr(selected.total_value)}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="modal-actions between">
                                <button
                                    className="btn width-100 margin-bottom"
                                    onClick={() => setModalOpen(false)}
                                >
                                    Close
                                </button>

                                {/* Only show Remove Client if this group is exactly one row AND has a client */}
                                {canRemoveClient && (
                                    <button
                                        className="btn danger width-100 margin-bottom"
                                        onClick={() => setConfirmOpen(true)}
                                    >
                                        Remove Client
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Confirm remove client */}
                        {confirmOpen && (
                            <div className="confirm">
                                <div className="confirm-card">
                                    <div className="confirm-title">
                                        Remove client from this stock?
                                    </div>
                                    <p className="confirm-text">
                                        This will convert this customized stock to{" "}
                                        <b>generic</b> (usable for any client).
                                        Continue?
                                    </p>
                                    <div className="confirm-actions">
                                        <button
                                            className="btn modal-btn"
                                            onClick={() => setConfirmOpen(false)}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="btn modal-btn danger"
                                            onClick={confirmRemoveClient}
                                        >
                                            Remove Client
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
