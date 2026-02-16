import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import fs from "fs";
import cors from "cors";

const app = express();
app.use(cors());

// upload temp folder
const upload = multer({ dest: "uploads/" });

// 🔐 CONFIG (CHANGE THESE)
const SUPABASE_URL = "https://zrqeqghpjlycgdcofine.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsImtpZCI6IkprOXlDRlhEQk5zbGMxSlUiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3pycWVxZ2hwamx5Y2dkY29maW5lLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJiNDAxYWY2OS0xNDUxLTQ0OGMtOWUyMy03N2M2MjI3YmVjZmMiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzcxMjU4ODcyLCJpYXQiOjE3NzEyNTUyNzIsImVtYWlsIjoiYmF0ejlwcm9AZ21haWwuY29tIiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJlbWFpbCIsInByb3ZpZGVycyI6WyJlbWFpbCJdfSwidXNlcl9tZXRhZGF0YSI6eyJlbWFpbCI6ImJhdHo5cHJvQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJwaG9uZV92ZXJpZmllZCI6ZmFsc2UsInN1YiI6ImI0MDFhZjY5LTE0NTEtNDQ4Yy05ZTIzLTc3YzYyMjdiZWNmYyJ9LCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImFhbCI6ImFhbDEiLCJhbXIiOlt7Im1ldGhvZCI6InBhc3N3b3JkIiwidGltZXN0YW1wIjoxNzcxMjEwODEyfV0sInNlc3Npb25faWQiOiJkY2YyZjcwNS1iNTI2LTQ5NDAtODRmNS05MDM4Yzg0OWRjOTgiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.LzudTzxb5pFT25J1InWV5Hc1K197_RAhI-MN3sb91v4"; // backend only
const BUCKET = "novabox-files";
const OWNER_ID = "b401af69-1451-448c-9e23-77c6227becfc";

// 📤 upload endpoint
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file" });

    const filename = `${Date.now()}_${file.originalname}`;
    const path = `${OWNER_ID}/${filename}`;

    const buffer = fs.readFileSync(file.path);

    const r = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": file.mimetype
        },
        body: buffer
      }
    );

    const data = await r.json();
    fs.unlinkSync(file.path);

    if (!r.ok) return res.status(400).json(data);

    const publicUrl =
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

    res.json({
      success: true,
      key: data.Key,
      url: publicUrl
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3000, () =>
  console.log("✅ Server running → http://localhost:3000")
);
