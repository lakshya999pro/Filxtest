import express from 'express';
import multer from 'multer';
import fetch from 'node-fetch';
import cors from 'cors';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.static('public'));

// Constants from your request
const SUPABASE_URL = "https://zrqeqghpjlycgdcofine.supabase.co";
const API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpycWVxZ2hwamx5Y2dkY29maW5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4OTg3MzIsImV4cCI6MjA3OTQ3NDczMn0.wWUp3WB9AqhcB6G2h2946p4Zc_U583CYJeDEIp4PJts";
const REFRESH_TOKEN = "2wuvwry6rjmb";
const FOLDER_ID = "b401af69-1451-448c-9e23-77c6227becfc";

app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file provided' });

        // STEP 1: Exchange Refresh Token for Access Token
        const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
            method: 'POST',
            headers: {
                'apikey': API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ refresh_token: REFRESH_TOKEN })
        });
        
        const authData = await authRes.json();
        const accessToken = authData.access_token;

        if (!accessToken) throw new Error("Could not retrieve access token.");

        // STEP 2: Upload to Storage
        const timestamp = Math.floor(Date.now() / 1000);
        const fileName = `${timestamp}_${req.file.originalname}`;
        const uploadUrl = `${SUPABASE_URL}/storage/v1/object/novabox-files/${FOLDER_ID}/${fileName}`;

        const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'apikey': API_KEY,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': req.file.mimetype
            },
            body: req.file.buffer
        });

        const uploadData = await uploadRes.json();

        // STEP 3: Construct Public Link
        // Format: URL/storage/v1/object/public/BUCKET/FOLDER/FILENAME
        const publicLink = `${SUPABASE_URL}/storage/v1/object/public/novabox-files/${FOLDER_ID}/${fileName}`;

        res.json({
            success: true,
            link: publicLink,
            data: uploadData
        });

    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Kineflex Backend running on http://localhost:${PORT}`));
