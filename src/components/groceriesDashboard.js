// groceriesDashboard.js
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "../styles/clients.css";

/** ---------- IST (Asia/Kolkata) helpers ---------- **/
const IST_TZ = "Asia/Kolkata";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function dateToISTDateInputValue(date) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: IST_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    return fmt.format(date);
}

function istDateInputToUTCStart(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
}

function istDateInputToUTCEnd(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - IST_OFFSET_MS);
}

/** ---------- Date Range Presets ---------- **/
const PRESETS = [
    "All Time",
    "Today",
    "Yesterday",
    "This Week",
    "Last Week",
    "This Month",
    "Last Month",
    "Last 3 Months",
    "Last 30 Days",
    "This Year",
    "Last Year",
    "Custom",
];

function getPresetRange(preset) {
    const now = new Date();
    const nowIST = new Date(now.getTime() + IST_OFFSET_MS);
    const y = nowIST.getUTCFullYear();
    const m = nowIST.getUTCMonth();
    const d = nowIST.getUTCDate();

    const startOfISTDay = (Y, M, D) => new Date(Date.UTC(Y, M, D, 0, 0, 0, 0) - IST_OFFSET_MS);
    const endOfISTDay = (Y, M, D) => new Date(Date.UTC(Y, M, D, 23, 59, 59, 999) - IST_OFFSET_MS);

    switch (preset) {
        case "All Time":
            return { start: null, end: null };
        case "Today":
            return { start: startOfISTDay(y, m, d), end: endOfISTDay(y, m, d) };
        case "Yesterday": {
            const dd = new Date(Date.UTC(y, m, d) - 24 * 3600 * 1000);
            return { start: startOfISTDay(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate()), end: endOfISTDay(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate()) };
        }
        case "This Week": {
            const js = new Date(Date.UTC(y, m, d));
            const weekday = (js.getUTCDay() + 6) % 7;
            const startRef = new Date(js.getTime() - weekday * 24 * 3600 * 1000);
            const endRef = new Date(startRef.getTime() + 6 * 24 * 3600 * 1000);
            return { start: startOfISTDay(startRef.getUTCFullYear(), startRef.getUTCMonth(), startRef.getUTCDate()), end: endOfISTDay(endRef.getUTCFullYear(), endRef.getUTCMonth(), endRef.getUTCDate()) };
        }
        case "Last Week": {
            const js = new Date(Date.UTC(y, m, d));
            const weekday = (js.getUTCDay() + 6) % 7;
            const startRef = new Date(js.getTime() - (weekday + 7) * 24 * 3600 * 1000);
            const endRef = new Date(startRef.getTime() + 6 * 24 * 3600 * 1000);
            return { start: startOfISTDay(startRef.getUTCFullYear(), startRef.getUTCMonth(), startRef.getUTCDate()), end: endOfISTDay(endRef.getUTCFullYear(), endRef.getUTCMonth(), endRef.getUTCDate()) };
        }
        case "This Month": {
            const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
            return { start: startOfISTDay(y, m, 1), end: endOfISTDay(y, m, lastDay) };
        }
        case "Last Month": {
            const ref = new Date(Date.UTC(y, m, 1) - 24 * 3600 * 1000);
            const Y = ref.getUTCFullYear(), M = ref.getUTCMonth();
            const lastDay = new Date(Date.UTC(Y, M + 1, 0)).getUTCDate();
            return { start: startOfISTDay(Y, M, 1), end: endOfISTDay(Y, M, lastDay) };
        }
        case "Last 3 Months": {
            const endRef = endOfISTDay(y, m, d);
            const startRef = new Date(endRef.getTime() - 89 * 24 * 3600 * 1000); // 90 days total including today
            return { start: startRef, end: endRef };
        }
        case "Last 30 Days": {
            const endRef = endOfISTDay(y, m, d);
            const startRef = new Date(endRef.getTime() - 29 * 24 * 3600 * 1000);
            return { start: startRef, end: endRef };
        }
        case "This Year":
            return { start: startOfISTDay(y, 0, 1), end: endOfISTDay(y, 11, 31) };
        case "Last Year":
            return { start: startOfISTDay(y - 1, 0, 1), end: endOfISTDay(y - 1, 11, 31) };
        default:
            return { start: null, end: null };
    }
}

/** ---------- Utils ---------- **/
const fmtINR = (n) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number.isFinite(+n) ? +n : 0);
const fmtQty = (n) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(+n || 0);
const sum = (arr) => arr.reduce((a, b) => a + (+b || 0), 0);

/** Calculate efficiency metrics **/
function calculateEfficiencyMetrics(salesData, purchasesData) {
    const totalRevenue = sum(salesData.map(s => s.revenue || 0));
    const totalCost = sum(purchasesData.map(p => p.cost || 0));
    const totalProfit = totalRevenue - totalCost;
    const roi = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    return {
        roi,
        efficiency: Math.min(100, Math.max(0, (totalRevenue / (totalCost || 1)) * 100)),
        profitMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
    };
}

