const express = require('express');
const router  = express.Router();
const uploadService = require('../services/uploadService');
const store = require('../utils/store');

// ── Control Routes ───────────────────────────────────────────────────────────

/** POST /api/start - Start the upload pipeline */
router.post('/start', async (req, res) => {
  const { page } = req.body;
  const result = await uploadService.start(page);
  res.json(result);
});

/** POST /api/stop - Stop the upload pipeline */
router.post('/stop', (req, res) => {
  res.json(uploadService.stop());
});

/** POST /api/pause - Pause processing */
router.post('/pause', (req, res) => {
  res.json(uploadService.pause());
});

/** POST /api/resume - Resume processing */
router.post('/resume', (req, res) => {
  res.json(uploadService.resume());
});

/** POST /api/refresh-token - Force refresh of FlowVideoPlayer auth token */
router.post('/refresh-token', (req, res) => {
  res.json(uploadService.refreshToken());
});

/** GET /api/token-status - Check FlowVideoPlayer token cache state */
router.get('/token-status', (req, res) => {
  const flow = require('../utils/flowResolver');
  res.json({ success: true, data: flow.getTokenStatus() });
});

// ── Data Routes ──────────────────────────────────────────────────────────────

/** GET /api/status - Current system status */
router.get('/status', (req, res) => {
  res.json(uploadService.getStatus());
});

/** GET /api/uploads - All upload records */
router.get('/uploads', (req, res) => {
  const uploads = store.getUploads();
  res.json({ success: true, data: uploads, total: uploads.length });
});

/** GET /api/logs - Recent logs */
router.get('/logs', (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  res.json({ success: true, data: store.getLogs(limit) });
});

/** GET /api/stats - Summary stats */
router.get('/stats', (req, res) => {
  res.json({ success: true, data: store.getStats() });
});

// ── SSE Route ────────────────────────────────────────────────────────────────

/** GET /api/events - Server-Sent Events for real-time updates */
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send initial state
  send('status', uploadService.getStatus());

  // Register listeners
  const handlers = {
    log:          d => send('log', d),
    currentVideo: d => send('currentVideo', d),
    queueUpdate:  d => send('queueUpdate', d),
    uploadSuccess:d => send('uploadSuccess', d),
    uploadFailed: d => send('uploadFailed', d),
    started:      d => send('started', d),
    stopped:      d => send('stopped', d),
    paused:       d => send('paused', d),
    resumed:      d => send('resumed', d),
    done:         d => send('done', d),
    error:        d => send('error', d)
  };

  Object.entries(handlers).forEach(([event, fn]) => {
    uploadService.emitter.on(event, fn);
  });

  // Heartbeat every 25s to keep connection alive
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    Object.entries(handlers).forEach(([event, fn]) => {
      uploadService.emitter.off(event, fn);
    });
  });
});

module.exports = router;

