import React from 'react';
import { Menu, LogOut } from 'lucide-react';

export function Header({ onLogout, toggleMobileNav }) {
  return (
    <header className="top-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button className="mobile-nav-toggle" onClick={toggleMobileNav} aria-label="Toggle menu">
          <Menu size={22} />
        </button>
        <div>
          <span className="overline" style={{ color: 'rgba(255,255,255,0.8)' }}>MY COFFEE CO.</span>
          <h1>Manager dashboard</h1>
        </div>
      </div>

      <button className="btn-secondary" style={{ background: 'transparent', color: 'white', borderColor: 'white' }} onClick={onLogout}>
        <LogOut size={16} style={{ marginRight: '6px' }} />
        Sign out ↗
      </button>
    </header>
  );
}
