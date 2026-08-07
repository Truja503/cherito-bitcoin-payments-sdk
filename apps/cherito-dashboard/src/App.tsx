import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Receipt, Webhook, Key, Settings, Bitcoin } from 'lucide-react';

const Sidebar = () => {
  const location = useLocation();
  const navItems = [
    { path: '/', label: 'Overview', icon: LayoutDashboard },
    { path: '/transactions', label: 'Transactions', icon: Receipt },
    { path: '/webhooks', label: 'Webhooks', icon: Webhook },
    { path: '/apikeys', label: 'API Keys', icon: Key },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="sidebar fade-in delay-100">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '3rem' }}>
        <div style={{ background: 'var(--accent-gradient)', padding: '0.5rem', borderRadius: 'var(--radius-md)', color: 'white' }}>
          <Bitcoin size={28} />
        </div>
        <h2 className="text-gradient" style={{ fontSize: '1.5rem', margin: 0 }}>Cherito</h2>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                color: isActive ? 'white' : 'var(--text-secondary)',
                background: isActive ? 'var(--bg-glass-hover)' : 'transparent',
                fontWeight: isActive ? 600 : 500,
                border: isActive ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
                transition: 'all var(--transition-fast)',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }
              }}
            >
              <item.icon size={20} color={isActive ? 'var(--accent-primary)' : 'currentColor'} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
};

const Overview = () => (
  <div className="fade-in delay-200">
    <h1 style={{ marginBottom: '2rem', fontSize: '2.5rem' }}>Dashboard Overview</h1>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
      
      <div className="glass-panel" style={{ padding: '2rem' }}>
        <h3 style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '0.5rem' }}>Total Volume (30d)</h3>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <span style={{ fontSize: '3rem', fontWeight: 700 }} className="text-gradient">2,450,000</span>
          <span style={{ color: 'var(--text-secondary)' }}>sats</span>
        </div>
        <div style={{ marginTop: '1rem' }}><span className="badge success">+12.5%</span> from last month</div>
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        <h3 style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '0.5rem' }}>Successful Payments</h3>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <span style={{ fontSize: '3rem', fontWeight: 700 }}>142</span>
        </div>
        <div style={{ marginTop: '1rem' }}><span className="badge warning">3 pending</span></div>
      </div>

    </div>

    <h2 style={{ marginTop: '3rem', marginBottom: '1.5rem' }}>Recent Activity</h2>
    <div className="glass-panel" style={{ overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: 'var(--border-glass)', background: 'rgba(0,0,0,0.2)' }}>
            <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Payment ID</th>
            <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Amount</th>
            <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Status</th>
            <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Date</th>
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3].map((i) => (
            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <td style={{ padding: '1rem 1.5rem', fontFamily: 'monospace' }}>pi_abc123xyz{i}</td>
              <td style={{ padding: '1rem 1.5rem' }}>50,000 sats</td>
              <td style={{ padding: '1rem 1.5rem' }}><span className="badge success">Settled</span></td>
              <td style={{ padding: '1rem 1.5rem', color: 'var(--text-secondary)' }}>Just now</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const PlaceholderView = ({ title }: { title: string }) => (
  <div className="fade-in delay-200">
    <h1 style={{ marginBottom: '2rem', fontSize: '2.5rem' }}>{title}</h1>
    <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <Webhook size={48} color="var(--accent-primary)" style={{ opacity: 0.5 }} />
      </div>
      <h2 style={{ marginBottom: '1rem' }}>No Data Available</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', maxWidth: '400px', margin: '0 auto 2rem auto' }}>
        The {title.toLowerCase()} module is currently empty or pending implementation.
      </p>
      <button className="btn-primary">
        Create New
      </button>
    </div>
  </div>
);

function App() {
  return (
    <div className="app-container">
      <Sidebar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/transactions" element={<PlaceholderView title="Transactions" />} />
          <Route path="/webhooks" element={<PlaceholderView title="Webhooks" />} />
          <Route path="/apikeys" element={<PlaceholderView title="API Keys" />} />
          <Route path="/settings" element={<PlaceholderView title="Settings" />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
