import React from 'react';
import { LayoutDashboard, FileText, MessageSquare, Bell, Coffee } from 'lucide-react';

export function Sidebar({ currentView, setCurrentView, mobileOpen, setMobileOpen }) {
  const navItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'orders', label: 'Orders', icon: FileText },
    { id: 'inquiries', label: 'Inquiries', icon: MessageSquare },
    { id: 'alerts', label: 'Alerts', icon: Bell },
  ];

  const handleSelect = (id) => {
    setCurrentView(id);
    setMobileOpen(false);
  };

  return (
    <aside className={`rail ${mobileOpen ? 'open' : ''}`}>
      <a className="brand" href="/admin">
        <img src="/logo.avif" alt="My Coffee Co." />
      </a>
      
      <p className="rail-label">WORKSPACE</p>
      
      <nav className="nav-menu" aria-label="Manager navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => handleSelect(item.id)}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="rail-bottom">
        <span className="rail-dot"></span>
        <div>
          <div>My Coffee Co.</div>
          <small style={{ color: '#656677', fontWeight: 400 }}>Operations workspace</small>
        </div>
      </div>
    </aside>
  );
}
