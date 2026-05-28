'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const axios   = require('axios');
const logger  = require('../utils/logger');
const store   = require('../utils/store');
const flow    = require('../utils/flowResolver');
const { EventEmitter } = require('events');

// ── Constants ─────────────────────────────────────────────────────────────────
const VIDEO_LIST_API        = 'https://tera-links-backend.dailyweb577.workers.dev/video-links';
const TURBOVI_UPLOAD_URL    = 'https://api.turboviplay.com/uploadUrl';

const API_KEY        = process.env.TURBOVIPLAY_API_KEY  || '';
const CONCURRENCY    = parseInt(process.env.QUEUE_CONCURRENCY || '2',    10);
const RETRY_ATTEMPTS = parseInt(process.env.RETRY_ATTEMPTS    || '3',    10);
const RETRY_DELAY    = parseInt(process.env.RETRY_DELAY_MS    || '5000', 10);
const SOURCE_PAGE    = parseInt(process.env.VIDEO_SOURCE_PAGE || '10',   10);
const UPLOAD_FOLDER  = process.env.UPLOAD_FOLDER        || 'video';

// ── State ─────────────────────────────────────────────────────────────────────
const emitter  = new EventEmitter();
let isRunning  = false;
let isPaused   = false;
let activeJobs = 0;
let queue      = [];
let currentVideo = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function emit(event, data) { emitter.emit(event, data); }

function log(level, message, meta = {}) {
  logger[level](message, meta);
  store.addLog({ level, message, ...meta });
  emit('log', { level, message, ...meta, timestamp: new Date().toISOString() });
}

// ── Pipeline Steps ────────────────────────────────────────────────────────────

/** Step 1 — Fetch video list from source API */
async function fetchVideoList(page = SOURCE_PAGE) {
  log('info', `Fetching video list from page ${page}…`);
  const res = await axios.get(VIDEO_LIST_API, { params: { page }, timeout: 15000 });
  if (!res.data?.success || !Array.isArray(res.data?.data)) {
    throw new Error('Invalid video list response');
  }
  log('info', `Fetched ${res.data.data.length} videos from page ${page}`);
  return res.data.data;
}

/**
 * Step 2 — Resolve direct video URL via FlowVideoPlayer API.
 *
 * Flow:
 *   POST /api/generateTokenNew  → get app_secret_key + token  (auto-cached)
 *   POST /api/v2/getVideoNew    → get stream_url / fast_stream_url
 *
 * Returns the best URL: fast_stream_url > stream_url > download_url
 */
async function getDirectVideoUrl(teraboxUrl) {
  log('info', `[resolver] Resolving: ${teraboxUrl}`);
  const result = await flow.resolveWithFlowPlayer(teraboxUrl);
  log('info', `[resolver] ✓ Got URL (${result.fileSize || '?'}): ${result.videoUrl.slice(0, 90)}`);
  return result.videoUrl;
}

/** Step 3 — Upload video URL to TurboViPlay */
async function uploadVideoUrl(directVideoUrl, title) {
  log('info', `Uploading to TurboViPlay: ${title}`);
  const res = await axios.get(TURBOVI_UPLOAD_URL, {
    params: { keyApi: API_KEY, url: directVideoUrl, nameFolder: UPLOAD_FOLDER },
    timeout: 60000
  });
  if (!res.data) throw new Error('Empty upload response from TurboViPlay');
  log('info', `Upload response received`, { status: res.data.status, msg: res.data.msg });
  return res.data;
}

// ── Retry Wrapper ─────────────────────────────────────────────────────────────
async function withRetry(fn, label, attempts = RETRY_ATTEMPTS) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts) throw err;
      const wait = RETRY_DELAY * i; // exponential back-off
      log('warn', `${label} failed (attempt ${i}/${attempts}), retrying in ${wait}ms…`, { error: err.message });
      await sleep(wait);
    }
  }
}

