import React from 'react';

export function AlertsList({ alerts, onMarkRead, setMessage }) {
  if (!alerts) {
    return <p className="quiet">Your role does not have access.</p>;
  }

  if (!alerts.length) {
    return <p className="quiet">No alerts received yet.</p>;
  }

  const handleRead = async (id) => {
    try {
      const r = await fetch('/admin/alerts/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to mark alert read');
      onMarkRead();
    } catch (err) {
      setMessage(err.message);
    }
  };

  return (
    <div className="row-list">
      {alerts.map((a) => (
        <div key={a.id} className="data-row">
          <span>{a.message}</span>
          <button
            className="btn-secondary"
            style={{ padding: '6px 12px', fontSize: '13px' }}
            onClick={() => handleRead(a.id)}
          >
            Mark read
          </button>
        </div>
      ))}
    </div>
  );
}
