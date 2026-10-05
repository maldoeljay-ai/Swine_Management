import React, { useState, useEffect } from 'react';
import { logger } from '../utils/logger';
import { db } from '../lib/db';
import { isOnline, checkConnectivity, syncAll, getPendingCount } from '../lib/sync';
import { getActiveFarm } from '../lib/data';
import Swal from 'sweetalert2';

/**
 * @file src/components/DevDebugBar.jsx
 * @description Beginner-Friendly Developer Debug HUD & Navigation Bar.
 *
 * Provides instant real-time visibility into:
 * 1. Which file renders the current screen (Quick File Reference)
 * 2. Active User Role & Farm Scope ID
 * 3. Network Connectivity & Dexie Sync Queue status
 * 4. Live Log Viewer (captures database, auth, sync, and realtime events)
 * 5. One-click Debugging Tools (force sync, check ping, view table counts, clear cache)
 *
 * Hotkey: Press `Ctrl + Shift + D` or click the floating "🛠️ Debug Helper" button.
 */

// Mapping of module IDs to their source file locations for easy beginner navigation
const MODULE_FILE_MAP = {
  dashboard: { name: 'Farm Hub', file: 'src/components/Dashboard.jsx', desc: 'Main farm overview, stats cards, and caretaker activity' },
  breeding: { name: 'Breeding Manager', file: 'src/components/Breeding.jsx', desc: 'Mating planner, gestation tracking, farrowing & weaning' },
  fatteners: { name: 'Fatteners', file: 'src/components/Fatteners.jsx', desc: 'Fattener batch growth tracking and market readiness' },
  feeding: { name: 'Smart Feeding', file: 'src/components/Feeding.jsx', desc: 'Feeding schedules, logs, and missed feeding alerts' },
  health: { name: 'Health Watch', file: 'src/components/Health.jsx', desc: 'Vaccinations, treatments, and AI disease diagnosis' },
  inventory: { name: 'AI Inventory', file: 'src/components/Inventory.jsx', desc: 'Feed stock tracking, reorder thresholds & AI forecasts' },
  growth: { name: 'Growth & Mortality', file: 'src/components/GrowthMortality.jsx', desc: 'Pig weight gains (ADG) and mortality records' },
  financial: { name: 'Financial Ledger', file: 'src/components/Financial.jsx', desc: 'Income and expense transactions ledger' },
  reports: { name: 'Analytics Pro', file: 'src/components/Reports.jsx', desc: 'Analytics charts, FCR metrics, and printable reports' },
  farm: { name: 'Farm Access', file: 'src/components/FarmInvite.jsx', desc: 'Farm invitations, member roles, and worker views' },
  users: { name: 'User Roles', file: 'src/components/UserManagement.jsx', desc: 'Farm staff management and role permissions' },
  admin_overview: { name: 'Admin Overview', file: 'src/components/UserManagement.jsx', desc: 'System-wide statistics for Super Admins' },
  admin_users: { name: 'Admin Users', file: 'src/components/UserManagement.jsx', desc: 'Manage all accounts across the application' },
  admin_farms: { name: 'Admin Farms', file: 'src/components/UserManagement.jsx', desc: 'Manage registered farm workspaces' },
  admin_roles: { name: 'Admin Roles', file: 'src/components/UserManagement.jsx', desc: 'Custom role definitions and permission matrices' },
  admin_invitations: { name: 'Admin Invitations', file: 'src/components/UserManagement.jsx', desc: 'Farm invitation code administration' },
  admin_audit: { name: 'Admin Audit Log', file: 'src/components/UserManagement.jsx', desc: 'System security and action audit logs' },
};

