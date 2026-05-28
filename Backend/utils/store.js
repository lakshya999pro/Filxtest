const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'uploads.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Initialize DB file
function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = { uploads: {}, logs: [] };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (err) {
    logger.error('Failed to load DB', { error: err.message });
    return { uploads: {}, logs: [] };
  }
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    logger.error('Failed to save DB', { error: err.message });
  }
}

const store = {
  isUploaded(videoId) {
    const db = loadDB();
    return !!db.uploads[videoId];
  },

  saveUpload(videoId, data) {
    const db = loadDB();
    db.uploads[videoId] = {
      ...data,
      uploadedAt: new Date().toISOString()
    };
    saveDB(db);
  },

  getUploads() {
    const db = loadDB();
    return Object.values(db.uploads);
  },

  addLog(entry) {
    const db = loadDB();
    db.logs.unshift({ ...entry, timestamp: new Date().toISOString() });
    // Keep only last 200 log entries
    if (db.logs.length > 200) db.logs = db.logs.slice(0, 200);
    saveDB(db);
  },

  getLogs(limit = 50) {
    const db = loadDB();
    return db.logs.slice(0, limit);
  },

  getStats() {
    const db = loadDB();
    const uploads = Object.values(db.uploads);
    return {
      total: uploads.length,
      success: uploads.filter(u => u.status === 'success').length,
      failed: uploads.filter(u => u.status === 'failed').length
    };
  }
};

module.exports = store;
