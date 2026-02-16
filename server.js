const express = require('express');
const axios = require('axios');
const multer = require('multer');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() }); // Store file in RAM briefly

app.use(express.static('public'));

// Configuration - Keep your keys safe!
const SUPABASE_URL = "https://zrqeqghpjlycgdcofine.supabase.co";
const API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpycWVxZ2hwamx5Y2dkY29maW5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4OTg3MzIsImV4cCI6MjA3OTQ3NDczMn0.wWUp3WB9AqhcB6G2h2946p4Zc_U583CYJeDEIp4PJts";
const REFRESH_TOKEN = "2wuvwry6rjmb";
const FOLDER_ID = "b401af69-1451-448c-9e23-77c6227becfc";

app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send('No file uploaded.');

        // STEP 1: Get Access Token
        const authResponse = await axios.post(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, 
            { refresh_token: REFRESH_TOKEN },
            { headers: { 'apikey': API_KEY, 'Content-Type': 'application/json' } }
        );

        const accessToken = authResponse.data.access_token;

        // STEP 2: Upload File
        const timestamp = Math.floor(Date.now() / 1000);
        const fileName = `${timestamp}_${req.file.originalname}`;
        const uploadUrl = `${SUPABASE_URL}/storage/v1/object/novabox-files/${FOLDER_ID}/${fileName}`;

        const uploadResponse = await axios.post(uploadUrl, req.file.buffer, {
            headers: {
                'apikey': API_KEY,
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': req.file.mimetype
            }
        });

        // STEP 3: Generate Public Link
        // Based on your format: https://.../public/novabox-files/FOLDER_ID/FILENAME
        const publicLink = `${SUPABASE_URL}/storage/v1/object/public/novabox-files/${FOLDER_ID}/${fileName}`;

        res.json({
            success: true,
            downloadLink: publicLink,
            details: uploadResponse.data
        });

    } catch (error) {
        console.error(error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Upload failed' });
    }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
