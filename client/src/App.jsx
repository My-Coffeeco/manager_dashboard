import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { LoginForm } from './components/LoginForm';
import { StatsGrid } from './components/StatsGrid';
import { OrderQueue } from './components/OrderQueue';
import { OrderDetailModal } from './components/OrderDetailModal';
import { InquiriesList } from './components/InquiriesList';
import { AlertsList } from './components/AlertsList';
import { RefreshCw } from 'lucide-react';

export function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [storeId, setStoreId] = useState('');
  const [storesList, setStoresList] = useState([]);
  const [dashboardData, setDashboardData] = useState(null);
  const [currentView, setCurrentView] = useState('overview');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [message, setMessage] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);

  const fetchAuth = useCallback(async () => {
    try {
      const r = await fetch('/admin/auth/me');
      if (r.status === 401) {
        setUser(null);
        return false;
      }
      const data = await r.json();
      setUser(data);
      setStoreId(data.store_id || 'mycoffeeco-online');
      return true;
    } catch {
      setUser(null);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStores = useCallback(async () => {
    try {
      const r = await fetch('/admin/stores');
      if (r.ok) {
        const values = await r.json();
        setStoresList(values);
        if (values.length && !values.some((x) => x.id === storeId)) {
          setStoreId(values[0].id);
        }
      }
    } catch {
      // Stores API ignored if user does not have permission
    }
  }, [storeId]);

  const refreshDashboard = useCallback(async () => {
    if (!storeId) return;
    try {
      const r = await fetch(`/admin/dashboard?store_id=${encodeURIComponent(storeId)}`);
      if (r.status === 401) {
        setUser(null);
        return;
      }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to fetch dashboard data');
      setDashboardData(data);
    } catch (err) {
      setMessage(err.message);
    }
  }, [storeId]);

  useEffect(() => {
    fetchAuth();
  }, [fetchAuth]);

  useEffect(() => {
    if (user) {
      if (user.permissions?.includes('invite')) {
        fetchStores();
      }
      refreshDashboard();
    }
  }, [user, fetchStores, refreshDashboard]);

  const handleLogout = async () => {
    try {
      await fetch('/admin/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setDashboardData(null);
    }
  };

  if (loading) {
    return (
      <div className="login-wrapper">
        <div style={{ color: 'white', fontWeight: 600, fontSize: '18px' }}>Loading workspace...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginForm onLoginSuccess={fetchAuth} message={message} setMessage={setMessage} />;
  }

  const roleTitle = user.role ? user.role.replaceAll('_', ' ') : 'Manager';
  const storeName = dashboardData?.store?.name || storeId || 'My Coffee Co.';

  const viewTitles = {
    overview: "Let's get brewing.",
    orders: 'Every order, in focus.',
    inquiries: 'Your next opportunity.',
    alerts: 'What needs attention.'
  };

  return (
    <div className="app-container">
      <Sidebar
        currentView={currentView}
        setCurrentView={setCurrentView}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />

      <div className="workspace">
        <Header onLogout={handleLogout} toggleMobileNav={() => setMobileOpen(!mobileOpen)} />

        <main className="main-content">
          {message && <div className="message-banner">{message}</div>}

          <div className="page-intro">
            <div>
              <p className="overline">YOUR STORE, AT A GLANCE</p>
              <h1>{viewTitles[currentView] || "Let's get brewing."}</h1>
              <p className="subtitle">The orders, people and details that need your attention.</p>
            </div>

            <button className="btn-secondary" onClick={refreshDashboard}>
              <RefreshCw size={16} style={{ marginRight: '6px' }} /> ↻ Refresh
            </button>
          </div>

          <div className="identity-strip">
            <div className="identity-info">
              <strong>{roleTitle} · {storeName}</strong>
              <p>Role: {user.role || 'store_manager'}</p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="badge">
                {(dashboardData?.alerts?.length || 0)} unread alerts
              </span>

              {storesList.length > 0 && (
                <select
                  className="select-input"
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                >
                  {storesList.map((s) => (
                    <option key={s.id} value={s.id}>{s.name || s.id}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {currentView === 'overview' && (
            <StatsGrid dashboardData={dashboardData} user={user} />
          )}

          <div className={`columns-layout ${currentView !== 'overview' ? 'single' : ''}`}>
            {['overview', 'orders'].includes(currentView) && (
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="overline">FULFILMENT</span>
                    <h2>Order queue</h2>
                  </div>
                  <span className="quiet">Needs action</span>
                </div>

                <OrderQueue
                  orders={dashboardData?.orders}
                  onSelectOrder={(order) => setSelectedOrder(order)}
                />
              </section>
            )}

            {['overview', 'inquiries'].includes(currentView) && (
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="overline">GROW THE BRAND</span>
                    <h2>Recent inquiries</h2>
                  </div>
                </div>

                <InquiriesList inquiries={dashboardData?.inquiries} />
              </section>
            )}
          </div>

          {['overview', 'alerts'].includes(currentView) && (
            <section className="panel" style={{ marginTop: '24px' }}>
              <div className="panel-heading">
                <div>
                  <span className="overline">ATTENTION CENTRE</span>
                  <h2>Alerts</h2>
                </div>
                <span className="quiet">Assigned to you</span>
              </div>

              <AlertsList
                alerts={dashboardData?.alerts}
                onMarkRead={refreshDashboard}
                setMessage={setMessage}
              />
            </section>
          )}
        </main>
      </div>

      <OrderDetailModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onStatusUpdated={refreshDashboard}
        setMessage={setMessage}
      />
    </div>
  );
}