// ── Process Single Video ──────────────────────────────────────────────────────
async function processVideo(video) {
  const { id, link, title, thumbnail } = video;

  if (store.isUploaded(id)) {
    log('info', `Skipping duplicate: [${id}] ${title}`);
    return;
  }

  currentVideo = { id, title, thumbnail, status: 'processing', startedAt: new Date().toISOString() };
  emit('currentVideo', currentVideo);

  try {
    // Step 2: resolve direct URL via FlowVideoPlayer
    const directUrl = await withRetry(
      () => getDirectVideoUrl(link),
      `resolve(${id})`
    );

    // Step 3: upload to TurboViPlay
    const uploadResult = await withRetry(
      () => uploadVideoUrl(directUrl, title),
      `upload(${id})`
    );

    const record = { id, title, thumbnail, teraboxLink: link, directUrl, uploadResult, status: 'success' };
    store.saveUpload(id, record);
    log('info', `✅ Uploaded successfully: [${id}] ${title}`, { uploadResult });
    emit('uploadSuccess', record);

  } catch (err) {
    const record = { id, title, thumbnail, teraboxLink: link, status: 'failed', error: err.message };
    store.saveUpload(id, record);
    log('error', `❌ Failed to upload: [${id}] ${title}`, { error: err.message });
    emit('uploadFailed', record);
  } finally {
    currentVideo = null;
    emit('currentVideo', null);
  }
}

// ── Queue Runner ──────────────────────────────────────────────────────────────
async function runQueue() {
  while (isRunning && queue.length > 0) {
    if (isPaused)             { await sleep(1000); continue; }
    if (activeJobs >= CONCURRENCY) { await sleep(500);  continue; }

    const video = queue.shift();
    activeJobs++;
    emit('queueUpdate', { remaining: queue.length, active: activeJobs });

    processVideo(video).finally(() => {
      activeJobs--;
      emit('queueUpdate', { remaining: queue.length, active: activeJobs });
    });

    await sleep(300); // stagger starts
  }

  while (activeJobs > 0) await sleep(500);

  if (isRunning) {
    log('info', '🎉 All videos in queue processed!');
    isRunning = false;
    emit('done', { stats: store.getStats() });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
const uploadService = {
  emitter,

  getStatus() {
    return {
      isRunning,
      isPaused,
      activeJobs,
      queued: queue.length,
      currentVideo,
      stats: store.getStats(),
      tokenStatus: flow.getTokenStatus(),
    };
  },

  async start(page) {
    if (isRunning) return { ok: false, message: 'Already running' };

    if (!API_KEY || API_KEY === 'your_api_key_here') {
      log('error', 'API key not configured in .env');
      return { ok: false, message: 'Add TURBOVIPLAY_API_KEY to your .env file.' };
    }

    isRunning = true;
    isPaused  = false;
    log('info', '🚀 Starting upload pipeline…');
    emit('started', {});

    try {
      // Pre-fetch token before the queue starts (fail fast, fail clearly)
      log('info', 'Pre-fetching FlowVideoPlayer token…');
      await flow.fetchToken();

      const videos    = await fetchVideoList(page || SOURCE_PAGE);
      const newVideos = videos.filter(v => !store.isUploaded(v.id));
      log('info', `${newVideos.length} new videos queued (${videos.length - newVideos.length} already uploaded)`);
      queue = [...newVideos];
      emit('queueUpdate', { remaining: queue.length, active: activeJobs });
      runQueue();
      return { ok: true, message: `Started. ${newVideos.length} videos queued.` };
    } catch (err) {
      isRunning = false;
      log('error', 'Startup failed', { error: err.message });
      emit('error', { message: err.message });
      return { ok: false, message: err.message };
    }
  },

  stop() {
    isRunning = false;
    isPaused  = false;
    queue     = [];
    log('info', '⛔ Pipeline stopped by user');
    emit('stopped', {});
    return { ok: true, message: 'Stopped' };
  },

  pause() {
    if (!isRunning) return { ok: false, message: 'Not running' };
    isPaused = true;
    log('info', '⏸ Pipeline paused');
    emit('paused', {});
    return { ok: true, message: 'Paused' };
  },

  resume() {
    if (!isRunning) return { ok: false, message: 'Not running' };
    isPaused = false;
    log('info', '▶️ Pipeline resumed');
    emit('resumed', {});
    return { ok: true, message: 'Resumed' };
  },

  refreshToken() {
    flow.invalidateToken();
    return { ok: true, message: 'Token cache cleared — will refresh on next request' };
  },
};

module.exports = uploadService;
      
