// App.js
import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { getSession } from "./components/login";

// pages
import Products from "./components/products";
import Inventory from "./components/inventory";
import Purchases from "./components/purchases";
import Sales from "./components/sales";
import Ledger from "./components/ledger";
import Parties from "./components/parties";
import Investments from "./components/investments";
import Orders from "./components/orders";
import Login from "./components/login";
import Dashboard from "./components/dashboard";
import "./App.css";


// Protected route component
function ProtectedRoute({ children, allowedRoles = [] }) {
  const location = useLocation();
  const session = getSession();
  
  // If no session, redirect to login
  if (!session?.loggedIn) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  
  // If role is specified and user doesn't have it, redirect to home
  if (allowedRoles.length > 0 && !allowedRoles.includes(session.role)) {
    return <Navigate to="/sales" replace />;
  }
  
  return children;
}

// Role-based route component
function RoleBasedRoute({ children }) {
  const session = getSession();
  
  // For sales users, redirect to /sales
  if (session?.role === 'sales') {
    return <Navigate to="/sales" replace />;
  }
  
  // For other users, show the requested page
  return children;
}


export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/" element={
          <RoleBasedRoute>
            <Navigate to="/dashboard" replace />
          </RoleBasedRoute>
        } />
        
        <Route path="/dashboard" element={
          <ProtectedRoute allowedRoles={['admin', 'manager']}>
            <Dashboard />
          </ProtectedRoute>
        } />
        
        <Route path="/products" element={
          <ProtectedRoute>
            <Products />
          </ProtectedRoute>
        } />
        
        <Route path="/inventory" element={
          <ProtectedRoute>
            <Inventory />
          </ProtectedRoute>
        } />
        
        <Route path="/purchases" element={
          <ProtectedRoute allowedRoles={['admin', 'manager']}>
            <Purchases />
          </ProtectedRoute>
        } />
        
        <Route path="/sales" element={
          <ProtectedRoute>
            <Sales />
          </ProtectedRoute>
        } />
        
        <Route path="/ledger" element={
          <ProtectedRoute>
            <Ledger />
          </ProtectedRoute>
        } />
        
        <Route path="/parties" element={
          <ProtectedRoute>
            <Parties />
          </ProtectedRoute>
        } />
        
        <Route path="/investments" element={
          <ProtectedRoute allowedRoles={['admin', 'manager']}>
            <Investments />
          </ProtectedRoute>
        } />
        
        <Route path="/orders" element={
          <ProtectedRoute>
            <Orders />
          </ProtectedRoute>
        } />
        
        <Route path="*" element={<div style={{ padding: 24 }}>Not Found</div>} />
      </Routes>
    </BrowserRouter>
  );
}
