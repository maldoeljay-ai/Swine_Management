/**
 * @file src/utils/logger.js
 * @description Centralized Debug Logger for SwineSync.
 *
 * Designed for beginners and developers to easily trace application state,
 * database queries, network synchronization, authentication, and notifications.
 *
 * Features:
 * - Visually distinct colored tags in the browser DevTools console
 * - Ring-buffer memory storage of the last 150 log entries
 * - Subscription listener for the in-app DevDebugBar
 * - Global window helper: inspect via `window.__swineSyncLogger.getLogs()` in DevTools
 */

const MAX_LOG_HISTORY = 150;
const logHistory = [];
const subscribers = new Set();

// Color palette for browser DevTools console badges
const CATEGORY_STYLES = {
  AUTH: 'background: #3b82f6; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;',
  DATA: 'background: #10b981; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;',
  SYNC: 'background: #f59e0b; color: #1e293b; padding: 2px 6px; border-radius: 4px; font-weight: bold;',
  REALTIME: 'background: #8b5cf6; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;',
  NOTIF: 'background: #ec4899; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;',
  UI: 'background: #64748b; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;',
  ERROR: 'background: #ef4444; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;',
};

function pushToHistory(entry) {
  logHistory.push(entry);
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory.shift();
  }
  // Notify UI subscribers (e.g., in-app debug HUD)
  subscribers.forEach((callback) => {
    try {
      callback(entry, [...logHistory]);
    } catch (_) {
      // Ignore listener errors to protect the main app
    }
  });
}

function createLogEntry(level, category, message, details) {
  const timestamp = new Date();
  const timeFormatted = timestamp.toLocaleTimeString();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    timestamp,
    timeFormatted,
    level,
    category,
    message,
    details,
  };

  pushToHistory(entry);

  // Output to browser console with pretty styling
  const style = CATEGORY_STYLES[category] || CATEGORY_STYLES.UI;
  const badge = `%c[${category}]%c ${timeFormatted} - ${message}`;

  if (level === 'error') {
    if (details !== undefined) {
      console.error(badge, style, 'color: inherit;', details);
    } else {
      console.error(badge, style, 'color: inherit;');
    }
  } else if (level === 'warn') {
    if (details !== undefined) {
      console.warn(badge, style, 'color: inherit;', details);
    } else {
      console.warn(badge, style, 'color: inherit;');
    }
  } else {
    if (details !== undefined) {
      console.log(badge, style, 'color: inherit;', details);
    } else {
      console.log(badge, style, 'color: inherit;');
    }
  }

  return entry;
}

export const logger = {
  /**
   * Log authentication events (login, logout, session init, token changes)
   */
  auth: (message, details) => createLogEntry('info', 'AUTH', message, details),

  /**
   * Log database queries and mutations (getAll, getById, insert, update, delete)
   */
  data: (message, details) => createLogEntry('info', 'DATA', message, details),

  /**
   * Log background offline-first sync operations (queueing, processing, retries)
   */
  sync: (message, details) => createLogEntry('info', 'SYNC', message, details),

  /**
   * Log Supabase Realtime channel events (incoming live changes from server)
   */
  realtime: (message, details) => createLogEntry('info', 'REALTIME', message, details),

  /**
   * Log alerts, notifications, and scheduled triggers
   */
  notif: (message, details) => createLogEntry('info', 'NOTIF', message, details),

  /**
   * Log UI navigation, tab switches, and modal interactions
   */
  ui: (message, details) => createLogEntry('info', 'UI', message, details),

  /**
   * Log general warnings with context
   */
  warn: (category, message, details) => createLogEntry('warn', category, message, details),

  /**
   * Log errors with failure context
   */
  error: (category, message, error) => createLogEntry('error', category, message, error),

  /**
   * Retrieve the in-memory array of recent log entries
   */
  getLogs: () => [...logHistory],

  /**
   * Clear the in-memory log history
   */
  clearLogs: () => {
    logHistory.length = 0;
    subscribers.forEach((cb) => {
      try {
        cb(null, []);
      } catch (_) {}
    });
  },

  /**
   * Subscribe a component (like DevDebugBar) to live log events
   * @param {Function} callback - Called with (newEntry, allEntries)
   * @returns {Function} unsubscribe function
   */
  subscribe: (callback) => {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  },
};

// Expose on window object for beginner DevTools access
if (typeof window !== 'undefined') {
  window.__swineSyncLogger = logger;
}

export default logger;
