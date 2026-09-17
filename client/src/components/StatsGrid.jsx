import React from 'react';

export function StatsGrid({ dashboardData, user }) {
  if (!dashboardData) return null;

  const money = (v) =>
    v == null ? null : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(v / 100);

  const stats = [
    { label: "Today's revenue", value: money(dashboardData.revenue_paise), permission: 'orders' },
    { label: 'Open orders', value: dashboardData.open_orders, permission: 'orders' },
    { label: 'Low stock SKUs', value: dashboardData.low_stock, permission: 'inventory' },
    { label: 'Open inquiries', value: dashboardData.open_inquiries, permission: 'inquiries' },
  ];

  return (
    <div className="stats-grid">
      {stats.map(({ label, value, permission }) => {
        const hasPerm = user?.permissions?.includes(permission);
        const displayValue = value ?? (dashboardData?.sources && hasPerm ? 'Awaiting data' : 'No access');

        return (
          <div key={label} className="stat-card">
            <span>{label}</span>
            <strong>{displayValue}</strong>
          </div>
        );
      })}
    </div>
  );
}
