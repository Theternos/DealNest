// packagesDashboard.js
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
const PARTNERS = ["Kavin", "Vicky"];

/** Enhanced product name parsing **/
function parseNameMeta(name = "") {
  const out = {
    side: "Unknown",
    colour: "Unknown",
    size: "Unknown",
    base: "",
    type: "",
    dimensions: "",
    area: 0
  };

  const lower = name.toLowerCase();

  // Base type
  out.base = lower.includes("parcel") ? "Parcel" : "Cover";

  // Side detection
  if (lower.includes("non-printed")) {
    out.side = "Non-Printed";
    out.colour = "None";
    out.type = "Non-Printed";
  } else {
    if (lower.includes("double side")) out.side = "Double";
    else if (lower.includes("single side")) out.side = "Single";
    else out.side = "Unknown";

    // Colour detection
    if (lower.includes("tri colour") || lower.includes("tri color")) out.colour = "Tri";
    else if (lower.includes("double colour") || lower.includes("double color")) out.colour = "Double";
    else if (lower.includes("single colour") || lower.includes("single color")) out.colour = "Single";
    else if (out.side === "Unknown") out.colour = "Unknown";

    out.type = `${out.side} | ${out.colour}`;
  }

  // Size and dimensions
  const sizeMatch = name.match(/(\d+)\s*x\s*(\d+)/i);
  if (sizeMatch) {
    const width = parseInt(sizeMatch[1]);
    const height = parseInt(sizeMatch[2]);
    out.dimensions = `${width}x${height}`;
    out.size = out.dimensions;
    out.area = width * height; // Calculate area for insights
  }

  return out;
}

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

