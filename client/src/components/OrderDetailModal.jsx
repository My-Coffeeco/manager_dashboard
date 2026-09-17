import React, { useState } from 'react';
import { X, CheckCircle } from 'lucide-react';

export function OrderDetailModal({ order, onClose, onStatusUpdated, setMessage }) {
  if (!order) return null;

  const [status, setStatus] = useState(order.status || 'paid');
  const [loading, setLoading] = useState(false);

  const money = (v) =>
    v == null ? '₹0.00' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(v / 100);

  const handleUpdateStatus = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await fetch('/admin/orders/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: order.id, status })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to update order status');

      setMessage(`Order ${order.id} status updated to ${status}${data.shopify_synced ? ' (Synced with Shopify)' : ''}`);
      onStatusUpdated();
      onClose();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Order details</h2>
          <button className="btn-secondary" style={{ padding: '6px 12px' }} onClick={onClose}>
            <X size={16} /> Close
          </button>
        </div>

        <div className="modal-body">
          <p><strong>Order ID:</strong> {order.id}</p>
          <p><strong>Customer:</strong> {order.customer || 'Guest'}</p>
          <p><strong>Current Status:</strong> {(order.status || '').replaceAll('_', ' ')}</p>
          <p><strong>Total Amount:</strong> {money(order.amount_paise)}</p>

          <form onSubmit={handleUpdateStatus} className="status-update-section">
            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label htmlFor="status-select">Change Order Status</label>
              <select
                id="status-select"
                className="select-input"
                style={{ width: '100%' }}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="paid">Awaiting pack (Paid)</option>
                <option value="payment_pending">Payment pending</option>
                <option value="shipped">In transit / Shipped</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
              <CheckCircle size={16} />
              {loading ? 'Updating...' : 'Update status'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