export default function DevDebugBar({
  activeModule,
  onNavigateToModule,
  profile,
  activeFarmId,
  allowedModules = []
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('nav'); // 'nav', 'logs', 'tables', 'help'
  const [logs, setLogs] = useState([]);
  const [logFilter, setLogFilter] = useState('ALL');
  const [onlineStatus, setOnlineStatus] = useState(isOnline());
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [tableCounts, setTableCounts] = useState({});
  const [isSyncing, setIsSyncing] = useState(false);

  // Keyboard shortcut: Ctrl + Shift + D to toggle HUD
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Subscribe to live debug logs from logger
  useEffect(() => {
    setLogs(logger.getLogs());
    const unsubscribe = logger.subscribe((_, allLogs) => {
      setLogs(allLogs);
    });
    return unsubscribe;
  }, []);

  // Poll sync status & pending count
  useEffect(() => {
    const refreshStatus = async () => {
      setOnlineStatus(isOnline());
      const count = await getPendingCount();
      setPendingQueueCount(count);
    };

    refreshStatus();
    const interval = setInterval(refreshStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Load IndexedDB table record counts when 'tables' tab is clicked
  const loadTableCounts = async () => {
    try {
      const tables = [
        'pigs', 'breedings', 'farrowings', 'weanings',
        'feeding_schedules', 'feeding_logs', 'inventory',
        'financial_transactions', 'health_records', 'growth_records',
        'mortality_records', 'notifications', 'profiles', 'syncQueue'
      ];
      const counts = {};
      for (const t of tables) {
        if (db[t]) {
          counts[t] = await db[t].count();
        }
      }
      setTableCounts(counts);
    } catch (err) {
      console.warn('Failed to load table counts:', err);
    }
  };

  useEffect(() => {
    if (activeTab === 'tables') {
      loadTableCounts();
    }
  }, [activeTab]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    logger.sync('Manual sync triggered from Dev HUD');
    try {
      await syncAll();
      const count = await getPendingCount();
      setPendingQueueCount(count);
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Sync complete!',
        showConfirmButton: false,
        timer: 2000,
      });
    } catch (err) {
      logger.error('SYNC', 'Manual sync failed', err);
      Swal.fire('Sync Error', err.message || 'Sync failed', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTestPing = async () => {
    const reachable = await checkConnectivity();
    setOnlineStatus(reachable);
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: reachable ? 'success' : 'warning',
      title: reachable ? 'Online: Server reachable' : 'Offline: No internet connectivity',
      showConfirmButton: false,
      timer: 2500,
    });
  };

  const handleClearDexie = async () => {
    const result = await Swal.fire({
      title: 'Reset Local Database?',
      text: 'This clears your local IndexedDB cache and reloads the app so fresh data is pulled from Supabase. Unsynced local edits may be lost.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      confirmButtonText: 'Yes, clear cache & reload',
      cancelButtonText: 'Cancel'
    });

    if (result.isConfirmed) {
      logger.warn('DATA', 'Clearing local Dexie database');
      await db.delete();
      localStorage.removeItem('swinesync_active_farm');
      localStorage.removeItem('swinesync_viewing_mode');
      window.location.reload();
    }
  };

  const currentModuleInfo = MODULE_FILE_MAP[activeModule] || {
    name: activeModule,
    file: 'Unknown component',
    desc: 'Custom or unmapped module'
  };

  const filteredLogs = logs.filter((entry) => {
    if (logFilter === 'ALL') return true;
    return entry.category === logFilter;
  });

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed',
          bottom: '16px',
          right: '16px',
          zIndex: 99999,
          background: isOpen ? '#1e293b' : '#059669',
          color: 'white',
          border: '2px solid white',
          borderRadius: '30px',
          padding: '8px 16px',
          fontSize: '13px',
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          transition: 'all 0.2s ease',
        }}
        title="Open Developer Debug HUD (Shortcut: Ctrl + Shift + D)"
      >
        <span>🛠️</span>
        <span>{isOpen ? 'Close Debugger' : 'Debug Helper'}</span>
        {pendingQueueCount > 0 && (
          <span style={{
            background: '#ef4444',
            color: 'white',
            borderRadius: '10px',
            padding: '2px 6px',
            fontSize: '11px',
            fontWeight: 800,
          }}>
            {pendingQueueCount} queued
          </span>
        )}
      </button>

      {/* Developer HUD Drawer */}
      {isOpen && (
        <aside
          aria-label="Developer Debug HUD"
          style={{
            position: 'fixed',
            bottom: '68px',
            right: '16px',
            width: '560px',
            maxWidth: 'calc(100vw - 32px)',
            height: '520px',
            maxHeight: 'calc(100vh - 100px)',
            background: '#0f172a',
            color: '#f8fafc',
            borderRadius: '16px',
            boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
            border: '1px solid #334155',
            zIndex: 99998,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '12px',
          }}
        >
          {/* Header */}
          <div style={{
            padding: '12px 16px',
            background: '#1e293b',
            borderBottom: '1px solid #334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>🛠️</span>
              <span style={{ fontWeight: 800, fontSize: '14px', color: '#38bdf8' }}>SwineSync Dev HUD</span>
              <span style={{
                background: onlineStatus ? '#10b981' : '#ef4444',
                color: 'white',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 700,
              }}>
                {onlineStatus ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '16px',
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Quick Context Bar */}
          <div style={{
            padding: '8px 16px',
            background: '#090d16',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            fontSize: '11px',
            color: '#94a3b8',
          }}>
            <div>
              <span style={{ color: '#64748b' }}>User: </span>
              <span style={{ color: '#f1f5f9', fontWeight: 600 }}>{profile?.username || profile?.email || 'Guest'}</span>
              <span style={{ color: '#38bdf8' }}> ({profile?.role || 'No Role'})</span>
            </div>
            <div>
              <span style={{ color: '#64748b' }}>Farm ID: </span>
              <span style={{ color: '#a7f3d0', fontFamily: 'monospace' }}>{activeFarmId || getActiveFarm() || 'None'}</span>
            </div>
            <div>
              <span style={{ color: '#64748b' }}>Sync Queue: </span>
              <span style={{ color: pendingQueueCount > 0 ? '#f59e0b' : '#10b981', fontWeight: 700 }}>
                {pendingQueueCount} items
              </span>
            </div>
          </div>

          {/* Tabs */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid #1e293b',
            background: '#131c2e',
          }}>
            {[
              { id: 'nav', label: '📍 File Navigator' },
              { id: 'logs', label: `📜 Live Logs (${logs.length})` },
              { id: 'tables', label: '🗄️ Database Tables' },
              { id: 'help', label: '💡 Beginner Guide' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  padding: '10px 4px',
                  background: activeTab === tab.id ? '#1e293b' : 'transparent',
                  border: 'none',
                  borderBottom: activeTab === tab.id ? '2px solid #38bdf8' : '2px solid transparent',
                  color: activeTab === tab.id ? '#38bdf8' : '#94a3b8',
                  fontWeight: activeTab === tab.id ? 700 : 500,
                  fontSize: '11px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px', background: '#0b1120' }}>
            {/* TAB 1: FILE NAVIGATOR */}
            {activeTab === 'nav' && (
              <div>
                <div style={{
                  background: '#1e293b',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  marginBottom: '14px',
                  border: '1px solid #334155',
                }}>
                  <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Currently Displayed Component
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#38bdf8', marginTop: '2px' }}>
                    {currentModuleInfo.name}
                  </div>
                  <div style={{
                    marginTop: '6px',
                    padding: '6px 10px',
                    background: '#090d16',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                    color: '#4ade80',
                    fontSize: '12px',
                    wordBreak: 'break-all',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <span>📄</span>
                    <span>{currentModuleInfo.file}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '6px' }}>
                    {currentModuleInfo.desc}
                  </div>
                </div>

                <div style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: '8px', fontSize: '12px' }}>
                  Jump to Any Module (Quick Navigation):
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {Object.entries(MODULE_FILE_MAP).map(([modKey, mod]) => {
                    const isCurrent = activeModule === modKey;
                    const isAllowed = allowedModules.includes(modKey);
                    return (
                      <button
                        key={modKey}
                        onClick={() => {
                          if (onNavigateToModule) onNavigateToModule(modKey);
                          logger.ui(`Navigated to module: ${modKey} (${mod.name})`);
                        }}
                        style={{
                          textAlign: 'left',
                          padding: '8px 10px',
                          background: isCurrent ? '#0369a1' : '#1e293b',
                          border: isCurrent ? '1px solid #38bdf8' : '1px solid #334155',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700, fontSize: '11px', color: isCurrent ? '#ffffff' : '#e2e8f0' }}>
                            {mod.name}
                          </span>
                          {!isAllowed && (
                            <span style={{ fontSize: '9px', background: '#78350f', color: '#fde68a', padding: '1px 4px', borderRadius: '4px' }}>
                              Role Locked
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: '10px', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {mod.file.replace('src/components/', '')}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Quick Debug Action Buttons */}
                <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={handleManualSync}
                    disabled={isSyncing}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: '#059669',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '11px',
                    }}
                  >
                    {isSyncing ? 'Syncing...' : '🔄 Force Sync Now'}
                  </button>
                  <button
                    onClick={handleTestPing}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: '#334155',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '11px',
                    }}
                  >
                    📶 Test Connectivity
                  </button>
                  <button
                    onClick={handleClearDexie}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: '#991b1b',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '11px',
                    }}
                  >
                    🗑️ Reset Local DB
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: LIVE LOGS */}
            {activeTab === 'logs' && (
              <div>
                {/* Filter buttons */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', overflowX: 'auto', paddingBottom: '4px' }}>
                  {['ALL', 'DATA', 'SYNC', 'AUTH', 'REALTIME', 'NOTIF', 'ERROR'].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setLogFilter(cat)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        background: logFilter === cat ? '#38bdf8' : '#1e293b',
                        color: logFilter === cat ? '#0f172a' : '#94a3b8',
                        border: 'none',
                        fontSize: '10px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                  <button
                    onClick={() => logger.clearLogs()}
                    style={{
                      marginLeft: 'auto',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      background: '#334155',
                      color: '#cbd5e1',
                      border: 'none',
                      fontSize: '10px',
                      cursor: 'pointer',
                    }}
                  >
                    Clear
                  </button>
                </div>

                {filteredLogs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '30px 10px', color: '#64748b' }}>
                    No logs recorded for this category yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {filteredLogs.slice(-50).reverse().map((entry) => (
                      <div
                        key={entry.id}
                        style={{
                          background: entry.level === 'error' ? 'rgba(239, 68, 68, 0.15)' : '#1e293b',
                          borderLeft: entry.level === 'error' ? '3px solid #ef4444' : entry.level === 'warn' ? '3px solid #f59e0b' : '3px solid #38bdf8',
                          borderRadius: '4px',
                          padding: '6px 8px',
                          fontSize: '11px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                          <span style={{
                            background: '#090d16',
                            color: entry.level === 'error' ? '#f87171' : '#38bdf8',
                            padding: '1px 5px',
                            borderRadius: '3px',
                            fontSize: '9px',
                            fontWeight: 800,
                          }}>
                            {entry.category}
                          </span>
                          <span style={{ color: '#64748b', fontSize: '10px' }}>{entry.timeFormatted}</span>
                        </div>
                        <div style={{ color: '#f1f5f9', marginTop: '2px', wordBreak: 'break-word' }}>
                          {entry.message}
                        </div>
                        {entry.details && (
                          <div style={{
                            marginTop: '4px',
                            padding: '4px 6px',
                            background: '#090d16',
                            borderRadius: '4px',
                            color: '#94a3b8',
                            fontSize: '10px',
                            maxHeight: '60px',
                            overflowY: 'auto',
                            fontFamily: 'monospace',
                          }}>
                            {typeof entry.details === 'object' ? JSON.stringify(entry.details) : String(entry.details)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: DATABASE TABLES */}
            {activeTab === 'tables' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontWeight: 700, color: '#f1f5f9' }}>Local Dexie IndexedDB Tables</span>
                  <button
                    onClick={loadTableCounts}
                    style={{
                      background: '#1e293b',
                      border: '1px solid #334155',
                      color: '#38bdf8',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontSize: '10px',
                      cursor: 'pointer',
                    }}
                  >
                    Refresh Counts
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {Object.entries(tableCounts).map(([tableName, count]) => (
                    <div
                      key={tableName}
                      style={{
                        background: '#1e293b',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid #334155',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontFamily: 'monospace', color: '#cbd5e1', fontSize: '11px' }}>{tableName}</span>
                      <span style={{
                        background: tableName === 'syncQueue' && count > 0 ? '#ef4444' : '#090d16',
                        color: tableName === 'syncQueue' && count > 0 ? 'white' : '#4ade80',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontWeight: 700,
                        fontSize: '11px',
                      }}>
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 4: BEGINNER GUIDE */}
            {activeTab === 'help' && (
              <div style={{ color: '#cbd5e1', lineHeight: '1.6', fontSize: '11px' }}>
                <div style={{ fontWeight: 800, color: '#38bdf8', fontSize: '13px', marginBottom: '6px' }}>
                  🚀 Quick Debugging Cheatsheet for Beginners
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <b style={{ color: '#f1f5f9' }}>1. Where does data live?</b><br />
                  Data is cached in your browser's local <b>IndexedDB (Dexie)</b> first, so the app stays fast and works offline. When online, changes sync to <b>Supabase PostgreSQL</b>.
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <b style={{ color: '#f1f5f9' }}>2. Why is my change not showing on another device?</b><br />
                  - Check if you have items queued in <b>Sync Queue</b>.<br />
                  - Check if both devices are looking at the same <b>Farm Workspace</b>.<br />
                  - Click <b>Force Sync Now</b> above to push queued items.
                </div>
                <div style={{ marginBottom: '10px' }}>
                  <b style={{ color: '#f1f5f9' }}>3. How do I inspect data in Chrome/Edge?</b><br />
                  Press <kbd>F12</kbd> &rarr; Go to <b>Application</b> tab &rarr; <b>IndexedDB</b> &rarr; <b>SwineSyncDB</b>. You can view raw records anytime!
                </div>
                <div>
                  <b style={{ color: '#f1f5f9' }}>4. See ARCHITECTURE.md and DEBUGGING.md</b><br />
                  Check the project root for full architecture diagrams and debugging workflows!
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
