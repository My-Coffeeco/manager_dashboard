import React, { useState } from 'react';

export function OrderQueue({ orders, onSelectOrder }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  if (!orders) {
    return <p className="quiet">Your role does not have order access.</p>;
  }

  if (!orders.length) {
    return <p className="quiet">No orders received yet.</p>;
  }

  const filteredOrders = orders.filter((o) => {
    const matchesStatus = statusFilter === 'all' || o.status === statusFilter;
    const matchesSearch = ((o.id || '') + ' ' + (o.customer || '')).toLowerCase().includes(search.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const getBadgeClass = (status) => {
    switch (status) {
      case 'shipped': return 'badge shipped';
      case 'delivered': return 'badge delivered';
      case 'cancelled': return 'badge cancelled';
      case 'payment_pending': return 'badge payment_pending';
      default: return 'badge';
    }
  };

  const statusLabels = {
    paid: 'Awaiting pack',
    payment_pending: 'Payment pending',
    shipped: 'In transit',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
  };

  return (
    <div>
      <div className="queue-tools">
        <input
          type="search"
          className="search-input"
          placeholder="Search order or customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="select-input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="paid">Awaiting pack</option>
          <option value="payment_pending">Payment pending</option>
          <option value="shipped">In transit</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="row-list">
        {!filteredOrders.length ? (
          <p className="quiet" style={{ padding: '16px 0' }}>No orders match this view.</p>
        ) : (
          filteredOrders.map((o) => (
            <div key={o.id} className="data-row">
              <div>
                <strong>{o.id}</strong>
                <p>{o.customer || 'Guest'}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className={getBadgeClass(o.status)}>
                  {statusLabels[o.status] || (o.status || '').replaceAll('_', ' ')}
                </span>
                <button
                  className="btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '13px' }}
                  onClick={() => onSelectOrder(o)}
                >
                  View →
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
