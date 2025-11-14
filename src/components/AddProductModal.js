// AddProductModal.js
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

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

export default function AddProductModal({ onProductAdded, onClose }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_PRODUCT);
  const [loading, setLoading] = useState(false);

  // Listen for the keyboard shortcut event
  useEffect(() => {
    const handleOpenModal = () => {
      setModalOpen(true);
      setForm(EMPTY_PRODUCT);
    };

    window.addEventListener('openAddProductModal', handleOpenModal);

    return () => {
      window.removeEventListener('openAddProductModal', handleOpenModal);
    };
  }, []);

  const closeModal = () => {
    setModalOpen(false);
    setForm(EMPTY_PRODUCT);
    if (onClose) onClose();
  };

  const handleSave = async (e) => {
    e.preventDefault();

    if (!form.name?.trim()) {
      alert("Product name is required");
      return;
    }

    setLoading(true);

    const payload = {
      ...form,
      name: form.name.trim(),
      purchase_price: form.purchase_price === "" ? null : Number(form.purchase_price),
      selling_price: form.selling_price === "" ? null : Number(form.selling_price),
      description: form.description?.trim() || null,
      hsn_sac: form.hsn_sac?.trim() || null,
      category: form.category || null,
    };

    try {
      const { data, error } = await supabase
        .from("products")
        .insert([payload])
        .select();

      if (error) {
        throw error;
      }

      if (onProductAdded) {
        onProductAdded(data[0]);
      }

      closeModal();
      alert("Product added successfully!");

    } catch (error) {
      console.error("Error adding product:", error);
      alert("Failed to add product. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const clearForm = () => {
    setForm(EMPTY_PRODUCT);
  };

  const countFilledFields = () => {
    return Object.values(form).filter(value =>
      value !== null && value !== undefined && value !== '' && value !== false
    ).length;
  };

  const showClearButton = countFilledFields() > 2;

  if (!modalOpen) return null;

  return (
    <div className="modal" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    }}>
      <div className="modal-card modal-card--lg" >
        <div className="modal-head">
          <h2 className="modal-title">
            Add Product
          </h2>
          <button
            className="btn icon"
            onClick={closeModal}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSave}>
          <div className="details-grid">
            <div className="details-col">
              <DetailRow
                label="Product Name"
                edit={true}
                value={form.name}
                onChange={(v) => setForm({ ...form, name: v })}
                required
              />
              <DetailRow
                label="Purchase Price (₹)"
                edit={true}
                type="number"
                value={form.purchase_price}
                onChange={(v) => setForm({ ...form, purchase_price: v })}
              />
              <DetailRow
                label="Selling Price (₹)"
                edit={true}
                type="number"
                value={form.selling_price}
                onChange={(v) => setForm({ ...form, selling_price: v })}
              />
              <DetailRow
                label="HSN/SAC"
                edit={true}
                value={form.hsn_sac}
                onChange={(v) => setForm({ ...form, hsn_sac: v })}
              />
            </div>

            <div className="details-col">
              <DetailRow
                label="Tax Rate"
                edit={true}
                type="select"
                options={TAX_OPTIONS}
                value={form.tax_rate}
                onChange={(v) => setForm({ ...form, tax_rate: v })}
              />
              <DetailRow
                label="Units"
                edit={true}
                type="select"
                options={UNIT_OPTIONS}
                value={form.unit}
                onChange={(v) => setForm({ ...form, unit: v })}
              />
              <DetailRow
                label="Category"
                edit={true}
                type="select"
                options={CATEGORY_OPTIONS}
                value={form.category}
                onChange={(v) => setForm({ ...form, category: v })}
              />
              <DetailRow
                label="Description"
                edit={true}
                type="textarea"
                value={form.description}
                onChange={(v) => setForm({ ...form, description: v })}
              />
            </div>
          </div>

          <div className="modal-actions between">
            {showClearButton && (
              <button
                type="button"
                className="btn ghost modal-btn danger width-100"
                onClick={clearForm}
                style={{ fontSize: "0.875rem" }}
              >
                Clear All
              </button>
            )}

            <button
              type="button"
              className="btn modal-btn"
              onClick={closeModal}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn primary modal-btn"
              disabled={loading}
            >
              {loading ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DetailRow({ label, edit, type = "text", value, options, onChange, required = false }) {
  return (
    <div className="detail-row">
      <div className="detail-label">
        {label}{required ? " *" : ""}
      </div>
      {edit ? (
        type === "textarea" ? (
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
        )
      ) : (
        <div className="detail-value" >
          {value ? String(value) : <span style={{ color: '#6b7280' }}>-</span>}
        </div>
      )}
    </div>
  );
}