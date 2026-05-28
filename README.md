# TeraBox Auto Uploader 📦

A fully automated system that fetches TeraBox video links, resolves their direct download URLs, and uploads them to TurboViPlay — with a real-time monitoring dashboard.

---

## ✨ Features

- 🔄 **Fully automatic pipeline** — Fetch → Resolve → Upload → Log
- 📊 **Real-time dashboard** via Server-Sent Events (no polling needed)
- 🛡️ **Duplicate prevention** — skips already-uploaded videos
- 🔁 **Retry system** — exponential back-off on failure
- 🧵 **Queue with concurrency control** — configurable parallel uploads
- ⏸ **Pause / Resume / Stop** controls
- 💾 **Persistent storage** — all results saved to JSON
- 📋 **Scrollable live log console** in the dashboard

---

## 📁 Project Structure

```
/project
├── backend/
│   ├── server.js              # Express server entry point
│   ├── routes/
│   │   └── api.js             # All API routes + SSE endpoint
│   ├── services/
│   │   └── uploadService.js   # Core pipeline logic + queue
│   ├── utils/
│   │   ├── logger.js          # Winston logger
│   │   └── store.js           # JSON file-based data store
│   ├── data/
│   │   └── uploads.json       # Auto-created on first run
│   └── logs/
│       ├── combined.log       # All logs
│       └── error.log          # Errors only
├── frontend/
│   └── index.html             # Single-file dashboard
├── .env                       # Your config (add API key here)
├── .env.example               # Template
├── package.json
└── README.md
```

---

## 🚀 Installation

### 1. Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- npm (comes with Node.js)

### 2. Clone / Download the project

```bash
cd project
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure your API key

Open `.env` and replace the placeholder:

```env
TURBOVIPLAY_API_KEY=your_actual_api_key_here
```

All available options:

| Variable              | Default  | Description                              |
|-----------------------|----------|------------------------------------------|
| `TURBOVIPLAY_API_KEY` | —        | **Required.** Your TurboViPlay API key   |
| `PORT`                | `3000`   | Port the server runs on                  |
| `QUEUE_CONCURRENCY`   | `2`      | Max parallel uploads                     |
| `RETRY_ATTEMPTS`      | `3`      | How many times to retry a failed upload  |
| `RETRY_DELAY_MS`      | `5000`   | Base retry delay (multiplied by attempt) |
| `VIDEO_SOURCE_PAGE`   | `10`     | Which page to fetch from the video API   |
| `UPLOAD_FOLDER`       | `video`  | Folder name on TurboViPlay               |

### 5. Start the server

```bash
npm start
```

Or with auto-restart on changes (development):

```bash
npm run dev
```

### 6. Open the dashboard

```
http://localhost:3000
```

---

## 🎮 Usage

1. Open the dashboard at `http://localhost:3000`
2. Optionally change the **Page** number to fetch from a different page
3. Click **▶ Start** — the pipeline begins automatically:
   - Fetches the video list
   - Skips already-uploaded videos
   - Resolves direct URLs via TeraDiskPlayer
   - Uploads each video to TurboViPlay
4. Watch progress in real time:
   - Current video thumbnail + title
   - Live log console
   - Stats (total, success, failed, queue)
5. Use **⏸ Pause** to temporarily halt and **▶ Resume** to continue
6. Use **⏹ Stop** to cancel all processing

---

## 🔌 API Endpoints

| Method | Path             | Description                        |
|--------|------------------|------------------------------------|
| `POST` | `/api/start`     | Start the pipeline (body: `{page}`) |
| `POST` | `/api/stop`      | Stop and clear the queue           |
| `POST` | `/api/pause`     | Pause processing                   |
| `POST` | `/api/resume`    | Resume processing                  |
| `GET`  | `/api/status`    | Current system status              |
| `GET`  | `/api/uploads`   | All upload records                 |
| `GET`  | `/api/logs`      | Recent logs (add `?limit=N`)       |
| `GET`  | `/api/stats`     | Summary counts                     |
| `GET`  | `/api/events`    | SSE stream for real-time updates   |

---

## 🔧 Pipeline Flow

```
[Video List API]
       ↓
  Filter duplicates
       ↓
  Add to queue
       ↓  (concurrent, configurable)
[TeraDiskPlayer API]  → resolve direct URL
       ↓
[TurboViPlay Upload]  → upload by URL
       ↓
  Save result to JSON
       ↓
  Emit SSE event → Dashboard updates live
```

---

## 📝 Notes

- Results are saved in `backend/data/uploads.json` and survive server restarts
- Logs are written to `backend/logs/` as well as displayed in the dashboard
- The system will never re-upload a video with the same ID
- Retry uses exponential back-off: delay × attempt number
