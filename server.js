const express = require('express');
const axios = require('axios');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Cache for config data
let configCache = null;
let dataCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Fetch config from StreamFlix API
async function getConfig() {
    try {
        const response = await axios.get('https://api.streamflix.app/config/config-streamflixapp.json', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive'
            },
            timeout: 30000
        });
        configCache = response.data;
        return response.data;
    } catch (error) {
        console.error('Error fetching config:', error.message);
        // Return fallback config
        return {
            movies: ['https://example.com/fallback/'],
            tv: ['https://example.com/fallback/'],
            premium: ['https://example.com/fallback/'],
            download: ['https://example.com/fallback/'],
            latest: 1,
            banner: '',
            video: '',
            newApp: false,
            notice: false,
            title: 'Fallback',
            text: 'Using fallback configuration'
        };
    }
}

// Fetch all movies and TV shows data
async function getAllData() {
    const now = Date.now();
    if (dataCache && cacheTimestamp && (now - cacheTimestamp < CACHE_DURATION)) {
        return dataCache;
    }

    try {
        const response = await axios.get('https://api.streamflix.app/data.json', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive'
            },
            timeout: 30000
        });
        dataCache = response.data.data || [];
        cacheTimestamp = now;
        return dataCache;
    } catch (error) {
        console.error('Error fetching data:', error.message);
        return [];
    }
}

// WebSocket episode fetcher
function getEpisodesFromWebSocket(movieKey, totalSeasons = 1) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket('wss://s-apse1b-nss-210.asia-southeast1.firebasedatabase.app/.ws?ns=chilflix-410be-default-rtdb&v=5');
        const seasonsData = {};
        let currentSeason = 1;
        let expectedResponses = 0;
        let responsesReceived = 0;
        let seasonsCompleted = 0;
        let messageBuffer = '';

        const timeout = setTimeout(() => {
            ws.close();
            resolve(seasonsData);
        }, 30000); // 30 second timeout

        ws.on('open', () => {
            console.log('WebSocket opened, requesting', totalSeasons, 'seasons');
            const request = {
                t: 'd',
                d: {
                    a: 'q',
                    r: currentSeason,
                    b: {
                        p: `Data/${movieKey}/seasons/${currentSeason}/episodes`,
                        h: ''
                    }
                }
            };
            ws.send(JSON.stringify(request));
            console.log('Sent request for season', currentSeason);
        });

        ws.on('message', (data) => {
            const text = data.toString();
            console.log('Received:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));

            // Check if it's just a number (expected responses count)
            try {
                const number = parseInt(text.trim());
                if (!isNaN(number) && expectedResponses === 0) {
                    expectedResponses = number;
                    console.log('Expecting', expectedResponses, 'data responses for season', currentSeason);
                    return;
                }
            } catch (e) {
                // Not a number, continue
            }

            // Add to buffer and try to parse
            messageBuffer += text;

            try {
                const jsonData = JSON.parse(messageBuffer);
                messageBuffer = ''; // Clear buffer on successful parse

                if (jsonData.t === 'd' && jsonData.d) {
                    const d = jsonData.d;

                    // Check for completion status
                    if (d.r && d.b && d.b.s === 'ok') {
                        console.log('Received completion status for season', currentSeason);
                        seasonsCompleted++;
                        console.log(`Season ${currentSeason} complete via status (${seasonsCompleted}/${totalSeasons})`);

                        // Request next season if available
                        if (seasonsCompleted < totalSeasons) {
                            currentSeason++;
                            expectedResponses = 0;
                            responsesReceived = 0;

                            const request = {
                                t: 'd',
                                d: {
                                    a: 'q',
                                    r: currentSeason,
                                    b: {
                                        p: `Data/${movieKey}/seasons/${currentSeason}/episodes`,
                                        h: ''
                                    }
                                }
                            };
                            ws.send(JSON.stringify(request));
                            console.log('Requesting season', currentSeason);
                        } else {
                            // All seasons completed
                            console.log('All', totalSeasons, 'seasons completed');
                            clearTimeout(timeout);
                            ws.close();
                            resolve(seasonsData);
                        }
                        return;
                    }

                    // Parse episode data
                    if (d.b && d.b.d) {
                        const episodes = d.b.d;
                        const pathMatch = d.b.p ? d.b.p.match(/seasons\/(\d+)\/episodes/) : null;
                        const seasonNumber = pathMatch ? parseInt(pathMatch[1]) : currentSeason;

                        const episodeMap = {};
                        Object.keys(episodes).forEach(key => {
                            const episode = episodes[key];
                            episodeMap[parseInt(key)] = {
                                key: episode.key,
                                link: episode.link,
                                name: episode.name,
                                overview: episode.overview,
                                runtime: episode.runtime,
                                stillPath: episode.still_path,
                                voteAverage: episode.vote_average
                            };
                        });

                        if (Object.keys(episodeMap).length > 0) {
                            if (!seasonsData[seasonNumber]) {
                                seasonsData[seasonNumber] = {};
                            }
                            Object.assign(seasonsData[seasonNumber], episodeMap);
                            responsesReceived++;
                            console.log(`Added ${Object.keys(episodeMap).length} episodes for season ${seasonNumber} (${Object.keys(seasonsData[seasonNumber]).length} total) (${responsesReceived}/${expectedResponses})`);
                        }
                    }
                }
            } catch (e) {
                // JSON parsing failed, keep buffering
                if (messageBuffer.length > 100000) {
                    console.error('Message too large, clearing buffer');
                    messageBuffer = '';
                    clearTimeout(timeout);
                    ws.close();
                    resolve(seasonsData);
                }
            }
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error.message);
            clearTimeout(timeout);
            reject(error);
        });

        ws.on('close', () => {
            console.log('WebSocket closed');
            clearTimeout(timeout);
            resolve(seasonsData);
        });
    });
}