export default function PackagesDashboard() {
  const [preset, setPreset] = useState("This Month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [focusClientId, setFocusClientId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Enhanced data states
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
    investTotal: 0,
    roi: 0,
    efficiency: 0,
    profitMargin: 0
  });

  const [trend, setTrend] = useState([]);
  const [typeQty, setTypeQty] = useState([]);
  const [sizeQty, setSizeQty] = useState([]);
  const [manuQty, setManuQty] = useState([]);
  const [statusDist, setStatusDist] = useState({ open: 0, closed: 0 });
  const [deliveryDist, setDeliveryDist] = useState({ delivered: 0, pending: 0 });
  const [topClients, setTopClients] = useState([]);
  const [focusSize, setFocusSize] = useState([]);
  const [focusType, setFocusType] = useState([]);
  const [sizeVendorMix, setSizeVendorMix] = useState([]);
  const [clientsList, setClientsList] = useState([]);
  const [investSplit, setInvestSplit] = useState([]);

  // New enhanced data
  const [productPerformance, setProductPerformance] = useState([]);
  const [seasonalTrend, setSeasonalTrend] = useState([]);
  const [clientRetention, setClientRetention] = useState([]);
  const [sizeEfficiency, setSizeEfficiency] = useState([]);
  const [colourPerformance, setColourPerformance] = useState([]);
  const [sidePerformance, setSidePerformance] = useState([]);

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
        // --- PRODUCTS (Packages) ---
        const { data: products, error: eProd } = await supabase
          .from("products")
          .select("id,name,purchase_price,selling_price,category,active")
          .eq("category", "Packages")
          .eq("active", true)
          .limit(10000);
        if (eProd) throw eProd;

        const pkgIds = (products || []).map((p) => p.id);
        const idToProd = new Map((products || []).map((p) => [p.id, p]));
        const metaByProd = new Map((products || []).map((p) => [p.id, parseNameMeta(p.name)]));

        if (!pkgIds.length) {
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
            .in("product_id", pkgIds)
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
            .in("product_id", pkgIds)
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

        // --- Investments ---
        let investTotal = 0;
        let investSplitArr = [];
        {
          const { data, error } = await supabase.from("investments").select("name,amount").limit(50000);
          if (error) throw error;
          investTotal = sum((data || []).map((r) => +r.amount || 0));
          const byName = new Map();
          (data || []).forEach((r) => {
            const key = r.name || "(Unspecified)";
            byName.set(key, (byName.get(key) || 0) + (+r.amount || 0));
          });
          investSplitArr = Array.from(byName.entries()).map(([name, amount]) => ({ name, amount }));
        }

        // ---------- Enhanced Calculations ----------
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

        // Enhanced breakdowns
        const typeMap = new Map();
        const sizeMap = new Map();
        const colourMap = new Map();
        const sideMap = new Map();
        const clientQty = new Map();
        const productPerf = new Map();

        sItems.forEach((i) => {
          const m = metaByProd.get(i.product_id) || {};
          const t = `${m.side || "Unknown"} | ${m.colour || "Unknown"}`;
          const revenue = +i.quantity * +i.unit_price;
          const cost = +i.quantity * (prodCostMap.get(i.product_id) ?? +i.unit_price ?? 0);
          const profit = revenue - cost;

          // Type breakdown
          typeMap.set(t, (typeMap.get(t) || 0) + (+i.quantity || 0));

          // Size breakdown
          sizeMap.set(m.size || "Unknown", (sizeMap.get(m.size || "Unknown") || 0) + (+i.quantity || 0));

          // Colour breakdown
          colourMap.set(m.colour || "Unknown", (colourMap.get(m.colour || "Unknown") || 0) + (+i.quantity || 0));

          // Side breakdown
          sideMap.set(m.side || "Unknown", (sideMap.get(m.side || "Unknown") || 0) + (+i.quantity || 0));

          // Client breakdown
          const cName = clientsMap.get(sales.find((s) => s.id === i.sale_id)?.client_id) || "(Unknown)";
          clientQty.set(cName, (clientQty.get(cName) || 0) + (+i.quantity || 0));

          // Product performance
          const prodName = idToProd.get(i.product_id)?.name || "Unknown";
          const current = productPerf.get(prodName) || { qty: 0, revenue: 0, cost: 0, profit: 0 };
          current.qty += +i.quantity;
          current.revenue += revenue;
          current.cost += cost;
          current.profit += profit;
          productPerf.set(prodName, current);
        });

        const typeQtyArr = Array.from(typeMap.entries()).map(([type, qty]) => ({ type, qty })).sort((a, b) => b.qty - a.qty);
        const sizeQtyArr = Array.from(sizeMap.entries()).map(([size, qty]) => ({ size, qty })).sort((a, b) => b.qty - a.qty);
        const colourPerfArr = Array.from(colourMap.entries()).map(([colour, qty]) => ({ colour, qty })).sort((a, b) => b.qty - a.qty);
        const sidePerfArr = Array.from(sideMap.entries()).map(([side, qty]) => ({ side, qty })).sort((a, b) => b.qty - a.qty);
        const topClientsArr = Array.from(clientQty.entries()).map(([client, qty]) => ({ client, qty })).sort((a, b) => b.qty - a.qty).slice(0, 10);
        const productPerfArr = Array.from(productPerf.entries()).map(([product, data]) => ({
          product,
          ...data,
          margin: data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0
        })).sort((a, b) => b.profit - a.profit).slice(0, 15);

        // Manufacturer-wise qty
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

        // Focus client breakdowns
        let focusSizeArr = [];
        let focusTypeArr = [];
        if (focusClientId) {
          const saleIdsForClient = sales.filter((s) => s.client_id === focusClientId).map((s) => s.id);
          const sizeMapF = new Map();
          const typeMapF = new Map();
          sItems.filter((i) => saleIdsForClient.includes(i.sale_id)).forEach((i) => {
            const m = metaByProd.get(i.product_id) || {};
            sizeMapF.set(m.size || "Unknown", (sizeMapF.get(m.size || "Unknown") || 0) + (+i.quantity || 0));
            const t = `${m.side || "Unknown"} | ${m.colour || "Unknown"}`;
            typeMapF.set(t, (typeMapF.get(t) || 0) + (+i.quantity || 0));
          });
          focusSizeArr = Array.from(sizeMapF.entries()).map(([size, qty]) => ({ size, qty })).sort((a, b) => b.qty - a.qty);
          focusTypeArr = Array.from(typeMapF.entries()).map(([type, qty]) => ({ type, qty })).sort((a, b) => b.qty - a.qty);
        }

        // Size → Manufacturer Mix
        const bySizeVendor = new Map();
        pItems.forEach((pi) => {
          const vendorName = vendorMap.get(purchases.find((p) => p.id === pi.purchase_id)?.vendor_id) || "(Unknown)";
          const m = metaByProd.get(pi.product_id) || {};
          const size = m.size || "Unknown";
          const inner = bySizeVendor.get(size) || new Map();
          inner.set(vendorName, (inner.get(vendorName) || 0) + (+pi.quantity || 0));
          bySizeVendor.set(size, inner);
        });
        const topSizes = Array.from(bySizeVendor.entries())
          .map(([size, mp]) => ({ size, qty: sum(Array.from(mp.values())) }))
          .sort((a, b) => b.qty - a.qty)
          .slice(0, 5)
          .map((s) => s.size);
        const sizeVendorMixArr = [];
        topSizes.forEach((size) => {
          const mp = bySizeVendor.get(size) || new Map();
          Array.from(mp.entries()).forEach(([vendor, qty]) => {
            sizeVendorMixArr.push({ size, vendor, qty });
          });
        });

        // Size efficiency (profit per area)
        const sizeEfficiencyMap = new Map();
        sItems.forEach((i) => {
          const m = metaByProd.get(i.product_id) || {};
          const size = m.size || "Unknown";
          const profit = (+i.quantity * +i.unit_price) - (+i.quantity * (prodCostMap.get(i.product_id) ?? +i.unit_price ?? 0));
          const current = sizeEfficiencyMap.get(size) || { qty: 0, profit: 0, area: m.area || 1 };
          current.qty += +i.quantity;
          current.profit += profit;
          sizeEfficiencyMap.set(size, current);
        });
        const sizeEfficiencyArr = Array.from(sizeEfficiencyMap.entries()).map(([size, data]) => ({
          size,
          efficiency: data.area > 0 ? (data.profit / data.area) : 0,
          profitPerKg: data.qty > 0 ? (data.profit / data.qty) : 0
        })).sort((a, b) => b.efficiency - a.efficiency);

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
          investTotal,
          ...efficiencyMetrics
        });

        setTrend(trendArr);
        setTypeQty(typeQtyArr);
        setSizeQty(sizeQtyArr);
        setManuQty(manuQtyArr);
        setStatusDist(status);
        setDeliveryDist(delivery);
        setTopClients(topClientsArr);
        setFocusSize(focusSizeArr);
        setFocusType(focusTypeArr);
        setSizeVendorMix(sizeVendorMixArr);
        setInvestSplit(investSplitArr);
        setProductPerformance(productPerfArr);
        setSeasonalTrend(seasonalTrendArr);
        setColourPerformance(colourPerfArr);
        setSidePerformance(sidePerfArr);
        setSizeEfficiency(sizeEfficiencyArr);

      } catch (e) {
        console.error(e);
        if (!active) return;
        setError(e?.message || "Failed to load Packages Dashboard");
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
      avgSell: 0, avgCost: 0, avgMarginPct: 0, investTotal: 0, roi: 0, efficiency: 0, profitMargin: 0
    });
    setTrend([]); setTypeQty([]); setSizeQty([]); setManuQty([]);
    setStatusDist({ open: 0, closed: 0 }); setDeliveryDist({ delivered: 0, pending: 0 });
    setTopClients([]); setFocusSize([]); setFocusType([]); setSizeVendorMix([]);
    setClientsList([]); setInvestSplit([]); setProductPerformance([]);
    setSeasonalTrend([]); setColourPerformance([]); setSidePerformance([]); setSizeEfficiency([]);
  };

  const partnerSplit = useMemo(() => {
    const share = Math.max(0, metrics.profit) / PARTNERS.length;
    return PARTNERS.map((n) => ({ name: n, amount: share }));
  }, [metrics.profit]);

  return (

    <div className="wrap">
      {/* Enhanced Toolbar */}
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

      {/* Enhanced KPIs */}
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <EnhancedKPIGrid metrics={metrics} partnerSplit={partnerSplit} investSplit={investSplit} />
      </div>

      {/* Main Performance Charts */}
      <div className="grid summary-grid">
        <div className="card" style={{ padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>📊 Performance Overview</h3>
          <ComboChart data={trend} />
        </div>
        <div className="card" style={{ padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>📈 Profit & Margin Trend</h3>
          <ProfitMarginChart data={trend} />
        </div>
      </div>

      {/* Product Insights */}
      <div className="grid summary-grid" style={{ marginTop: 12 }}>
        <div className="card" style={{ padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>📦 Size Efficiency Analysis</h3>
          <SizeEfficiencyChart data={sizeEfficiency} />
        </div>
        <div className="card" style={{ padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>🏭 Supplier Performance</h3>
          <SupplierChart data={manuQty} />
        </div>
        <div className="card" style={{ padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>🎨 Colour Performance</h3>
          <ColourChart data={colourPerformance} />
        </div>
        <div className="card" style={{ padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>🔄 Side Performance</h3>
          <SideChart data={sidePerformance} />
        </div>
      </div>

      {/* Client & Seasonal Analysis */}
      <div className="grid summary-grid" style={{ marginTop: 12 }}>
        <div className="card" style={{ padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>📅 Seasonal Trends</h3>
          <SeasonalChart data={seasonalTrend} />
        </div>
        <div className="card" style={{ padding: 12 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>👑 Top Clients</h3>
          <ClientChart data={topClients} />
        </div>
      </div>

      {/* Focus Client Analysis */}
      <div className="card summary-card" style={{ padding: 12, marginTop: 12 }}>
        <div className="parties-toolbar" style={{ marginTop: 0 }}>
          <div className="parties-toolbar__group">
            <label className="lbl-text">Focus Client Analysis</label>
            <select className="input" value={focusClientId} onChange={(e) => setFocusClientId(e.target.value)}>
              <option value="">(Select Client)</option>
              {clientsList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        {focusClientId ? (
          <div className="grid summary-grid" style={{ marginTop: 12 }}>
            <div className="card" style={{ padding: 12 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>📐 Client Size Preference</h3>
              <BarChart data={focusSize} xKey="size" yKey="qty" />
            </div>
            <div className="card" style={{ padding: 12 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>🎨 Client Type Preference</h3>
              <BarChart data={focusType} xKey="type" yKey="qty" />
            </div>
          </div>
        ) : (
          <div className="muted" style={{ marginTop: 8, textAlign: 'center', padding: '20px' }}>
            Select a client to view detailed purchasing patterns and preferences
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="card summary-card" style={{ padding: 12, marginTop: 12 }}>
          <div className="muted" style={{ textAlign: 'center' }}>Loading Business Intelligence Dashboard...</div>
        </div>
      )}

      {/* Scoped styles */}
      <style>{`
        .kpi-grid { display:grid; grid-template-columns: 1fr; gap:10px; }
        @media (min-width:640px){ .kpi-grid{ grid-template-columns: repeat(3,1fr); } }
        @media (min-width:1024px){ .kpi-grid{ grid-template-columns: repeat(4,1fr); } }
        @media (min-width:1280px){ .kpi-grid{ grid-template-columns: repeat(4,1fr); } }
        
        .kpi { border:1px solid var(--border); border-radius:12px; padding:12px; background:#fff; position:relative; overflow:hidden; }
        .kpi::before { content:''; position:absolute; top:0; left:0; right:0; height:3px; background:linear(90deg, #2563eb, #10B981); }
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
        .combo-line { fill:none; stroke:#2563eb; stroke-width:2; }
        .combo-bar { fill:rgba(37,99,235,.15); }
        .profit-line { fill:none; stroke:#10B981; stroke-width:2; }
        .margin-line { fill:none; stroke:#8b5cf6; stroke-width:2; stroke-dasharray:4,4; }
        .gridline { stroke:#e5e7eb; stroke-width:1; }
        .bar { fill:rgba(37,99,235,.85); }
        .bar:hover { opacity:.9; }
        .stack-cat { opacity:.9; }
        
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

/** ---------- Enhanced KPI Grid ---------- **/
function EnhancedKPIGrid({ metrics, partnerSplit, investSplit }) {
  const getTrendIndicator = (value, isPositive = true) => {
    if (value > 0) return <span className={`trend-indicator ${isPositive ? 'trend-up' : 'trend-down'}`}>↗</span>;
    if (value < 0) return <span className={`trend-indicator ${isPositive ? 'trend-down' : 'trend-up'}`}>↘</span>;
    return <span className="trend-indicator trend-neutral">→</span>;
  };

  return (
    <div className="kpi-grid">
      <div className="kpi">
        <h4>📦 Total Orders</h4>
        <div className="big">{metrics.orders || 0}</div>
        <div className="sub">Count {getTrendIndicator(metrics.orders)}</div>
      </div>

      <div className="kpi">
        <h4>⚖️ Total Quantity</h4>
        <div className="big">{fmtQty(metrics.qtyKg)}</div>
        <div className="sub">Kg {getTrendIndicator(metrics.qtyKg)}</div>
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
        <h4>📊 Avg Price/Kg</h4>
        <div className="big">{`${fmtINR(metrics.avgSell)} | ${fmtINR(metrics.avgCost)}`}</div>
        <div className="sub">Sell | Cost | {metrics.avgMarginPct?.toFixed(1)}%</div>
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
        <h4>🤝 Profit Split</h4>
        <div className="pill">Kavin: <b>{fmtINR(partnerSplit[0]?.amount || 0)}</b></div>
        <div className="pill" style={{ marginLeft: 8 }}>Vicky: <b>{fmtINR(partnerSplit[1]?.amount || 0)}</b></div>
      </div>

      <div className="kpi">
        <h4>💼 Total Investment</h4>
        <div className="big">{fmtINR(metrics.investTotal)}</div>
        <div className="sub">Capital Invested</div>
      </div>

      <div className="kpi">
        <h4>💼 Investment Split</h4>
        <div className="sub">
          {investSplit?.length
            ? investSplit.map((r) => <div key={r.name} className="pill pill--neutral" style={{ margin: "4px 6px 0 0" }}>{r.name}: <b>{fmtINR(r.amount)}</b></div>)
            : <span className="muted">(No entries)</span>}
        </div>
      </div>
    </div>
  );
}

/** ---------- Enhanced Charts ---------- **/

// Combo Chart (Revenue + Orders)
function ComboChart({ data }) {
  const W = 760, H = 260, P = 30;
  const revenues = data.map(d => d.revenue || 0);
  const orders = data.map(d => d.orders || 0);
  const maxRevenue = Math.max(1, ...revenues);
  const maxOrders = Math.max(1, ...orders);

  const scaleX = (i) => P + (i * (W - 2 * P)) / Math.max(1, data.length - 1);
  const scaleYRevenue = (v) => H - P - ((v || 0) * (H - 2 * P)) / (maxRevenue || 1);
  const scaleYOrders = (v) => H - P - ((v || 0) * (H - 2 * P)) / (maxOrders || 1);

  const revenuePath = data.map((d, i) => `${i ? "L" : "M"}${scaleX(i)},${scaleYRevenue(d.revenue || 0)}`).join(" ");
  const orderBars = data.map((d, i) => {
    const x = scaleX(i) - 10;
    const y = scaleYOrders(d.orders || 0);
    const h = H - P - y;
    return { x, y, w: 20, h };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      <line x1={P} x2={W - P} y1={H - P} y2={H - P} className="gridline" />
      <line x1={P} x2={P} y1={P} y2={H - P} className="gridline" />

      {/* Order Bars */}
      {orderBars.map((bar, i) => (
        <rect key={i} x={bar.x} y={bar.y} width={bar.w} height={bar.h} className="combo-bar" />
      ))}

      {/* Revenue Line */}
      <path d={revenuePath} className="combo-line" />

      <g>
        <circle cx={P + 6} cy={P - 10} r={4} fill="#2563eb" />
        <text x={P + 14} y={P - 6} fontSize="12">Revenue</text>
        <rect x={P + 80} y={P - 14} width={16} height={8} fill="rgba(37,99,235,.15)" />
        <text x={P + 100} y={P - 6} fontSize="12">Orders</text>
      </g>
    </svg>
  );
}

// Profit Margin Chart
function ProfitMarginChart({ data }) {
  const W = 760, H = 260, P = 30;
  const profits = data.map(d => d.profit || 0);
  const margins = data.map(d => d.revenue ? ((d.profit || 0) / d.revenue) * 100 : 0);

  const maxProfit = Math.max(1, ...profits);
  const maxMargin = Math.max(1, ...margins);

  const scaleX = (i) => P + (i * (W - 2 * P)) / Math.max(1, data.length - 1);
  const scaleYProfit = (v) => H - P - ((v || 0) * (H - 2 * P)) / (maxProfit || 1);
  const scaleYMargin = (v) => H - P - ((v || 0) * (H - 2 * P)) / (maxMargin || 1);

  const profitPath = data.map((d, i) => `${i ? "L" : "M"}${scaleX(i)},${scaleYProfit(d.profit || 0)}`).join(" ");
  const marginPath = data.map((d, i) => `${i ? "L" : "M"}${scaleX(i)},${scaleYMargin(margins[i] || 0)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      <line x1={P} x2={W - P} y1={H - P} y2={H - P} className="gridline" />
      <path d={profitPath} className="profit-line" />
      <path d={marginPath} className="margin-line" />

      <g>
        <circle cx={P + 6} cy={P - 10} r={4} fill="#10B981" />
        <text x={P + 14} y={P - 6} fontSize="12">Profit (₹)</text>
        <circle cx={P + 100} cy={P - 10} r={4} fill="#8b5cf6" />
        <text x={P + 108} y={P - 6} fontSize="12">Margin (%)</text>
      </g>
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

  // Y-axis labels
  const yTicks = 5;
  const yStep = maxProfit / (yTicks - 1);
  const yAxisLabels = Array.from({ length: yTicks }, (_, i) => Math.floor(i * yStep));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" style={{ width: '100%', height: 'auto' }}>
      {/* X and Y axis */}
      <line x1={P} x2={W - P} y1={H - P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />
      <line x1={P} x2={P} y1={P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />

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

      {/* Bars with labels */}
      {data.slice(0, n).map((d, i) => {
        const x = scaleX(i);
        const y = scaleY(d.profit);
        const h = H - P - y;
        const color = d.profit > 0 ? "#10B981" : "#EF4444";
        const label = d.product ? String(d.product).substring(0, 10) : ''; // Truncate long names

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

      {/* Title */}
      <text x={W / 2} y={20} textAnchor="middle" fontSize="14" fontWeight="600" fill="#333">
        Profit by Product (Top {n})
      </text>
    </svg>
  );
}

// Size Efficiency Chart
function SizeEfficiencyChart({ data }) {
  const W = 760, H = 300, P = 40; // Increased height for labels
  const efficiencies = data.map(d => d.efficiency || 0);
  const maxEff = Math.max(1, ...efficiencies);
  const n = Math.min(10, data.length);
  const gap = 12;
  const barW = Math.max(15, (W - 2 * P) / n - gap);

  const scaleX = (i) => P + i * (barW + gap);
  const scaleY = (v) => H - P - ((v || 0) * (H - 2 * P)) / (maxEff || 1);

  // Y-axis labels
  const yTicks = 5;
  const yStep = maxEff / (yTicks - 1);
  const yAxisLabels = Array.from({ length: yTicks }, (_, i) => (i * yStep).toFixed(1));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" style={{ width: '100%', height: "100%" }}>
      {/* X and Y axis */}
      <line x1={P} x2={W - P} y1={H - P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />
      <line x1={P} x2={P} y1={P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />

      {/* Y-axis labels and grid lines */}
      {yAxisLabels.map((value, i) => {
        const y = scaleY(parseFloat(value));
        return (
          <React.Fragment key={`y-${i}`}>
            <line x1={P} x2={W - P} y1={y} y2={y} className="gridline" stroke="#f0f0f0" strokeWidth="1" />
            <text x={P - 8} y={y + 4} textAnchor="end" fontSize="12" fill="#666">
              {value}
            </text>
          </React.Fragment>
        );
      })}

      {/* Bars with labels */}
      {data.slice(0, n).map((d, i) => {
        const x = scaleX(i);
        const y = scaleY(d.efficiency || 0);
        const h = H - P - y;
        const color = d.efficiency > 0 ? "#8b5cf6" : "#6B7280";
        const label = d.size || 'N/A';
        const value = (d.efficiency || 0).toFixed(1);

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
                {value}
              </text>
            )}
          </g>
        );
      })}

      {/* Title and Y-axis label */}
      <text x={W / 2} y={20} textAnchor="middle" fontSize="14" fontWeight="600" fill="#333">
        Profit per Square Foot by Size
      </text>
      <text
        x={-H / 2}
        y={10}
        textAnchor="middle"
        fontSize="12"
        fill="#666"
        transform="rotate(-90, 10, 10)"
      >
        Profit per SqFt (₹)
      </text>
    </svg>
  );
}

// Supplier Performance Chart
function SupplierChart({ data }) {
  return <BarChart data={data.slice(0, 8)} xKey="vendor" yKey="qty" />;
}

// Colour Performance Chart
function ColourChart({ data }) {
  const colorMap = {
    "Single": "#3B82F6",
    "Double": "#8B5CF6",
    "Tri": "#EC4899",
    "None": "#6B7280",
    "Unknown": "#9CA3AF"
  };

  return <BarChart data={data} xKey="colour" yKey="qty" colorMap={colorMap} />;
}

// Side Performance Chart
function SideChart({ data }) {
  const colorMap = {
    "Single": "#10B981",
    "Double": "#F59E0B",
    "Non-Printed": "#6B7280",
    "Unknown": "#9CA3AF"
  };

  return <BarChart data={data} xKey="side" yKey="qty" colorMap={colorMap} />;
}

// Seasonal Trends Chart
function SeasonalChart({ data }) {
  return <BarChart data={data} xKey="month" yKey="revenue" />;
}

// Client Chart
function ClientChart({ data }) {
  return <BarChart data={data.slice(0, 8)} xKey="client" yKey="qty" />;
}

// Base Bar Chart Component
function BarChart({ data, xKey, yKey, colorMap = {} }) {
  const W = 500, H = 300, P = 40; // Increased height and padding for better labels
  const maxY = Math.max(1, ...data.map((d) => d[yKey] || 0));
  const n = Math.max(1, data.length);
  const gap = 12; // Increased gap between bars
  const barW = Math.max(15, (W - 2 * P) / n - gap);
  const scaleX = (i) => P + i * (barW + gap);
  const scaleY = (v) => H - P - ((v || 0) * (H - 2 * P)) / (maxY || 1);

  const getColor = (key) => colorMap[key] || "#2563eb";

  // Calculate Y-axis labels
  const yTicks = 5;
  const yStep = maxY / (yTicks - 1);
  const yAxisLabels = Array.from({ length: yTicks }, (_, i) => Math.floor(i * yStep));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" style={{ width: '100%', height: 'auto' }}>
      {/* X and Y axis */}
      <line x1={P} x2={W - P} y1={H - P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />
      <line x1={P} x2={P} y1={P} y2={H - P} className="gridline" stroke="#e0e0e0" strokeWidth="1" />

      {/* Y-axis labels and grid lines */}
      {yAxisLabels.map((value, i) => {
        const y = scaleY(value);
        return (
          <React.Fragment key={`y-${i}`}>
            <line x1={P} x2={W - P} y1={y} y2={y} className="gridline" stroke="#f0f0f0" strokeWidth="1" />
            <text x={P - 8} y={y + 4} textAnchor="end" fontSize="12" fill="#666">
              {Math.round(value).toLocaleString()}
            </text>
          </React.Fragment>
        );
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const x = scaleX(i);
        const y = scaleY(d[yKey]);
        const h = H - P - y;
        const label = String(d[xKey]).substring(0, 10); // Truncate long labels
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              fill={getColor(d[xKey])}
              className="bar"
              rx="2"
              ry="2"
            />
            {/* X-axis labels */}
            <text
              x={x + barW / 2}
              y={H - P / 2}
              textAnchor="middle"
              fontSize="12"
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
                {d[yKey].toLocaleString()}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
