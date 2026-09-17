import React from 'react';

export function InquiriesList({ inquiries }) {
  if (!inquiries) {
    return <p className="quiet">Your role does not have access.</p>;
  }

  if (!inquiries.length) {
    return <p className="quiet">No records received yet.</p>;
  }

  return (
    <div className="row-list">
      {inquiries.map((o) => (
        <div key={o.id} className="data-row">
          <div>
            <strong>{(o.type || 'Inquiry') + ' · ' + (o.name || 'Customer')}</strong>
            <p>{new Date(o.submitted_at).toLocaleString('en-IN')}</p>
          </div>
          <span className="badge">{(o.status || '').replaceAll('_', ' ')}</span>
        </div>
      ))}
    </div>
  );
}