// API Routes

// Get home page data
app.get('/api/home', async (req, res) => {
    try {
        const data = await getAllData();
        const movies = data.filter(item => !item.isTV && item.moviename).slice(0, 20);
        const tvShows = data.filter(item => item.isTV && item.moviename).slice(0, 20);

        res.json({
            success: true,
            movies,
            tvShows
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all movies
app.get('/api/movies', async (req, res) => {
    try {
        const data = await getAllData();
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
        const movies = data.filter(item => !item.isTV && item.moviename);
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        
        res.json({
            success: true,
            movies: movies.slice(startIndex, endIndex),
            total: movies.length,
            page,
            totalPages: Math.ceil(movies.length / limit)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all TV shows
app.get('/api/tvshows', async (req, res) => {
    try {
        const data = await getAllData();
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        
        const tvShows = data.filter(item => item.isTV && item.moviename);
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        
        res.json({
            success: true,
            tvShows: tvShows.slice(startIndex, endIndex),
            total: tvShows.length,
            page,
            totalPages: Math.ceil(tvShows.length / limit)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Search
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q?.toLowerCase() || '';
        if (!query) {
            return res.json({ success: true, results: [] });
        }

        const data = await getAllData();
        const results = data.filter(item => 
            item.moviename && item.moviename.toLowerCase().includes(query)
        ).slice(0, 30);

        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get item details
app.get('/api/item/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const data = await getAllData();
        const item = data.find(i => i.moviekey === key);

        if (!item) {
            return res.status(404).json({ success: false, error: 'Item not found' });
        }

        res.json({ success: true, item });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get episodes for TV show
app.get('/api/episodes/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const seasons = parseInt(req.query.seasons) || 1;

        console.log('Fetching episodes for', key, 'with', seasons, 'seasons');
        const episodesData = await getEpisodesFromWebSocket(key, seasons);

        res.json({ success: true, episodes: episodesData });
    } catch (error) {
        console.error('Error fetching episodes:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get video links
app.get('/api/links/:type/:path(*)', async (req, res) => {
    try {
        const { type, path } = req.params;
        const config = configCache || await getConfig();

        const links = [];

        if (type === 'movie') {
            // Movie links
            config.premium?.forEach(baseUrl => {
                links.push({
                    quality: '720p',
                    type: 'Premium',
                    url: baseUrl + path
                });
            });

            config.movies?.forEach(baseUrl => {
                links.push({
                    quality: '480p',
                    type: 'Movies',
                    url: baseUrl + path
                });
            });
        } else if (type === 'tv') {
            // TV show links
            config.premium?.forEach(baseUrl => {
                links.push({
                    quality: '720p',
                    type: 'Premium',
                    url: baseUrl + path
                });
            });

            config.tv?.forEach(baseUrl => {
                links.push({
                    quality: '480p',
                    type: 'TV',
                    url: baseUrl + path
                });
            });
        }

        config.download?.forEach(baseUrl => {
            links.push({
                quality: 'Download',
                type: 'Download',
                url: baseUrl + path
            });
        });

        res.json({ success: true, links });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Serve HTML pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/movies', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'movies.html'));
});

app.get('/tvshows', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'tvshows.html'));
});

app.get('/movie/:key', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'details.html'));
});

app.get('/tvshow/:key', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'details.html'));
});

app.get('/download/:key', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'download.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`StreamFlix server running on http://localhost:${PORT}`);
    console.log('Initializing cache...');
    getConfig();
    getAllData();
});