export default function GroceriesDashboard() {
    const [preset, setPreset] = useState("All Time");
    const [customStart, setCustomStart] = useState("");
    const [customEnd, setCustomEnd] = useState("");
    const [focusClientId, setFocusClientId] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // Data states
    const [metrics, setMetrics] = useState({
        orders: 0,
        qtyKg: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        receivables: 0,
        openPurchases: 0,
        closedPurchases: 0,
        purchasePaid: 0,
        purchaseUnpaid: 0,
        avgSell: 0,
        avgCost: 0,
        avgMarginPct: 0,
        roi: 0,
        efficiency: 0,
        profitMargin: 0
    });

    const [trend, setTrend] = useState([]);
    const [categoryQty, setCategoryQty] = useState([]);
    const [manuQty, setManuQty] = useState([]);
    const [statusDist, setStatusDist] = useState({ open: 0, closed: 0 });
    const [deliveryDist, setDeliveryDist] = useState({ delivered: 0, pending: 0 });
    const [topClients, setTopClients] = useState([]);
    const [topVendors, setTopVendors] = useState([]);
    const [focusClient, setFocusClient] = useState([]);
    const [clientsList, setClientsList] = useState([]);
    const [productPerformance, setProductPerformance] = useState([]);
    const [seasonalTrend, setSeasonalTrend] = useState([]);
    const [clientRetention, setClientRetention] = useState([]);

    const { start, end } = useMemo(() => {
        if (preset === "Custom") {
            const s = customStart ? istDateInputToUTCStart(customStart) : null;
            const e = customEnd ? istDateInputToUTCEnd(customEnd) : null;
            return { start: s, end: e };
        }
        return getPresetRange(preset);
    }, [preset, customStart, customEnd]);

    useEffect(() => {
        let active = true;
        (async () => {
            setLoading(true);
            setError("");
            try {
                // --- PRODUCTS (Groceries) ---
                const { data: products, error: eProd } = await supabase
                    .from("products")
                    .select("id,name,purchase_price,selling_price,category,active,unit")
                    .eq("category", "Groceries")
                    .eq("active", true)
                    .limit(10000);
                if (eProd) throw eProd;

                const groceryIds = (products || []).map((p) => p.id);
                const idToProd = new Map((products || []).map((p) => [p.id, p]));

                if (!groceryIds.length) {
                    if (!active) return;
                    resetAllData();
                    return;
                }

                // --- Sales data ---
                let sales = [];
                {
                    let q = supabase.from("sales").select("id,sale_at,client_id,delivered");
                    if (start) q = q.gte("sale_at", start.toISOString());
                    if (end) q = q.lte("sale_at", end.toISOString());
                    const { data, error } = await q.limit(20000);
                    if (error) throw error;
                    sales = data || [];
                }
                const saleIds = sales.map((s) => s.id);

                let sItems = [];
                if (saleIds.length) {
                    const { data, error } = await supabase
                        .from("sales_items")
                        .select("id,sale_id,product_id,quantity,unit_price")
                        .in("sale_id", saleIds)
                        .in("product_id", groceryIds)
                        .limit(200000);
                    if (error) throw error;
                    sItems = data || [];
                }

                // Clients data
                let clientsMap = new Map();
                if (sales.length) {
                    const clientIds = Array.from(new Set(sales.map((s) => s.client_id)));
                    if (clientIds.length) {
                        const { data } = await supabase.from("clients").select("id,name").in("id", clientIds).limit(20000);
                        (data || []).forEach((c) => clientsMap.set(c.id, c.name));
                        setClientsList((data || []).map((c) => ({ id: c.id, name: c.name })));
                    }
                }

                // --- Payments (SALE) ---
                let salePays = [];
                if (saleIds.length) {
                    let q = supabase
                        .from("payments")
                        .select("id,amount,paid_at,sale_id,kind")
                        .eq("kind", "SALE")
                        .in("sale_id", saleIds);
                    if (start) q = q.gte("paid_at", start.toISOString());
                    if (end) q = q.lte("paid_at", end.toISOString());
                    const { data, error } = await q.limit(200000);
                    if (error) throw error;
                    salePays = data || [];
                }

                // --- Purchases data ---
                let pItems = [];
                {
                    const { data, error } = await supabase
                        .from("purchase_items")
                        .select("id,purchase_id,product_id,quantity,unit_price,freight_charge_split")
                        .in("product_id", groceryIds)
                        .limit(200000);
                    if (error) throw error;
                    pItems = data || [];
                }
                const purchaseIds = Array.from(new Set(pItems.map((p) => p.purchase_id)));

                let purchases = [];
                if (purchaseIds.length) {
                    let q = supabase
                        .from("purchases")
                        .select("id,purchase_at,vendor_id,status,freight_charge_total")
                        .in("id", purchaseIds);
                    if (start) q = q.gte("purchase_at", start.toISOString());
                    if (end) q = q.lte("purchase_at", end.toISOString());
                    const { data, error } = await q.limit(20000);
                    if (error) throw error;
                    purchases = data || [];
                }

                // Vendors data
                let vendorMap = new Map();
                let vendorRevenue = new Map();
                if (purchases.length) {
                    const vendorIds = Array.from(new Set(purchases.map((p) => p.vendor_id)));
                    if (vendorIds.length) {
                        const { data } = await supabase.from("vendors").select("id,name").in("id", vendorIds).limit(20000);
                        (data || []).forEach((v) => vendorMap.set(v.id, v.name));
                    }
                }

                // --- Payments (PURCHASE) ---
                let purchasePays = [];
                if (purchaseIds.length) {
                    let q = supabase
                        .from("payments")
                        .select("id,amount,paid_at,purchase_id,kind")
                        .eq("kind", "PURCHASE")
                        .in("purchase_id", purchaseIds);
                    if (start) q = q.gte("paid_at", start.toISOString());
                    if (end) q = q.lte("paid_at", end.toISOString());
                    const { data, error } = await q.limit(200000);
                    if (error) throw error;
                    purchasePays = data || [];
                }

                // ---------- Calculations ----------
                const saleDateMap = new Map(sales.map((s) => [s.id, new Date(s.sale_at)]));
                const delivered = sales.filter((s) => !!s.delivered).length;
                const pending = sales.length - delivered;

                const orders = new Set(sItems.map((i) => i.sale_id)).size;
                const qtyKg = sum(sItems.map((i) => +i.quantity));
                const revenue = sum(sItems.map((i) => +i.quantity * +i.unit_price));

                const prodCostMap = new Map((products || []).map((p) => [p.id, +p.purchase_price || 0]));
                const cost = sum(sItems.map((i) => +i.quantity * (prodCostMap.get(i.product_id) ?? +i.unit_price ?? 0)));
                const profit = revenue - cost;

                const avgSell = qtyKg ? revenue / qtyKg : 0;
                const avgCost = qtyKg ? cost / qtyKg : 0;
                const avgMarginPct = avgSell ? ((avgSell - avgCost) / avgSell) * 100 : 0;

                const received = sum(salePays.map((p) => +p.amount));
                const receivables = Math.max(0, revenue - received);

                let open = 0, closed = 0;
                purchases.forEach((p) => (p.status === "Closed" ? closed++ : open++));
                const purchaseGross = sum(pItems.map((pi) => +pi.quantity * +pi.unit_price + (+pi.freight_charge_split || 0)));
                const paidToVendors = sum(purchasePays.map((p) => +p.amount));
                const unpaidToVendors = Math.max(0, purchaseGross - paidToVendors);

                // Efficiency metrics
                const efficiencyMetrics = calculateEfficiencyMetrics(
                    sItems.map(i => ({
                        revenue: +i.quantity * +i.unit_price,
                        cost: +i.quantity * (prodCostMap.get(i.product_id) ?? +i.unit_price ?? 0)
                    })),
                    pItems.map(p => ({ cost: +p.quantity * +p.unit_price }))
                );

                // Trend by day
                const byDay = new Map();
                sItems.forEach((i) => {
                    const at = saleDateMap.get(i.sale_id) || new Date();
                    const key = dateToISTDateInputValue(at);
                    const r = +i.quantity * +i.unit_price;
                    const c = +i.quantity * (prodCostMap.get(i.product_id) ?? +i.unit_price ?? 0);
                    const prev = byDay.get(key) || { revenue: 0, cost: 0, profit: 0, orders: 0 };
                    prev.revenue += r;
                    prev.cost += c;
                    prev.profit += (r - c);
                    prev.orders += 1;
                    byDay.set(key, prev);
                });
                const trendArr = Array.from(byDay.entries())
                    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
                    .map(([date, v]) => ({ date, ...v }));

                // Product category analysis (by unit type)
                const categoryMap = new Map();
                const clientQty = new Map();
                const vendorSpend = new Map();
                const productPerf = new Map();

                sItems.forEach((i) => {
                    const product = idToProd.get(i.product_id);
                    const unit = product?.unit || "Unknown";
                    const revenue = +i.quantity * +i.unit_price;
                    const cost = +i.quantity * (prodCostMap.get(i.product_id) ?? +i.unit_price ?? 0);
                    const profit = revenue - cost;

                    // Category breakdown by unit
                    categoryMap.set(unit, (categoryMap.get(unit) || 0) + (+i.quantity || 0));

                    // Client breakdown
                    const cName = clientsMap.get(sales.find((s) => s.id === i.sale_id)?.client_id) || "(Unknown)";
                    clientQty.set(cName, (clientQty.get(cName) || 0) + (+i.quantity || 0));

                    // Product performance
                    const prodName = product?.name || "Unknown";
                    const current = productPerf.get(prodName) || { qty: 0, revenue: 0, cost: 0, profit: 0 };
                    current.qty += +i.quantity;
                    current.revenue += revenue;
                    current.cost += cost;
                    current.profit += profit;
                    productPerf.set(prodName, current);
                });

                // Vendor analysis from purchases
                pItems.forEach((pi) => {
                    const vendorName = vendorMap.get(purchases.find((p) => p.id === pi.purchase_id)?.vendor_id) || "(Unknown)";
                    const spend = +pi.quantity * +pi.unit_price;
                    vendorSpend.set(vendorName, (vendorSpend.get(vendorName) || 0) + spend);
                });

                const categoryQtyArr = Array.from(categoryMap.entries()).map(([category, qty]) => ({ category, qty })).sort((a, b) => b.qty - a.qty);
                const topClientsArr = Array.from(clientQty.entries()).map(([client, qty]) => ({ client, qty })).sort((a, b) => b.qty - a.qty).slice(0, 10);
                const topVendorsArr = Array.from(vendorSpend.entries()).map(([vendor, spend]) => ({ vendor, spend })).sort((a, b) => b.spend - a.spend).slice(0, 10);
                const productPerfArr = Array.from(productPerf.entries()).map(([product, data]) => ({
                    product,
                    ...data,
                    margin: data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0
                })).sort((a, b) => b.profit - a.profit).slice(0, 15);

                // Manufacturer-wise qty from purchases
                const byVendorQty = new Map();
                pItems.forEach((pi) => {
                    const vendorName = vendorMap.get(purchases.find((p) => p.id === pi.purchase_id)?.vendor_id) || "(Unknown)";
                    byVendorQty.set(vendorName, (byVendorQty.get(vendorName) || 0) + (+pi.quantity || 0));
                });
                const manuQtyArr = Array.from(byVendorQty.entries()).map(([vendor, qty]) => ({ vendor, qty })).sort((a, b) => b.qty - a.qty);

                // Delivery status
                const delivery = { delivered, pending };

                // Status distribution
                const status = { open, closed };

                // Focus client breakdown
                let focusClientArr = [];
                if (focusClientId) {
                    const saleIdsForClient = sales.filter((s) => s.client_id === focusClientId).map((s) => s.id);
                    const productMap = new Map();
                    sItems.filter((i) => saleIdsForClient.includes(i.sale_id)).forEach((i) => {
                        const product = idToProd.get(i.product_id);
                        const prodName = product?.name || "Unknown";
                        productMap.set(prodName, (productMap.get(prodName) || 0) + (+i.quantity || 0));
                    });
                    focusClientArr = Array.from(productMap.entries()).map(([product, qty]) => ({ product, qty })).sort((a, b) => b.qty - a.qty).slice(0, 10);
                }

                // Seasonal trends (by month)
                const monthlyTrend = new Map();
                sItems.forEach((i) => {
                    const at = saleDateMap.get(i.sale_id) || new Date();
                    const monthKey = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
                    const revenue = +i.quantity * +i.unit_price;
                    const current = monthlyTrend.get(monthKey) || { revenue: 0, orders: 0 };
                    current.revenue += revenue;
                    current.orders += 1;
                    monthlyTrend.set(monthKey, current);
                });
                const seasonalTrendArr = Array.from(monthlyTrend.entries())
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([month, data]) => ({ month, ...data }));

                if (!active) return;

                setMetrics({
                    orders,
                    qtyKg,
                    revenue,
                    cost,
                    profit,
                    receivables,
                    openPurchases: open,
                    closedPurchases: closed,
                    purchasePaid: paidToVendors,
                    purchaseUnpaid: unpaidToVendors,
                    avgSell,
                    avgCost,
                    avgMarginPct,
                    ...efficiencyMetrics
                });

                setTrend(trendArr);
                setCategoryQty(categoryQtyArr);
                setManuQty(manuQtyArr);
                setStatusDist(status);
                setDeliveryDist(delivery);
                setTopClients(topClientsArr);
                setTopVendors(topVendorsArr);
                setFocusClient(focusClientArr);
                setProductPerformance(productPerfArr);
                setSeasonalTrend(seasonalTrendArr);

            } catch (e) {
                console.error(e);
                if (!active) return;
                setError(e?.message || "Failed to load Groceries Dashboard");
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [preset, customStart, customEnd, focusClientId]);

    const resetAllData = () => {
        setMetrics({
            orders: 0, qtyKg: 0, revenue: 0, cost: 0, profit: 0, receivables: 0,
            openPurchases: 0, closedPurchases: 0, purchasePaid: 0, purchaseUnpaid: 0,
            avgSell: 0, avgCost: 0, avgMarginPct: 0, roi: 0, efficiency: 0, profitMargin: 0
        });
        setTrend([]); setCategoryQty([]); setManuQty([]);
        setStatusDist({ open: 0, closed: 0 }); setDeliveryDist({ delivered: 0, pending: 0 });
        setTopClients([]); setTopVendors([]); setFocusClient([]);
        setClientsList([]); setProductPerformance([]); setSeasonalTrend([]);
    };

    return (
        <div className="wrap">
            {/* Toolbar */}
            <div className="ledger-toolbar card" style={{ padding: 12, marginBottom: 12 }}>
                <div className="ledger-toolbar__left">
                    <div className="ledger-toolbar__label lbl-text">Date Range</div>
                    <select className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
                        {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <div />
                </div>
                <div className="ledger-toolbar__range">
                    {preset === "Custom" && (
                        <>
                            <input type="date" className="input" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                            <input type="date" className="input" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
                        </>
                    )}
                </div>
            </div>

            {error && (
                <div className="card" style={{ padding: 12, marginBottom: 12, borderLeft: "4px solid #dc2626" }}>
                    <div style={{ color: "#dc2626", fontWeight: 600 }}>Error</div>
                    <div className="muted">{error}</div>
                </div>
            )}

            {/* KPIs */}
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
                <GroceriesKPIGrid metrics={metrics} />
            </div>

            {/* Main Performance Charts */}
            <div className="grid summary-grid">
                <div className="card" style={{ padding: 12 }}>
                    <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>📊 Revenue & Cost Trend</h3>
                    <LineChartRC data={trend} aKey="revenue" bKey="cost" aLabel="Revenue" bLabel="Cost" />
                </div>
                <div className="card" style={{ padding: 12 }}>
                    <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>📈 Profit & Orders Trend</h3>
                    <ComboChart data={trend} />
                </div>
            </div>

            {/* Category & Vendor Analysis */}
            <div className="grid summary-grid" style={{ marginTop: 12 }}>
                <div className="card" style={{ padding: 12 }}>
                    <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>🏭 Top Suppliers by Spend</h3>
                    <BarChart data={topVendors} xKey="vendor" yKey="spend" />
                </div>
                <div className="card" style={{ padding: 12 }}>
                    <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>📦 Supplier Quantity Share</h3>
                    <BarChart data={manuQty.slice(0, 8)} xKey="vendor" yKey="qty" />
                </div>
                <div className="card" style={{ padding: 12 }}>
                    <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>🏆 Top Performing Products</h3>
                    <ProductPerformanceChart data={productPerformance} />
                </div>
                <div className="card" style={{ padding: 12 }}>
                    <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>📅 Monthly Revenue Trend</h3>
                    <BarChart data={seasonalTrend} xKey="month" yKey="revenue" />
                </div>
            </div>

            {/* Status & Seasonal Analysis */}
            <div className="grid summary-grid" style={{ marginTop: 12 }}>
                <div className="card" style={{ padding: 12 }}>
                    <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>📋 Purchase Order Status</h3>
                    <Donut open={statusDist.open} closed={statusDist.closed} labels={["Open", "Closed"]} />
                </div>
                <div className="card" style={{ padding: 12 }}>
                    <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>🚚 Delivery Status</h3>
                    <Donut open={deliveryDist.pending} closed={deliveryDist.delivered} labels={["Pending", "Delivered"]} colors={["#F59E0B", "#10B981"]} />
                </div>
            </div>

            {/* Focus Client Analysis */}
            <div className="card" style={{ padding: 12, marginTop: 12, marginBottom: 12 }}>
                <div className="parties-toolbar" style={{ marginTop: 0 }}>
                    <div className="parties-toolbar__group">
                        <label className="lbl-text">Focus Client Purchase Analysis</label>
                        <select className="input" value={focusClientId} onChange={(e) => setFocusClientId(e.target.value)}>
                            <option value="">(Select Client)</option>
                            {clientsList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                </div>
                {focusClientId ? (
                    <div className="grid summary-grid" style={{ marginTop: 12, marginBottom: 12 }}>
                        <div className="card" style={{ padding: 12 }}>
                            <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>🛒 Client Product Preferences</h3>
                            <BarChart data={focusClient} xKey="product" yKey="qty" />
                        </div>
                    </div>
                ) : (
                    <div className="muted" style={{ marginTop: 8, textAlign: 'center', padding: '20px' }}>
                        Select a client to view their product preferences and purchasing patterns
                    </div>
                )}
            </div>

            {/* Loading */}
            {loading && (
                <div className="card" style={{ padding: 12, marginTop: 12 }}>
                    <div className="muted" style={{ textAlign: 'center' }}>Loading Groceries Business Intelligence...</div>
                </div>
            )}

            {/* Scoped styles */}
            <style>{`
        .kpi-grid { display:grid; grid-template-columns: 1fr; gap:10px; }
        @media (min-width:640px){ .kpi-grid{ grid-template-columns: repeat(3,1fr); } }
        @media (min-width:1024px){ .kpi-grid{ grid-template-columns: repeat(4,1fr); } }
        @media (min-width:1280px){ .kpi-grid{ grid-template-columns: repeat(4,1fr); } }
        
        .kpi { border:1px solid var(--border); border-radius:12px; padding:12px; background:#fff; position:relative; overflow:hidden; }
        .kpi::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; background:linear(90deg, #10B981, #F59E0B); }
        .kpi h4 { margin:0 0 6px; font-size:13px; color:var(--muted); font-weight:600; }
        .kpi .big { font-size:22px; font-weight:800; letter-spacing:-.01em; color:var(--text); }
        .kpi .sub { font-size:12px; color:var(--muted); }
        .kpi .danger { color:#b91c1c; font-weight:700; }
        .kpi .ok { color:#065F46; font-weight:700; }
        .kpi .warning { color:#d97706; font-weight:700; }
        
        .pill { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; border:1px solid var(--border); font-size:12px; }
        .pill--in { background:#ECFDF5; color:#065F46; border-color:#A7F3D0; }
        .pill--out { background:#FEF2F2; color:#991B1B; border-color:#FECACA; }
        .pill--neutral { background:#F3F4F6; color:#374151; border-color:#D1D5DB; }
        
        .chart { width:100%; height:260px; }
        .lineA { fill:none; stroke:#2563eb; stroke-width:2; }
        .lineB { fill:none; stroke:#ef4444; stroke-width:2; }
        .combo-line { fill:none; stroke:#10B981; stroke-width:2; }
        .combo-bar { fill:rgba(37,99,235,.15); }
        .gridline { stroke:#e5e7eb; stroke-width:1; }
        .bar { fill:rgba(37,99,235,.85); }
        .bar:hover { opacity:.9; }
        
        .legend { display:flex; gap:8px; flex-wrap:wrap; margin-top:6px; }
        .legend .key { display:inline-flex; align-items:center; gap:6px; font-size:12px; }
        .legend .swatch { width:12px; height:12px; border-radius:3px; border:1px solid #e5e7eb; }
        
        .efficiency-gauge { 
          width:120px; height:120px; border-radius:50%; 
          background:conic-gradient(#10B981 0% 75%, #F59E0B 75% 90%, #EF4444 90% 100%);
          margin:0 auto 10px;
          position:relative;
        }
        .efficiency-gauge::before {
          content:attr(data-value)'%';
          position:absolute;
          top:50%; left:50%;
          transform:translate(-50%,-50%);
          font-weight:700;
          font-size:18px;
          color:var(--text);
        }
        
        .trend-indicator { 
          display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:600;
          padding:2px 8px; border-radius:6px; margin-left:8px;
        }
        .trend-up { background:#ECFDF5; color:#065F46; }
        .trend-down { background:#FEF2F2; color:#DC2626; }
        .trend-neutral { background:#F3F4F6; color:#6B7280; }
      `}</style>
        </div>
    );
}

/** ---------- Groceries KPI Grid ---------- **/
function GroceriesKPIGrid({ metrics }) {
    const getTrendIndicator = (value, isPositive = true) => {
        if (value > 0) return <span className={`trend-indicator ${isPositive ? 'trend-up' : 'trend-down'}`}>↗</span>;
        if (value < 0) return <span className={`trend-indicator ${isPositive ? 'trend-down' : 'trend-up'}`}>↘</span>;
        return <span className="trend-indicator trend-neutral">→</span>;
    };

    return (
        <div className="kpi-grid">
            <div className="kpi">
                <h4>🛒 Total Orders</h4>
                <div className="big">{metrics.orders || 0}</div>
                <div className="sub">Sales Count {getTrendIndicator(metrics.orders)}</div>
            </div>

            <div className="kpi">
                <h4>💰 Revenue</h4>
                <div className="big ok">{fmtINR(metrics.revenue)}</div>
                <div className="sub">Total Sales {getTrendIndicator(metrics.revenue)}</div>
            </div>

            <div className="kpi">
                <h4>💸 Cost</h4>
                <div className="big danger">{fmtINR(metrics.cost)}</div>
                <div className="sub">Total Cost {getTrendIndicator(metrics.cost, false)}</div>
            </div>

            <div className="kpi">
                <h4>📈 Net Profit</h4>
                <div className="big ok">{fmtINR(metrics.profit)}</div>
                <div className="sub">{metrics.profitMargin?.toFixed(1)}% Margin {getTrendIndicator(metrics.profit)}</div>
            </div>


            <div className="kpi">
                <h4>⏳ Receivables</h4>
                <div className="big warning">{fmtINR(metrics.receivables)}</div>
                <div className="sub">Outstanding Credit</div>
            </div>

            <div className="kpi">
                <h4>📋 Purchase Status</h4>
                <div className="pill pill--out">Open: {metrics.openPurchases || 0}</div>
                <div className="pill pill--in" style={{ marginLeft: 8 }}>Closed: {metrics.closedPurchases || 0}</div>
                <div className="sub" style={{ marginTop: 6 }}>Purchase Orders</div>
            </div>

            <div className="kpi">
                <h4>🧾 Vendor Payments</h4>
                <div className="big">{`${fmtINR(metrics.purchasePaid)} | ${fmtINR(metrics.purchaseUnpaid)}`}</div>
                <div className="sub">Paid | Due</div>
            </div>

            <div className="kpi">
                <h4>📈 ROI</h4>
                <div className="big ok">{metrics.roi?.toFixed(1)}%</div>
                <div className="sub">Return on Investment</div>
            </div>
        </div>
    );
}

/** ---------- Chart Components ---------- **/

// Line Chart for Revenue & Cost
function LineChartRC({ data, aKey = "revenue", bKey = "cost", aLabel = "Revenue", bLabel = "Cost" }) {
    const W = 760, H = 300, P = 40; // Increased height for labels
    const ys = data.flatMap((d) => [d[aKey] || 0, d[bKey] || 0]);
    const maxY = Math.max(1, ...ys);
    const n = data.length;
    const gap = 8;

    const scaleX = (i) => P + (i * (W - 2 * P)) / Math.max(1, n - 1);
    const scaleY = (v) => H - P - ((v || 0) * (H - 2 * P)) / (maxY || 1);

    // Y-axis ticks
    const yTicks = 5;
    const yStep = maxY / (yTicks - 1);
    const yAxisLabels = Array.from({ length: yTicks }, (_, i) => i * yStep);

    const pathFor = (key) => data.map((d, i) => `${i ? "L" : "M"}${scaleX(i)},${scaleY(d[key] || 0)}`).join(" ");

    // X-axis labels (dates)
    const xLabels = [];
    if (data.length > 0) {
        const step = Math.max(1, Math.ceil(data.length / 6));
        for (let i = 0; i < data.length; i += step) {
            xLabels.push({
                x: scaleX(i),
                label: data[i].date.split('-').slice(1).join('/') // Show MM/DD format
            });
        }
    }

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" style={{ width: '100%', height: 'auto' }}>
            {/* Grid lines and Y-axis */}
            <line x1={P} x2={P} y1={P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />
            <line x1={P} x2={W - P} y1={H - P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />

            {/* Y-axis labels and grid lines */}
            {yAxisLabels.map((value, i) => {
                const y = scaleY(value);
                return (
                    <React.Fragment key={`y-${i}`}>
                        <line x1={P} x2={W - P} y1={y} y2={y} className="gridline" stroke="#f0f0f0" strokeWidth="1" />
                        <text x={P - 8} y={y + 4} textAnchor="end" fontSize="12" fill="#666">
                            {fmtINR(value)}
                        </text>
                    </React.Fragment>
                );
            })}

            {/* X-axis labels */}
            {xLabels.map((label, i) => (
                <text key={`x-${i}`} x={label.x} y={H - P / 2} textAnchor="middle" fontSize="11" fill="#666">
                    {label.label}
                </text>
            ))}

            {/* Lines */}
            <path d={pathFor(aKey)} className="lineA" stroke="#2563eb" strokeWidth="2" fill="none" />
            <path d={pathFor(bKey)} className="lineB" stroke="#ef4444" strokeWidth="2" fill="none" />

            {/* Legend */}
            <g>
                <circle cx={P + 6} cy={P - 10} r={4} fill="#2563eb" />
                <text x={P + 14} y={P - 6} fontSize="12" fill="#333">{aLabel}</text>
                <circle cx={P + 86} cy={P - 10} r={4} fill="#ef4444" />
                <text x={P + 94} y={P - 6} fontSize="12" fill="#333">{bLabel}</text>
            </g>

            {/* Y-axis label */}
            <text x={-H / 2} y={15} textAnchor="middle" fontSize="12" fill="#666" transform="rotate(-90, 15, 15)">
                Amount (₹)
            </text>
        </svg>
    );
}

// Combo Chart (Profit + Orders)
function ComboChart({ data }) {
    const W = 760, H = 300, P = 40; // Increased height for labels
    const profits = data.map(d => d.profit || 0);
    const orders = data.map(d => d.orders || 0);
    const maxProfit = Math.max(1, ...profits);
    const maxOrders = Math.max(1, ...orders);
    const n = data.length;

    const scaleX = (i) => P + (i * (W - 2 * P)) / Math.max(1, n - 1);
    const scaleYProfit = (v) => H - P - ((v || 0) * (H - 2 * P)) / (maxProfit || 1);
    const scaleYOrders = (v) => H - P - ((v || 0) * (H - 2 * P)) / (maxOrders || 1);

    // Y-axis ticks for profit (left axis)
    const yTicksProfit = 5;
    const yStepProfit = maxProfit / (yTicksProfit - 1);
    const yAxisLabelsProfit = Array.from({ length: yTicksProfit }, (_, i) => i * yStepProfit);

    // Y-axis ticks for orders (right axis)
    const yTicksOrders = 5;
    const yStepOrders = maxOrders / (yTicksOrders - 1);
    const yAxisLabelsOrders = Array.from({ length: yTicksOrders }, (_, i) => Math.round(i * yStepOrders));

    // X-axis labels (dates)
    const xLabels = [];
    if (data.length > 0) {
        const step = Math.max(1, Math.ceil(data.length / 6));
        for (let i = 0; i < data.length; i += step) {
            xLabels.push({
                x: scaleX(i),
                label: data[i].date.split('-').slice(1).join('/') // Show MM/DD format
            });
        }
    }

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" style={{ width: '100%', height: 'auto' }}>
            {/* Grid lines and Y-axes */}
            <line x1={P} x2={P} y1={P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />
            <line x1={W - P} x2={W - P} y1={P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />
            <line x1={P} x2={W - P} y1={H - P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />

            {/* Left Y-axis labels (Profit) */}
            {yAxisLabelsProfit.map((value, i) => {
                const y = scaleYProfit(value);
                return (
                    <React.Fragment key={`y-profit-${i}`}>
                        <line x1={P} x2={W - P} y1={y} y2={y} className="gridline" stroke="#f0f0f0" strokeWidth="1" />
                        <text x={P - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#666">
                            {fmtINR(value)}
                        </text>
                    </React.Fragment>
                );
            })}

            {/* Right Y-axis labels (Orders) */}
            {yAxisLabelsOrders.map((value, i) => {
                const y = scaleYOrders(value);
                return (
                    <text key={`y-orders-${i}`} x={W - P + 20} y={y + 4} fontSize="11" fill="#2563eb">
                        {value}
                    </text>
                );
            })}

            {/* X-axis labels */}
            {xLabels.map((label, i) => (
                <text key={`x-${i}`} x={label.x} y={H - P / 2} textAnchor="middle" fontSize="11" fill="#666">
                    {label.label}
                </text>
            ))}

            {/* Order Bars */}
            {data.map((d, i) => {
                const x = scaleX(i) - 12;
                const y = scaleYOrders(d.orders || 0);
                const h = H - P - y;
                return (
                    <rect
                        key={i}
                        x={x}
                        y={y}
                        width={24}
                        height={h}
                        fill="rgba(37, 99, 235, 0.15)"
                        rx="2"
                        ry="2"
                    />
                );
            })}

            {/* Profit Line */}
            <path
                d={data.map((d, i) => `${i ? "L" : "M"}${scaleX(i)},${scaleYProfit(d.profit || 0)}`).join(" ")}
                className="combo-line"
                stroke="#10B981"
                strokeWidth="2"
                fill="none"
            />

            {/* Legend */}
            <g>
                <circle cx={P + 6} cy={P - 10} r={4} fill="#10B981" />
                <text x={P + 14} y={P - 6} fontSize="12" fill="#333">Profit (₹)</text>
                <rect x={P + 90} y={P - 14} width={16} height={8} fill="rgba(37,99,235,.15)" rx="2" ry="2" />
                <text x={P + 110} y={P - 6} fontSize="12" fill="#333">Orders (count)</text>
            </g>

            {/* Y-axis labels */}
            <text x={-H / 2} y={15} textAnchor="middle" fontSize="12" fill="#666" transform="rotate(-90, 15, 15)">
                Profit (₹)
            </text>
            <text x={W + H / 2 - 30} y={-15} textAnchor="middle" fontSize="12" fill="#2563eb" transform="rotate(90, 15, 15)">
                Orders
            </text>
        </svg>
    );
}

// Product Performance Chart
function ProductPerformanceChart({ data }) {
    const W = 760, H = 300, P = 40; // Increased height for labels
    const maxProfit = Math.max(1, ...data.map(d => d.profit || 0));
    const n = Math.min(8, data.length);
    const gap = 12;
    const barW = Math.max(15, (W - 2 * P) / n - gap);

    const scaleX = (i) => P + i * (barW + gap);
    const scaleY = (v) => H - P - ((v || 0) * (H - 2 * P)) / (maxProfit || 1);

    // Y-axis ticks
    const yTicks = 5;
    const yStep = maxProfit / (yTicks - 1);
    const yAxisLabels = Array.from({ length: yTicks }, (_, i) => Math.floor(i * yStep));

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" style={{ width: '100%', height: 'auto' }}>
            {/* Grid lines and Y-axis */}
            <line x1={P} x2={P} y1={P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />
            <line x1={P} x2={W - P} y1={H - P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />

            {/* Y-axis labels and grid lines */}
            {yAxisLabels.map((value, i) => {
                const y = scaleY(value);
                return (
                    <React.Fragment key={`y-${i}`}>
                        <line x1={P} x2={W - P} y1={y} y2={y} className="gridline" stroke="#f0f0f0" strokeWidth="1" />
                        <text x={P - 8} y={y + 4} textAnchor="end" fontSize="11" fill="#666">
                            {fmtINR(value)}
                        </text>
                    </React.Fragment>
                );
            })}

            {/* Bars with labels */}
            {data.slice(0, n).map((d, i) => {
                const x = scaleX(i);
                const y = scaleY(d.profit);
                const h = H - P - y;
                const color = d.profit > 0 ? "#10B981" : "#EF4444";
                const label = d.product ? String(d.product).substring(0, 12) : ''; // Truncate long names

                return (
                    <g key={i}>
                        <rect
                            x={x}
                            y={y}
                            width={barW}
                            height={h}
                            fill={color}
                            rx="2"
                            ry="2"
                        />
                        {/* X-axis labels */}
                        <text
                            x={x + barW / 2}
                            y={H - P / 2}
                            textAnchor="middle"
                            fontSize="11"
                            fill="#666"
                            transform={`rotate(-45, ${x + barW / 2}, ${H - P / 2})`}
                            style={{ textOverflow: 'ellipsis', overflow: 'hidden' }}
                        >
                            {label}
                        </text>
                        {/* Value labels on top of bars */}
                        {h > 20 && (
                            <text
                                x={x + barW / 2}
                                y={y - 5}
                                textAnchor="middle"
                                fontSize="10"
                                fontWeight="500"
                                fill="#444"
                            >
                                {fmtINR(d.profit)}
                            </text>
                        )}
                    </g>
                );
            })}

            {/* Y-axis label */}
            <text x={-H / 2} y={15} textAnchor="middle" fontSize="12" fill="#666" transform="rotate(-90, 15, 15)">
                Profit (₹)
            </text>
        </svg>
    );
}

// Base Bar Chart Component
function BarChart({ data, xKey, yKey, colorMap = {}, yLabel = 'Value', yFormatter = (v) => v }) {
    const W = 760, H = 300, P = 50; // Increased left padding for y-axis labels
    const values = data.map(d => d[yKey] || 0);
    const maxY = Math.max(1, ...values);
    const n = Math.max(1, Math.min(data.length, 10)); // Limit to 10 bars for better readability
    const gap = 12;
    const barW = Math.max(15, (W - 2 * P) / n - gap);

    const scaleX = (i) => P + i * (barW + gap);
    const scaleY = (v) => H - P - ((v || 0) * (H - 2 * P)) / (maxY || 1);

    // Y-axis ticks - use fewer ticks for cleaner look
    const yTicks = 4;
    const yStep = maxY / (yTicks - 1);
    const yAxisLabels = Array.from({ length: yTicks }, (_, i) => yFormatter(i * yStep));

    // Get color for each bar
    const getColor = (key) => {
        if (typeof colorMap === 'function') return colorMap(key);
        return colorMap[key] || '#2563eb';
    };

    // Format y-axis labels to be more compact
    const formatYLabel = (value) => {
        if (typeof value === 'number') {
            if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
            if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
            return value % 1 === 0 ? value.toString() : value.toFixed(1);
        }
        return value;
    };

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" style={{ width: '100%', height: 'auto' }}>
            {/* Grid lines and Y-axis */}
            <line x1={P} x2={P} y1={P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />
            <line x1={P} x2={W - P} y1={H - P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />

            {/* Y-axis labels and grid lines */}
            {yAxisLabels.map((label, i) => {
                const y = scaleY((i * yStep));
                return (
                    <React.Fragment key={`y-${i}`}>
                        <line x1={P} x2={W - P} y1={y} y2={y} className="gridline" stroke="#f0f0f0" strokeWidth="1" />
                        <text
                            x={P - 10}
                            y={y + 4}
                            textAnchor="end"
                            fontSize="10"
                            fill="#666"
                            style={{ fontFamily: 'monospace' }}
                        >
                            {formatYLabel(label)}
                        </text>
                    </React.Fragment>
                );
            })}

            {/* Bars with labels */}
            {data.slice(0, n).map((d, i) => {
                const x = scaleX(i);
                const y = scaleY(d[yKey] || 0);
                const h = H - P - y;
                const color = getColor(d[xKey]);
                const label = String(d[xKey] || '').substring(0, 12); // Truncate long labels
                const displayValue = yFormatter(d[yKey]);
                const isShortValue = String(displayValue).length <= 6; // Only show value if it's short enough

                return (
                    <g key={i}>
                        <rect
                            x={x}
                            y={y}
                            width={barW}
                            height={h}
                            fill={color}
                            rx="2"
                            ry="2"
                            className="bar"
                        />
                        {/* X-axis labels */}
                        <text
                            x={x + barW / 2}
                            y={H - P / 2}
                            textAnchor="middle"
                            fontSize="10"
                            fill="#666"
                            transform={`rotate(-45, ${x + barW / 2}, ${H - P / 2})`}
                            style={{
                                textOverflow: 'ellipsis',
                                overflow: 'hidden',
                                textTransform: 'capitalize'
                            }}
                        >
                            {label}
                        </text>
                        {/* Value labels on top of bars - only if there's enough space */}
                        {h > 20 && isShortValue && (
                            <text
                                x={x + barW / 2}
                                y={y - 5}
                                textAnchor="middle"
                                fontSize="10"
                                fontWeight="500"
                                fill="#444"
                                style={{ pointerEvents: 'none' }}
                            >
                                {displayValue}
                            </text>
                        )}
                    </g>
                );
            })}

            {/* Y-axis label */}
            <text x={-H / 2} y={20} textAnchor="middle" fontSize="11" fill="#666" transform="rotate(-90, 15, 15)" style={{ fontWeight: 500 }}>
                {yLabel}
            </text>
        </svg>
    );
}

// Donut Chart Component
// Donut Chart Component with Color Labels
function Donut({ open = 0, closed = 0, labels = ["Open", "Closed"], colors = ["#F59E0B", "#10B981"] }) {
    const total = Math.max(1, open + closed);
    const openFrac = open / total;
    const closedFrac = closed / total;
    const R = 50, C = 80; // Slightly smaller radius
    const circ = 2 * Math.PI * R;
    const strokeWidth = 14;

    // Legend items data
    const legendItems = [
        { value: open, label: labels[0], color: colors[0] },
        { value: closed, label: labels[1], color: colors[1] }
    ];

    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '180px' }}>
            <svg viewBox="0 0 200 140" className="donut" style={{ width: '100%', height: '100%' }}>
                <g transform={`translate(${C},70)`}>
                    {/* Background circle */}
                    <circle r={R} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />

                    {/* Closed segment */}
                    <circle
                        r={R}
                        fill="none"
                        stroke={colors[1]}
                        strokeWidth={strokeWidth}
                        strokeDasharray={`${circ * closedFrac} ${circ}`}
                        strokeDashoffset={circ * 0.25}
                        strokeLinecap="round"
                    />

                    {/* Open segment */}
                    <circle
                        r={R}
                        fill="none"
                        stroke={colors[0]}
                        strokeWidth={strokeWidth}
                        strokeDasharray={`${circ * openFrac} ${circ}`}
                        strokeLinecap="round"
                    />

                    {/* Center text */}
                    <text y="-5" textAnchor="middle" fontSize="16" fontWeight="600" fill="#111827">
                        {Math.round(openFrac * 100)}%
                    </text>
                    <text y="15" textAnchor="middle" fontSize="12" fill="#4b5563">
                        {labels[0]}
                    </text>
                </g>

                {/* Legend */}
                <g transform={`translate(${C + 80}, 30)`}>
                    {legendItems.map((item, i) => (
                        <g key={i} transform={`translate(0, ${i * 30})`}>
                            <rect
                                x="0"
                                y="0"
                                width="12"
                                height="12"
                                rx="2"
                                fill={item.color}
                            />
                            <text
                                x="20"
                                y="10"
                                fontSize="12"
                                fill="#374151"
                                fontWeight="500"
                            >
                                {item.label}
                            </text>
                            <text
                                x="20"
                                y="25"
                                fontSize="11"
                                fill="#6b7280"
                            >
                                {item.value} {item.value === 1 ? 'item' : 'items'}
                            </text>
                        </g>
                    ))}
                </g>
            </svg>
        </div>
    );
}

/** ---------- CSV Export ---------- **/
function exportGroceriesCSV(sections) {
    const rows = [];
    const push = (r = []) => rows.push(r.map((c) => `"${String(c ?? "").replaceAll('"', '""')}"`).join(","));

    // Enhanced metrics
    push(["Section", "Key", "Value"]);
    Object.entries(sections.metrics || {}).forEach(([k, v]) => push(["Metrics", k, v]));
    push([]);

    // Trend data
    push(["Trend", "Date", "Revenue", "Cost", "Profit", "Orders"]);
    (sections.trend || []).forEach((t) => push(["", t.date, t.revenue, t.cost, t.profit, t.orders]));
    push([]);

    // Category performance
    push(["Category Performance", "Category", "Quantity"]);
    (sections.categoryQty || []).forEach((c) => push(["", c.category, c.qty]));
    push([]);

    // Product performance
    push(["Product Performance", "Product", "Quantity", "Revenue", "Cost", "Profit", "Margin%"]);
    (sections.productPerformance || []).forEach((p) => push(["", p.product, p.qty, p.revenue, p.cost, p.profit, p.margin]));
    push([]);

    // Top clients
    push(["Top Clients", "Client", "Quantity"]);
    (sections.topClients || []).forEach((c) => push(["", c.client, c.qty]));
    push([]);

    // Top vendors
    push(["Top Vendors", "Vendor", "Spend"]);
    (sections.topVendors || []).forEach((v) => push(["", v.vendor, v.spend]));
    push([]);

    // Manufacturer quantity
    push(["Supplier Quantity", "Vendor", "Quantity"]);
    (sections.manuQty || []).forEach((m) => push(["", m.vendor, m.qty]));
    push([]);

    // Seasonal trends
    push(["Seasonal Trends", "Month", "Revenue", "Orders"]);
    (sections.seasonalTrend || []).forEach((s) => push(["", s.month, s.revenue, s.orders]));
    push([]);

    // Focus client
    if (sections.focusClient?.length) {
        push(["Focus Client Products", "Product", "Quantity"]);
        sections.focusClient.forEach((f) => push(["", f.product, f.qty]));
        push([]);
    }

    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "groceries_dashboard.csv"; a.click();
    URL.revokeObjectURL(url);
}