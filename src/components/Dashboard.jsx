import { useEffect, useState } from 'react';
import { dataAPI, getSingletonInventory } from '../lib/data';
import Swal from 'sweetalert2';
import { isOnline, syncAll } from '../lib/sync';
import { getActiveFarm } from '../lib/data';
import { formatDate } from '../lib/utils';
import FarmInvite from './FarmInvite';

/**
 * Dashboard Component
 * This is the main screen users see after logging in.
 * It shows summary statistics, low feed alerts, and recent transactions.
 * 
 * Props:
 * @param {function} onNavigateToModule - Function to change pages (e.g. go to 'inventory')
 * @param {object} profile - Information about the currently logged-in user
 */
export default function Dashboard({ onNavigateToModule, profile }) {
  // useState creates state variables that will trigger a re-render when they change
  // stats: holds our summary numbers (total pigs, feed stock, profit, upcoming events)
  const [stats, setStats] = useState({
    pigCount: 0,
    feedStock: 0,
    netProfit: 0,
    upcomingEvents: 0,
  });
  // Lists of data to display
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [upcomingFarrowings, setUpcomingFarrowings] = useState([]);
  
  // loading: determines if we should show a loading spinner
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  
  // realDailyConsumption: calculated average feed eaten per day
  const [realDailyConsumption, setRealDailyConsumption] = useState(0);

  // Viewing-mode state (when a farm owner is looking at their caretaker's dashboard)
  const [viewingCaretaker, setViewingCaretaker] = useState(null); // { id, name, role, email }
  const [caretakerActivity, setCaretakerActivity] = useState(null); // { totalActions, thisMonth, categories, recent }

  // useEffect runs side effects. In this case, it runs once when the component first loads.
  useEffect(() => {
    // Detect owner-viewing-caretaker mode from local storage
    const vModeId = localStorage.getItem('swinesync_viewing_mode');
    if (vModeId) {
      dataAPI.profiles.getById(vModeId).then(p => {
        if (p) setViewingCaretaker({ id: p.id, name: p.username || p.email?.split('@')[0] || 'Caretaker', role: p.role, email: p.email });
      }).catch(() => {});
    }
    
    // Load all the data for the dashboard
    loadDashboardData();
    
    // Listen for custom 'refreshAllData' event to reload data when other parts of the app update it
    window.addEventListener('refreshAllData', loadDashboardData);
    
    // Cleanup function that runs when the component is unmounted
    return () => {
      window.removeEventListener('refreshAllData', loadDashboardData);
    };
  }, []); // The empty array [] means this effect only runs once on mount

  async function loadDashboardData() {
    setLoading(true);
    try {
      const allPigs = await dataAPI.pigs.getAll();
      // ✅ Only ACTIVE pigs (exclude sold/deceased)
      const activePigs = allPigs.filter(p => p.status === 'active');
      const pigCount = activePigs.length;

      const inventory = await getSingletonInventory();
      const transactions = await dataAPI.financial_transactions.getAll();
      const today = new Date().toISOString().split('T')[0];
      const allBreedings = await dataAPI.breedings.getAll();

      // ✅ Genuinely upcoming — exclude terminal states
      const upcomingBreedings = allBreedings.filter(b =>
        b.expected_farrow &&
        b.expected_farrow >= today &&
        b.status !== 'Farrowed' &&
        b.status !== 'Weaned' &&
        b.status !== 'Aborted'
      );
      const upcoming = upcomingBreedings.length;

      const totalExp = transactions?.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0) || 0;
      const totalRev = transactions?.filter(t => t.type === 'revenue').reduce((s, t) => s + t.amount, 0) || 0;

      setStats({
        pigCount,
        feedStock: inventory?.feed_stock_kg || 0,
        netProfit: totalRev - totalExp,
        upcomingEvents: upcoming,
      });

      const recent = await dataAPI.financial_transactions.getAll({
        orderBy: { column: 'date', ascending: false },
        limit: 5
      });
      setRecentTransactions(recent || []);

      const upcomingList = allBreedings
        .filter(b =>
          b.expected_farrow &&
          b.expected_farrow >= today &&
          b.status !== 'Farrowed' &&
          b.status !== 'Weaned' &&
          b.status !== 'Aborted'
        )
        .sort((a, b) => new Date(a.expected_farrow) - new Date(b.expected_farrow))
        .slice(0, 5)
        .map(f => ({ ...f, pigs: allPigs.find(p => p.id === f.pig_id) }));
      setUpcomingFarrowings(upcomingList);

      await loadRealConsumption();

      // Load caretaker-specific activity if in viewing mode
      const vModeId = localStorage.getItem('swinesync_viewing_mode');
      if (vModeId) {
        await loadCaretakerActivity(vModeId);
      }

      setLastUpdated(new Date());
    } catch (error) {
      console.error('Dashboard load error:', error);
      Swal.fire('Error', 'Failed to load dashboard data', 'error');
    } finally {
      setLoading(false);
    }
  }

  const NOTIF_CATEGORY = {
    pig_added:           { key: 'pig',      label: 'Pig Mgmt',  icon: 'fa-piggy-bank', color: '#8b5cf6' },
    mating_added:        { key: 'breeding', label: 'Breeding',  icon: 'fa-heart',      color: '#ec4899' },
    farrowing_recorded:  { key: 'breeding', label: 'Breeding',  icon: 'fa-baby',       color: '#ec4899' },
    weaning_recorded:    { key: 'breeding', label: 'Breeding',  icon: 'fa-seedling',   color: '#ec4899' },
    feed_logged:         { key: 'feed',     label: 'Feeding',   icon: 'fa-utensils',   color: '#10b981' },
    low_stock:           { key: 'feed',     label: 'Feeding',   icon: 'fa-exclamation-triangle', color: '#10b981' },
    missed_feeding:      { key: 'feed',     label: 'Feeding',   icon: 'fa-clock',      color: '#10b981' },
    health_recorded:     { key: 'health',   label: 'Health',    icon: 'fa-heartbeat',  color: '#ef4444' },
    health_treatment:    { key: 'health',   label: 'Health',    icon: 'fa-stethoscope',color: '#ef4444' },
    vaccination_due:     { key: 'health',   label: 'Health',    icon: 'fa-syringe',    color: '#ef4444' },
    vaccination_overdue: { key: 'health',   label: 'Health',    icon: 'fa-syringe',    color: '#ef4444' },
    growth_recorded:     { key: 'growth',   label: 'Growth',    icon: 'fa-chart-line', color: '#3b82f6' },
    mortality_recorded:  { key: 'growth',   label: 'Growth',    icon: 'fa-skull',      color: '#3b82f6' },
  };

  const NOTIF_TITLE = {
    pig_added: 'Pig Added', mating_added: 'Mating Recorded',
    farrowing_recorded: 'Farrowing Recorded', weaning_recorded: 'Weaning Recorded',
    feed_logged: 'Feed Logged', low_stock: 'Low Stock Alert', missed_feeding: 'Missed Feeding',
    health_recorded: 'Health Record Added', health_treatment: 'Treatment Applied',
    vaccination_due: 'Vaccination Due', vaccination_overdue: 'Vaccination Overdue',
    growth_recorded: 'Growth Recorded', mortality_recorded: 'Mortality Reported',
  };

  async function loadCaretakerActivity(caretakerId) {
    try {
      const [profileData, notifications] = await Promise.all([
        dataAPI.profiles.getById(caretakerId).catch(() => null),
        dataAPI.notifications.getAll().catch(() => []),
      ]);
      const actorName = profileData?.username;
      const myNotifs = actorName
        ? (notifications || []).filter(n => n.actor_name === actorName)
        : [];

      const monthStartISO = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const categories = { pig: 0, feed: 0, health: 0, growth: 0, breeding: 0 };
      let thisMonth = 0;
      myNotifs.forEach(n => {
        const map = NOTIF_CATEGORY[n.type];
        if (map) categories[map.key] += 1;
        if (n.created_at && n.created_at >= monthStartISO) thisMonth += 1;
      });

      const recent = [...myNotifs]
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 8);

      setCaretakerActivity({
        actorName,
        totalActions: myNotifs.length,
        thisMonth,
        categories,
        recent,
      });
    } catch (err) {
      console.error('loadCaretakerActivity error:', err);
    }
  }

  async function loadRealConsumption() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
    const logs = await dataAPI.feeding_logs.getAll({
      filters: { time: { gte: thirtyDaysAgoStr } }
    });
    if (!logs || logs.length === 0) {
      setRealDailyConsumption(0);
      return;
    }
    const dailyMap = new Map();
    logs.forEach((log) => {
      const day = (log.time || '').split('T')[0];
      if (day) dailyMap.set(day, (dailyMap.get(day) || 0) + (log.amount_kg || 0));
    });
    const totalConsumption = Array.from(dailyMap.values()).reduce((s, v) => s + v, 0);
    const daysWithData = dailyMap.size;
    const avgDaily = daysWithData > 0 ? totalConsumption / daysWithData : 0;
    setRealDailyConsumption(Math.round(avgDaily * 10) / 10);
  }

  const [online, setOnline] = useState(isOnline());
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  async function handleSync() {
    setSyncing(true);
    try {
      await syncAll();
      await loadDashboardData();
      Swal.fire('Synced', 'All pending data has been uploaded', 'success');
    } catch (err) {
      Swal.fire('Sync Failed', err.message, 'error');
    } finally {
      setSyncing(false);
    }
  }

  function refreshData() {
    loadDashboardData();
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Dashboard updated', timer: 1500, showConfirmButton: false });
  }

  function daysUntil(dateString) {
    if (!dateString) return null;
    const diff = new Date(dateString) - new Date();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  const realDaysLeft = realDailyConsumption > 0 ? Math.floor(stats.feedStock / realDailyConsumption) : 0;
  const stockPercent = Math.min(100, Math.round((stats.feedStock / (stats.feedStock + 500)) * 100));
  const isLowFeed = stats.feedStock < 500;

  if (loading) return <div className="card" style={{ textAlign: 'center', padding: 48 }}><i className="fas fa-spinner fa-pulse fa-2x"></i><p>Loading dashboard...</p></div>;

  const CATEGORY_LIST = [
    { key: 'feed',     label: 'Feeding',  icon: 'fa-utensils',   color: '#10b981', bg: '#d1fae5' },
    { key: 'health',   label: 'Health',   icon: 'fa-heartbeat',  color: '#ef4444', bg: '#fee2e2' },
    { key: 'growth',   label: 'Growth',   icon: 'fa-chart-line', color: '#3b82f6', bg: '#dbeafe' },
    { key: 'breeding', label: 'Breeding', icon: 'fa-heart',      color: '#ec4899', bg: '#fce7f3' },
    { key: 'pig',      label: 'Pig Mgmt', icon: 'fa-piggy-bank', color: '#8b5cf6', bg: '#ede9fe' },
  ];

  function formatWhen(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px' }}>

      {/* ── Viewing-mode banner ── */}
      {viewingCaretaker && (
        <div style={{
          background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
          borderLeft: '4px solid #f59e0b', borderRadius: 12,
          padding: '14px 20px', marginBottom: 20,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <strong style={{ color: '#92400e', fontSize: 15 }}>👁 Viewing Dashboard: {viewingCaretaker.name}</strong>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#78350f' }}>
              {viewingCaretaker.role} · {viewingCaretaker.email} · Shared farm data shown below; caretaker's own activity shown in the panel.
            </p>
          </div>
          <button
            onClick={() => { localStorage.removeItem('swinesync_viewing_mode'); window.location.reload(); }}
            style={{ background: '#f59e0b', color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
          >
            ← Exit Viewing Mode
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <span style={{ fontSize: 12, color: '#6b7280' }}>Last updated: {lastUpdated.toLocaleTimeString()}</span>
        <button onClick={refreshData} style={{ background: '#e5e7eb', border: 'none', borderRadius: 8, padding: '4px 12px', cursor: 'pointer' }}>
          <i className="fas fa-sync-alt"></i> Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '20px', marginBottom: '32px' }}>
        <div className="card">
          <i className="fas fa-piggy-bank" style={{ fontSize: 32, color: '#10b981' }}></i>
          <p style={{ fontSize: 36, fontWeight: 900, marginTop: 8 }}>{stats.pigCount}</p>
          <p style={{ color: '#6b7280' }}>Active Pigs</p>
        </div>
        <div className="card">
          <i className="fas fa-warehouse" style={{ fontSize: 32, color: '#f59e0b' }}></i>
          <p style={{ fontSize: 36, fontWeight: 900, marginTop: 8 }}>{stats.feedStock} kg</p>
          <p style={{ color: '#6b7280' }}>Feed Stock</p>
        </div>
        {(profile?.role === 'Owner' || profile?.role === 'Admin') && (
          <div className="card">
            <i className="fas fa-chart-simple" style={{ fontSize: 32, color: '#22c55e' }}></i>
            <p style={{ fontSize: 36, fontWeight: 900, marginTop: 8 }}>₱{stats.netProfit.toLocaleString()}</p>
            <p style={{ color: '#6b7280' }}>Net Profit</p>
          </div>
        )}
        <div className="card">
          <i className="fas fa-bell" style={{ fontSize: 32, color: '#a855f7' }}></i>
          <p style={{ fontSize: 24, fontWeight: 900, marginTop: 8 }}>{stats.upcomingEvents}</p>
          <p style={{ fontSize: 14, color: '#6b7280' }}>Upcoming Farrowings</p>
        </div>
      </div>

      {/* Insights Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', marginBottom: '32px' }}>
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => onNavigateToModule && onNavigateToModule('inventory')}>
          <h3 style={{ fontWeight: 'bold', fontSize: 20, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-calendar-alt" style={{ color: '#059669' }}></i> Smart Insights
          </h3>
          {realDailyConsumption > 0 ? (
            <>
              <p>📈 AI predicts feed depletion in <strong>{Math.max(0, realDaysLeft)} days</strong>.</p>
              <div style={{ width: '100%', background: '#e5e7eb', borderRadius: 999, height: 10, marginTop: 8 }}>
                <div style={{ width: `${stockPercent}%`, background: isLowFeed ? '#ef4444' : '#059669', height: 10, borderRadius: 999 }}></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
                <span>Stock level</span><span>{stockPercent}%</span>
              </div>
              {isLowFeed && <div style={{ marginTop: 12, background: '#fee2e2', padding: 8, borderRadius: 12, color: '#b91c1c', fontSize: 14 }}>⚠️ Low feed stock! Consider reordering soon.</div>}
            </>
          ) : (
            <p>📊 No consumption data yet – start logging feedings to get predictions.</p>
          )}
          <div style={{ marginTop: 12 }}><i className="fas fa-tasks"></i> Upcoming tasks: {stats.upcomingEvents} farrowings to monitor.</div>
          <button onClick={(e) => { e.stopPropagation(); if (onNavigateToModule) onNavigateToModule('inventory'); }} style={{ marginTop: 12, background: '#10b981', color: 'white', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
            <i className="fas fa-arrow-right"></i> Go to AI Inventory
          </button>
        </div>

        <div className="card">
          <h3 style={{ fontWeight: 'bold', fontSize: 20, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-receipt" style={{ color: '#22c55e' }}></i> Recent Transactions
          </h3>
          {recentTransactions.length === 0 ? <p>No transactions yet.</p> : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {recentTransactions.map(tx => (
                <li key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #e5e7eb' }}>
                  <span>
                    {tx.description || (tx.type === 'expense' ? 'Expense' : 'Revenue')}
                    {tx.category && <small style={{ display: 'block', fontSize: 11, color: '#6b7280' }}>{tx.category}</small>}
                    <br /><small style={{ fontSize: 11, color: '#6b7280' }}>{formatDate(tx.date)}</small>
                  </span>
                  <span style={{ fontWeight: 'bold', color: tx.type === 'expense' ? '#ef4444' : '#10b981' }}>
                    {tx.type === 'expense' ? '-' : '+'}₱{tx.amount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h3 style={{ fontWeight: 'bold', fontSize: 20, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="fas fa-calendar-week" style={{ color: '#a855f7' }}></i> Upcoming Farrowings
          </h3>
          {upcomingFarrowings.length === 0 ? <p>No upcoming farrowings scheduled.</p> : (
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {upcomingFarrowings.map(f => {
                const pig = f.pigs;
                const days = daysUntil(f.expected_farrow);
                return (
                  <li key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #e5e7eb' }}>
                    <div>
                      <strong>{pig?.tag || '?'} - {pig?.name || 'Unknown'}</strong>
                      <div style={{ fontSize: 12, color: '#4b5563' }}>{formatDate(f.expected_farrow)} ({days > 0 ? `${days} days left` : 'overdue'})</div>
                    </div>
                    <span style={{ background: days <= 7 ? '#fef3c7' : '#e0e7ff', padding: '2px 8px', borderRadius: 999, fontSize: 12 }}>{f.status}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div style={{ marginTop: '32px' }}>
        <FarmInvite profile={profile} />
      </div>

      {/* ── Caretaker Activity Panel (viewing mode only) ── */}
      {viewingCaretaker && caretakerActivity && (
        <div style={{ marginTop: 32, background: 'white', borderRadius: 20, border: '1.5px solid #a78bfa', boxShadow: '0 4px 24px rgba(124,58,237,0.10)', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ background: 'linear-gradient(135deg, #4c1d95, #7c3aed)', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>Personal Contribution</div>
              <div style={{ color: 'white', fontSize: 20, fontWeight: 800 }}>{viewingCaretaker.name}'s Activity</div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: '8px 14px', color: 'white', fontSize: 13, fontWeight: 700 }}>
                <i className="fas fa-bolt" style={{ marginRight: 6 }}></i>{caretakerActivity.totalActions} Total Actions
              </div>
              <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: '8px 14px', color: 'white', fontSize: 13, fontWeight: 700 }}>
                <i className="fas fa-calendar-day" style={{ marginRight: 6 }}></i>{caretakerActivity.thisMonth} This Month
              </div>
            </div>
          </div>

          <div style={{ padding: 24 }}>
            {/* Category breakdown */}
            <h4 style={{ margin: '0 0 14px', fontWeight: 800, color: '#1f2937', fontSize: 15 }}>Activity Breakdown</h4>
            {caretakerActivity.totalActions === 0 ? (
              <p style={{ color: '#9ca3af', fontSize: 14, marginBottom: 20 }}>No recorded activity for {viewingCaretaker.name} yet.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
                {CATEGORY_LIST.map(cat => (
                  <div key={cat.key} style={{ background: cat.bg, borderRadius: 14, padding: '14px 12px', textAlign: 'center' }}>
                    <i className={`fas ${cat.icon}`} style={{ fontSize: 22, color: cat.color, marginBottom: 8 }}></i>
                    <div style={{ fontSize: 26, fontWeight: 900, color: '#1f2937' }}>{caretakerActivity.categories[cat.key] || 0}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{cat.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Recent Activity Timeline */}
            <h4 style={{ margin: '0 0 14px', fontWeight: 800, color: '#1f2937', fontSize: 15 }}>Recent Activity</h4>
            {caretakerActivity.recent.length === 0 ? (
              <div style={{ background: '#f9fafb', borderRadius: 14, padding: 32, border: '1px dashed #d1d5db', textAlign: 'center', color: '#9ca3af' }}>
                <i className="fas fa-inbox" style={{ fontSize: 28, display: 'block', marginBottom: 8 }}></i>
                <p style={{ margin: 0, fontSize: 14 }}>No activity logged yet.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {caretakerActivity.recent.map(n => {
                  const cat = NOTIF_CATEGORY[n.type];
                  const color = cat?.color || '#6b7280';
                  const icon = cat?.icon || 'fa-bell';
                  return (
                    <div key={n.id} style={{ display: 'flex', gap: 12, padding: '12px 14px', background: '#f9fafb', border: '1px solid #e5e7eb', borderLeft: `4px solid ${color}`, borderRadius: 12 }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <i className={`fas ${icon}`} style={{ color, fontSize: 13 }}></i>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ fontWeight: 700, color: '#1f2937', fontSize: 13 }}>{NOTIF_TITLE[n.type] || 'Activity'}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', marginLeft: 8 }}>{formatWhen(n.created_at)}</div>
                        </div>
                        <div style={{ fontSize: 13, color: '#4b5563', marginTop: 4, lineHeight: 1.45, wordBreak: 'break-word' }}>{n.message}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .card { background: white; border-radius: 16px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: transform 0.2s, box-shadow 0.2s; }
        .card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        @media (max-width: 768px) { .card { padding: 16px; } .card p:first-of-type { font-size: 28px !important; } .card i { font-size: 24px !important; } }
      `}</style>
    </div>
  );
}