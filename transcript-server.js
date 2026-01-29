// YouTube Transcript Server
// Run with: node transcript-server.js
// First time: npm install

// Load environment variables from .env file
require('dotenv').config();

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// API Keys from environment (check that they're not placeholder values)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('your_')
    ? process.env.GEMINI_API_KEY
    : null;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY && !process.env.YOUTUBE_API_KEY.includes('your_')
    ? process.env.YOUTUBE_API_KEY
    : null;

// Use environment port (Railway) or default to 3456
const PORT = process.env.PORT || 3456;

// Static file serving configuration
const STATIC_DIR = __dirname;
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

// =============================================
// AUTHENTICATION SYSTEM
// =============================================

// Data directory paths - use RAILWAY_VOLUME_MOUNT_PATH if available (for persistent storage)
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'data')
    : path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// Rate limiting for login attempts
const loginAttempts = new Map(); // Map<ip_or_username, {count, lockedUntil}>
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Session duration: 30 days
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

// Ensure data directories exist
function ensureDataDirs() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log('📁 Created data directory');
    }
}

// Read users from file
function readUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Error reading users:', e.message);
    }
    return {};
}

// Write users to file
function writeUsers(users) {
    try {
        ensureDataDirs();
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        return true;
    } catch (e) {
        console.error('Error writing users:', e.message);
        return false;
    }
}

// Read sessions from file
function readSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Error reading sessions:', e.message);
    }
    return {};
}

// Write sessions to file
function writeSessions(sessions) {
    try {
        ensureDataDirs();
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
        return true;
    } catch (e) {
        console.error('Error writing sessions:', e.message);
        return false;
    }
}

// Clean expired sessions
function cleanExpiredSessions() {
    const sessions = readSessions();
    const now = Date.now();
    let cleaned = false;

    for (const [token, session] of Object.entries(sessions)) {
        if (session.expiresAt < now) {
            delete sessions[token];
            cleaned = true;
        }
    }

    if (cleaned) {
        writeSessions(sessions);
        console.log('🧹 Cleaned expired sessions');
    }
}

// Create session for user
function createSession(userId) {
    const sessions = readSessions();
    const token = uuidv4();
    const expiresAt = Date.now() + SESSION_DURATION_MS;

    sessions[token] = { userId, expiresAt, createdAt: Date.now() };
    writeSessions(sessions);

    return { token, expiresAt };
}

// Validate session token and return userId
function validateSession(token) {
    if (!token) return null;

    const sessions = readSessions();
    const session = sessions[token];

    if (!session) return null;
    if (session.expiresAt < Date.now()) {
        // Clean up expired session
        delete sessions[token];
        writeSessions(sessions);
        return null;
    }

    return session.userId;
}

// Delete session (logout)
function deleteSession(token) {
    const sessions = readSessions();
    if (sessions[token]) {
        delete sessions[token];
        writeSessions(sessions);
        return true;
    }
    return false;
}

// Get user data directory
function getUserDataDir(userId) {
    return path.join(DATA_DIR, 'users', userId);
}

// Check if user is admin (by username)
function isAdminUser(userId) {
    const users = readUsers();
    const user = users[userId];
    return user?.username?.toLowerCase() === 'absolute0net';
}

// Read user watch time
function readUserWatchTime(userId) {
    try {
        const filePath = path.join(getUserDataDir(userId), 'watchtime.json');
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error(`Error reading watch time for user ${userId}:`, e.message);
    }
    return {};
}

// Write user watch time
function writeUserWatchTime(userId, watchTime) {
    try {
        ensureUserDataDir(userId);
        const filePath = path.join(getUserDataDir(userId), 'watchtime.json');
        fs.writeFileSync(filePath, JSON.stringify(watchTime, null, 2));
        return true;
    } catch (e) {
        console.error(`Error writing watch time for user ${userId}:`, e.message);
        return false;
    }
}

// Get admin stats for all users
function getAdminStats() {
    const users = readUsers();
    const userStats = [];
    let totalVideos = 0;
    let totalNotes = 0;
    let totalWatchTime = 0;

    for (const [userId, user] of Object.entries(users)) {
        const bookmarks = readUserBookmarks(userId);
        const watchTime = readUserWatchTime(userId);

        // Calculate video and note counts
        const videoCount = bookmarks.length;
        let noteCount = 0;
        bookmarks.forEach(video => {
            noteCount += (video.notes || []).length;
        });

        // Calculate total watch time for this user
        const userWatchTime = Object.values(watchTime).reduce((sum, seconds) => sum + seconds, 0);

        totalVideos += videoCount;
        totalNotes += noteCount;
        totalWatchTime += userWatchTime;

        userStats.push({
            userId,
            username: user.username,
            createdAt: user.createdAt,
            videoCount,
            noteCount,
            watchTime: userWatchTime
        });
    }

    // Sort by creation date (newest first)
    userStats.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    return {
        totalUsers: Object.keys(users).length,
        totalVideos,
        totalNotes,
        totalWatchTime,
        users: userStats
    };
}

// Ensure user data directory exists
function ensureUserDataDir(userId) {
    const userDir = getUserDataDir(userId);
    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
        console.log(`📁 Created user data directory for ${userId}`);
    }
    return userDir;
}

// Read user bookmarks
function readUserBookmarks(userId) {
    try {
        const filePath = path.join(getUserDataDir(userId), 'bookmarks.json');
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error(`Error reading bookmarks for user ${userId}:`, e.message);
    }
    return [];
}

// Write user bookmarks
function writeUserBookmarks(userId, bookmarks) {
    try {
        ensureUserDataDir(userId);
        const filePath = path.join(getUserDataDir(userId), 'bookmarks.json');
        fs.writeFileSync(filePath, JSON.stringify(bookmarks, null, 2));
        return true;
    } catch (e) {
        console.error(`Error writing bookmarks for user ${userId}:`, e.message);
        return false;
    }
}

// Read user categories
function readUserCategories(userId) {
    try {
        const filePath = path.join(getUserDataDir(userId), 'categories.json');
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error(`Error reading categories for user ${userId}:`, e.message);
    }
    return [];
}

// Write user categories
function writeUserCategories(userId, categories) {
    try {
        ensureUserDataDir(userId);
        const filePath = path.join(getUserDataDir(userId), 'categories.json');
        fs.writeFileSync(filePath, JSON.stringify(categories, null, 2));
        return true;
    } catch (e) {
        console.error(`Error writing categories for user ${userId}:`, e.message);
        return false;
    }
}

// Check if this is the first user (for migration)
function isFirstUser() {
    const users = readUsers();
    return Object.keys(users).length === 0;
}

// Migrate legacy data to first user
function migrateLegacyData(userId) {
    const legacyBookmarks = BOOKMARKS_FILE;
    const legacyCategories = CATEGORIES_FILE;

    // Check if legacy files exist and haven't been migrated
    if (fs.existsSync(legacyBookmarks) && !fs.existsSync(legacyBookmarks + '.legacy')) {
        try {
            const bookmarks = JSON.parse(fs.readFileSync(legacyBookmarks, 'utf8'));
            if (Array.isArray(bookmarks) && bookmarks.length > 0) {
                writeUserBookmarks(userId, bookmarks);
                fs.renameSync(legacyBookmarks, legacyBookmarks + '.legacy');
                console.log(`📦 Migrated ${bookmarks.length} legacy bookmarks to user ${userId}`);
            }
        } catch (e) {
            console.error('Error migrating legacy bookmarks:', e.message);
        }
    }

    if (fs.existsSync(legacyCategories) && !fs.existsSync(legacyCategories + '.legacy')) {
        try {
            const categories = JSON.parse(fs.readFileSync(legacyCategories, 'utf8'));
            if (Array.isArray(categories) && categories.length > 0) {
                writeUserCategories(userId, categories);
                fs.renameSync(legacyCategories, legacyCategories + '.legacy');
                console.log(`📦 Migrated ${categories.length} legacy categories to user ${userId}`);
            }
        } catch (e) {
            console.error('Error migrating legacy categories:', e.message);
        }
    }
}

// Rate limiting helpers
function getClientIdentifier(req, username = null) {
    // Use username if provided, otherwise use IP
    if (username) return `user:${username}`;
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
    return `ip:${ip}`;
}

function checkRateLimit(identifier) {
    const attempt = loginAttempts.get(identifier);
    if (!attempt) return { allowed: true };

    if (attempt.lockedUntil && attempt.lockedUntil > Date.now()) {
        const remainingMs = attempt.lockedUntil - Date.now();
        const remainingMins = Math.ceil(remainingMs / 60000);
        return {
            allowed: false,
            message: `Too many failed attempts. Try again in ${remainingMins} minute(s).`
        };
    }

    return { allowed: true };
}

function recordFailedLogin(identifier) {
    const attempt = loginAttempts.get(identifier) || { count: 0, lockedUntil: null };
    attempt.count++;

    if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
        attempt.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
        console.log(`🔒 Locked out ${identifier} for ${LOCKOUT_DURATION_MS / 60000} minutes`);
    }

    loginAttempts.set(identifier, attempt);
}

function clearFailedLogins(identifier) {
    loginAttempts.delete(identifier);
}

// Extract auth token from request
function extractAuthToken(req) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }
    return null;
}

// Authentication middleware - returns userId or null
function authenticateRequest(req) {
    const token = extractAuthToken(req);
    if (!token) return null;
    return validateSession(token);
}

// Validate username format
function isValidUsername(username) {
    return /^[a-zA-Z0-9_]{3,30}$/.test(username);
}

// Validate password strength
function isValidPassword(password) {
    return password && password.length >= 6;
}

// Path to yt-dlp binary (check multiple locations)
const YT_DLP_PATHS = [
    path.join(__dirname, 'yt-dlp'),  // Project directory (preferred)
    '/tmp/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    'yt-dlp'  // Will use PATH
];

function findYtDlp() {
    for (const ytdlpPath of YT_DLP_PATHS) {
        try {
            if (fs.existsSync(ytdlpPath)) {
                return ytdlpPath;
            }
        } catch (e) {
            // Continue checking
        }
    }
    return 'yt-dlp';  // Default to PATH
}

// File paths
const BOOKMARKS_FILE = path.join(__dirname, 'bookmarks.json');
const CATEGORIES_FILE = path.join(__dirname, 'categories.json');
const TRANSCRIPT_CACHE_FILE = path.join(__dirname, 'transcript-cache.json');

// Cache duration: 7 days in milliseconds
const CACHE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// Rate limiting: minimum delay between YouTube requests (in ms)
const MIN_REQUEST_DELAY = 2000;
let lastYouTubeRequest = 0;

// Transcript cache functions
function readTranscriptCache() {
    try {
        if (fs.existsSync(TRANSCRIPT_CACHE_FILE)) {
            const data = fs.readFileSync(TRANSCRIPT_CACHE_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Error reading transcript cache:', e.message);
    }
    return {};
}

function writeTranscriptCache(cache) {
    try {
        fs.writeFileSync(TRANSCRIPT_CACHE_FILE, JSON.stringify(cache, null, 2));
        return true;
    } catch (e) {
        console.error('Error writing transcript cache:', e.message);
        return false;
    }
}

function getCachedTranscript(videoId) {
    const cache = readTranscriptCache();
    const entry = cache[videoId];
    if (entry && entry.timestamp && entry.transcript) {
        const age = Date.now() - entry.timestamp;
        if (age < CACHE_DURATION_MS) {
            console.log(`✅ Cache hit for ${videoId} (age: ${Math.round(age / 1000 / 60)} minutes)`);
            return entry.transcript;
        } else {
            console.log(`⚠️ Cache expired for ${videoId} (age: ${Math.round(age / 1000 / 60 / 60)} hours)`);
        }
    }
    return null;
}

function cacheTranscript(videoId, transcript) {
    const cache = readTranscriptCache();
    cache[videoId] = {
        timestamp: Date.now(),
        transcript: transcript
    };
    writeTranscriptCache(cache);
    console.log(`💾 Cached transcript for ${videoId} (${transcript.length} segments)`);
}

// Wait for rate limiting
async function waitForRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastYouTubeRequest;
    if (timeSinceLastRequest < MIN_REQUEST_DELAY) {
        const waitTime = MIN_REQUEST_DELAY - timeSinceLastRequest;
        console.log(`⏳ Rate limiting: waiting ${waitTime}ms before next YouTube request`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    lastYouTubeRequest = Date.now();
}

// Read bookmarks from file
function readBookmarks() {
    try {
        if (fs.existsSync(BOOKMARKS_FILE)) {
            const data = fs.readFileSync(BOOKMARKS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Error reading bookmarks:', e.message);
    }
    return [];
}

// Write bookmarks to file
function writeBookmarks(bookmarks) {
    try {
        fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(bookmarks, null, 2));
        return true;
    } catch (e) {
        console.error('Error writing bookmarks:', e.message);
        return false;
    }
}

// Read categories from file
function readCategories() {
    try {
        if (fs.existsSync(CATEGORIES_FILE)) {
            const data = fs.readFileSync(CATEGORIES_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Error reading categories:', e.message);
    }
    return [];
}

// Write categories to file
function writeCategories(categories) {
    try {
        fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(categories, null, 2));
        return true;
    } catch (e) {
        console.error('Error writing categories:', e.message);
        return false;
    }
}

// Parse request body
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : null);
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

// Fetch URL helper
function fetchUrl(url, options = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const reqOptions = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ...options.headers
            }
        };

        const req = client.request(reqOptions, (res) => {
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchUrl(res.headers.location, options).then(resolve).catch(reject);
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
        });

        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

// Decode HTML entities
function decodeHtml(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/\\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Extract transcript using yt-dlp (more reliable)
async function getTranscriptYtDlp(videoId) {
    return new Promise((resolve, reject) => {
        const ytdlp = findYtDlp();
        const tempDir = '/tmp';
        const outputTemplate = path.join(tempDir, `yt-${videoId}`);
        const expectedFile = `${outputTemplate}.en.json3`;

        console.log(`Trying yt-dlp method with: ${ytdlp}`);

        // Clean up any existing file first
        try {
            if (fs.existsSync(expectedFile)) {
                fs.unlinkSync(expectedFile);
            }
        } catch (e) {
            // Ignore cleanup errors
        }

        const args = [
            '--skip-download',
            '--write-auto-sub',
            '--sub-lang', 'en',
            '--sub-format', 'json3',
            '-o', outputTemplate,
            `https://www.youtube.com/watch?v=${videoId}`
        ];

        execFile(ytdlp, args, { timeout: 30000 }, (error, stdout, stderr) => {
            if (error) {
                console.log('yt-dlp error:', error.message);
                console.log('yt-dlp stderr:', stderr);
                reject(new Error(`yt-dlp failed: ${error.message}`));
                return;
            }

            // Check for the output file
            if (!fs.existsSync(expectedFile)) {
                // Try without language code
                const altFile = `${outputTemplate}.json3`;
                if (fs.existsSync(altFile)) {
                    try {
                        const data = fs.readFileSync(altFile, 'utf8');
                        const transcript = parseJson3Transcript(data);
                        fs.unlinkSync(altFile);
                        resolve(transcript);
                        return;
                    } catch (e) {
                        reject(new Error('Failed to parse subtitle file'));
                        return;
                    }
                }
                reject(new Error('No subtitle file generated'));
                return;
            }

            try {
                const data = fs.readFileSync(expectedFile, 'utf8');
                const transcript = parseJson3Transcript(data);

                // Clean up temp file
                fs.unlinkSync(expectedFile);

                if (transcript.length > 0) {
                    console.log(`✅ yt-dlp got ${transcript.length} segments`);
                    resolve(transcript);
                } else {
                    reject(new Error('No transcript segments parsed from yt-dlp output'));
                }
            } catch (e) {
                reject(new Error(`Failed to parse yt-dlp output: ${e.message}`));
            }
        });
    });
}

// Parse json3 format from yt-dlp
function parseJson3Transcript(data) {
    try {
        const json = JSON.parse(data);
        const transcript = [];

        if (json.events) {
            for (const event of json.events) {
                if (event.segs && event.segs.length > 0) {
                    const text = event.segs.map(s => s.utf8 || '').join('').trim();
                    if (text && text !== '\n' && !text.match(/^\[.*\]$/)) {  // Skip [Music], [Applause] etc.
                        transcript.push({
                            start: (event.tStartMs || 0) / 1000,
                            duration: (event.dDurationMs || 2000) / 1000,
                            text: decodeHtml(text.replace(/\n/g, ' ').trim())
                        });
                    }
                }
            }
        }

        return transcript;
    } catch (e) {
        console.log('JSON3 parse error:', e.message);
        return [];
    }
}

// Extract transcript using innertube API
async function getTranscriptInnertube(videoId) {
    console.log('Trying innertube API method...');

    // First, get the page to extract necessary tokens and cookies
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const pageResponse = await fetchUrl(pageUrl);

    if (pageResponse.status !== 200) {
        throw new Error(`Failed to fetch YouTube page: ${pageResponse.status}`);
    }

    const html = pageResponse.data;

    // Extract cookies from response for subsequent requests
    const cookies = pageResponse.headers['set-cookie'];
    const cookieString = cookies ? (Array.isArray(cookies) ? cookies.map(c => c.split(';')[0]).join('; ') : cookies.split(';')[0]) : '';
    console.log('Got cookies:', cookieString ? 'yes' : 'no');

    // Check if video exists
    if (html.includes('"playabilityStatus":{"status":"ERROR"')) {
        throw new Error('Video not found or unavailable');
    }

    // Try to extract caption tracks directly from the page
    const captionTracksMatch = html.match(/"captionTracks":\s*(\[.*?\])\s*,\s*"/s);

    if (captionTracksMatch) {
        try {
            let tracksJson = captionTracksMatch[1];
            // Fix escaped characters
            tracksJson = tracksJson.replace(/\\u0026/g, '&').replace(/\\"/g, '"');

            const tracks = JSON.parse(tracksJson);
            console.log(`Found ${tracks.length} caption tracks`);

            if (tracks.length > 0) {
                // Find English track or use first available
                const track = tracks.find(t =>
                    t.languageCode === 'en' ||
                    t.languageCode?.startsWith('en')
                ) || tracks[0];

                console.log(`Using track: ${track.languageCode} - ${track.name?.simpleText || 'unnamed'}`);

                let captionUrl = track.baseUrl;
                captionUrl = captionUrl.replace(/\\u0026/g, '&');

                // Try fetching with cookies and different format parameters
                const formats = ['', '&fmt=json3', '&fmt=srv3'];

                for (const fmt of formats) {
                    const url = captionUrl + fmt;
                    console.log(`Trying URL with fmt='${fmt || 'default'}': ${url.substring(0, 80)}...`);

                    const captionResponse = await fetchUrl(url, {
                        headers: {
                            'Cookie': cookieString,
                            'Referer': pageUrl,
                        }
                    });
                    console.log(`Response: ${captionResponse.status}, length: ${captionResponse.data.length}`);

                    if (captionResponse.status === 200 && captionResponse.data.length > 100) {
                        const transcript = parseTranscriptData(captionResponse.data);
                        if (transcript.length > 0) {
                            return transcript;
                        }
                    }
                }
            }
        } catch (e) {
            console.log('Caption tracks parsing error:', e.message);
        }
    }

    // Alternative: Try YouTube's internal transcript endpoint via POST
    console.log('Trying innertube transcript endpoint...');

    // Extract API key from page
    const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    const apiKey = apiKeyMatch ? apiKeyMatch[1] : 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

    // Extract client version
    const clientVersionMatch = html.match(/"clientVersion":"([^"]+)"/);
    const clientVersion = clientVersionMatch ? clientVersionMatch[1] : '2.20240101.00.00';

    // Get serialized share entity for transcript params
    const engagementPanelMatch = html.match(/"engagementPanels".*?"serializedShareEntity":"([^"]+)"/s);

    // Try to get transcript via the get_transcript endpoint
    const transcriptPayload = {
        context: {
            client: {
                clientName: 'WEB',
                clientVersion: clientVersion,
            }
        },
        params: Buffer.from(`\n\x0b${videoId}`).toString('base64')
    };

    try {
        const transcriptResponse = await fetchUrl(
            `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': cookieString,
                    'Origin': 'https://www.youtube.com',
                    'Referer': pageUrl,
                },
                body: JSON.stringify(transcriptPayload)
            }
        );

        console.log(`Innertube transcript response: ${transcriptResponse.status}, length: ${transcriptResponse.data.length}`);

        if (transcriptResponse.status === 200 && transcriptResponse.data.length > 100) {
            try {
                const data = JSON.parse(transcriptResponse.data);
                const transcriptParts = data?.actions?.[0]?.updateEngagementPanelAction?.content
                    ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
                    ?.transcriptSegmentListRenderer?.initialSegments;

                if (transcriptParts && transcriptParts.length > 0) {
                    const transcript = transcriptParts.map(part => {
                        const seg = part.transcriptSegmentRenderer;
                        return {
                            start: parseInt(seg.startMs) / 1000,
                            duration: (parseInt(seg.endMs) - parseInt(seg.startMs)) / 1000,
                            text: seg.snippet?.runs?.map(r => r.text).join('') || ''
                        };
                    }).filter(t => t.text);

                    if (transcript.length > 0) {
                        console.log(`Got ${transcript.length} segments from innertube endpoint`);
                        return transcript;
                    }
                }
            } catch (e) {
                console.log('Innertube response parse error:', e.message);
            }
        }
    } catch (e) {
        console.log('Innertube transcript endpoint error:', e.message);
    }

    throw new Error('No captions found. The video may not have subtitles enabled.');
}

// Parse transcript data (handles multiple formats)
function parseTranscriptData(data) {
    const transcript = [];

    // Skip if empty
    if (!data || data.length < 50) {
        console.log('Data too short:', data.length);
        return [];
    }

    console.log('Data starts with:', data.substring(0, 100));

    // Try JSON format (json3)
    if (data.trim().startsWith('{')) {
        try {
            const json = JSON.parse(data);
            if (json.events) {
                for (const event of json.events) {
                    if (event.segs) {
                        const text = event.segs.map(s => s.utf8 || '').join('');
                        if (text.trim() && text !== '\n') {
                            transcript.push({
                                start: (event.tStartMs || 0) / 1000,
                                duration: (event.dDurationMs || 2000) / 1000,
                                text: decodeHtml(text)
                            });
                        }
                    }
                }
                console.log(`Parsed ${transcript.length} segments from JSON`);
                return transcript;
            }
        } catch (e) {
            console.log('JSON parse failed:', e.message);
        }
    }

    // Try XML srv3 format: <p t="123" d="456">text</p>
    const srv3Regex = /<p\s+t="(\d+)"(?:\s+d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    while ((match = srv3Regex.exec(data)) !== null) {
        const text = match[3].replace(/<[^>]+>/g, '').trim();
        if (text) {
            transcript.push({
                start: parseInt(match[1]) / 1000,
                duration: match[2] ? parseInt(match[2]) / 1000 : 2,
                text: decodeHtml(text)
            });
        }
    }

    if (transcript.length > 0) {
        console.log(`Parsed ${transcript.length} segments from srv3 XML`);
        return transcript;
    }

    // Try standard XML format: <text start="1.23" dur="4.56">text</text>
    const xmlRegex = /<text\s+start="([^"]+)"(?:\s+dur="([^"]+)")?[^>]*>([\s\S]*?)<\/text>/gi;
    while ((match = xmlRegex.exec(data)) !== null) {
        const text = match[3].replace(/<[^>]+>/g, '').trim();
        if (text) {
            transcript.push({
                start: parseFloat(match[1]),
                duration: match[2] ? parseFloat(match[2]) : 2,
                text: decodeHtml(text)
            });
        }
    }

    if (transcript.length > 0) {
        console.log(`Parsed ${transcript.length} segments from standard XML`);
        return transcript;
    }

    console.log('Could not parse data. Sample:', data.substring(0, 500));
    return [];
}

// Main transcript function
async function getTranscript(videoId) {
    // Validate video ID
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        throw new Error('Invalid video ID format');
    }

    // Check cache first
    const cached = getCachedTranscript(videoId);
    if (cached) {
        return cached;
    }

    // Apply rate limiting before making YouTube request
    await waitForRateLimit();

    // Try yt-dlp first (more reliable, handles YouTube rate limiting better)
    try {
        console.log('Attempting yt-dlp method first...');
        const transcript = await getTranscriptYtDlp(videoId);

        // Cache the result if successful
        if (transcript && transcript.length > 0) {
            cacheTranscript(videoId, transcript);
            return transcript;
        }
    } catch (ytdlpError) {
        console.log(`yt-dlp method failed: ${ytdlpError.message}`);
        console.log('Falling back to innertube method...');
    }

    // Fallback to innertube method
    try {
        const transcript = await getTranscriptInnertube(videoId);

        // Cache the result if successful
        if (transcript && transcript.length > 0) {
            cacheTranscript(videoId, transcript);
        }

        return transcript;
    } catch (error) {
        console.error('Transcript error:', error.message);
        throw error;
    }
}

// Clean expired sessions on startup
ensureDataDirs();
cleanExpiredSessions();

// Clean sessions periodically (every hour)
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

// Create the server
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    // =============================================
    // AUTHENTICATION ENDPOINTS
    // =============================================

    // Register new user
    if (url.pathname === '/auth/register' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { username, password } = body || {};

            // Validate input
            if (!username || !password) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Username and password are required' }));
                return;
            }

            if (!isValidUsername(username)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Username must be 3-30 alphanumeric characters or underscores' }));
                return;
            }

            if (!isValidPassword(password)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Password must be at least 6 characters' }));
                return;
            }

            const users = readUsers();

            // Check if username already exists
            const existingUser = Object.values(users).find(
                u => u.username.toLowerCase() === username.toLowerCase()
            );
            if (existingUser) {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Username already taken' }));
                return;
            }

            // Check if this is the first user (for legacy data migration)
            const firstUser = isFirstUser();

            // Hash password and create user
            const userId = uuidv4();
            const passwordHash = await bcrypt.hash(password, 10);

            users[userId] = {
                username,
                passwordHash,
                createdAt: Date.now()
            };

            if (!writeUsers(users)) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to create user' }));
                return;
            }

            // Create user data directory
            ensureUserDataDir(userId);

            // Migrate legacy data for first user
            if (firstUser) {
                migrateLegacyData(userId);
            }

            // Create session
            const { token, expiresAt } = createSession(userId);

            console.log(`👤 Registered new user: ${username} (${userId})${firstUser ? ' [first user - legacy data migrated]' : ''}`);

            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                token,
                userId,
                username,
                expiresAt
            }));
        } catch (e) {
            console.error('Registration error:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Registration failed' }));
        }
        return;
    }

    // Login
    if (url.pathname === '/auth/login' && req.method === 'POST') {
        try {
            const body = await parseBody(req);
            const { username, password } = body || {};

            if (!username || !password) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Username and password are required' }));
                return;
            }

            // Check rate limiting
            const ipIdentifier = getClientIdentifier(req);
            const userIdentifier = getClientIdentifier(req, username);

            const ipLimit = checkRateLimit(ipIdentifier);
            const userLimit = checkRateLimit(userIdentifier);

            if (!ipLimit.allowed) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: ipLimit.message }));
                return;
            }

            if (!userLimit.allowed) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: userLimit.message }));
                return;
            }

            const users = readUsers();

            // Find user by username (case-insensitive)
            const [userId, user] = Object.entries(users).find(
                ([, u]) => u.username.toLowerCase() === username.toLowerCase()
            ) || [];

            if (!user) {
                recordFailedLogin(ipIdentifier);
                recordFailedLogin(userIdentifier);
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid username or password' }));
                return;
            }

            // Verify password
            const validPassword = await bcrypt.compare(password, user.passwordHash);
            if (!validPassword) {
                recordFailedLogin(ipIdentifier);
                recordFailedLogin(userIdentifier);
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid username or password' }));
                return;
            }

            // Clear failed login attempts on success
            clearFailedLogins(ipIdentifier);
            clearFailedLogins(userIdentifier);

            // Create session
            const { token, expiresAt } = createSession(userId);

            console.log(`🔑 User logged in: ${user.username} (${userId})`);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                token,
                userId,
                username: user.username,
                expiresAt
            }));
        } catch (e) {
            console.error('Login error:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Login failed' }));
        }
        return;
    }

    // Logout
    if (url.pathname === '/auth/logout' && req.method === 'POST') {
        const token = extractAuthToken(req);
        if (token) {
            deleteSession(token);
            console.log('🚪 User logged out');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // Check authentication status
    if (url.pathname === '/auth/check' && req.method === 'GET') {
        const token = extractAuthToken(req);
        const userId = validateSession(token);

        if (userId) {
            const users = readUsers();
            const user = users[userId];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                valid: true,
                userId,
                username: user?.username || 'Unknown',
                isAdmin: isAdminUser(userId)
            }));
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ valid: false }));
        }
        return;
    }

    // =============================================
    // ADMIN ENDPOINTS (require admin authentication)
    // =============================================

    // Admin stats endpoint
    if (url.pathname === '/admin/stats' && req.method === 'GET') {
        const userId = authenticateRequest(req);

        if (!userId) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Authentication required' }));
            return;
        }

        if (!isAdminUser(userId)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Admin access required' }));
            return;
        }

        try {
            const stats = getAdminStats();
            console.log(`📊 Admin ${userId} requested stats: ${stats.totalUsers} users`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(stats));
        } catch (e) {
            console.error('Error getting admin stats:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to get stats' }));
        }
        return;
    }

    // Watch time tracking endpoint
    if (url.pathname === '/admin/watch-time' && req.method === 'POST') {
        const userId = authenticateRequest(req);

        if (!userId) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Authentication required' }));
            return;
        }

        try {
            const body = await parseBody(req);
            const { videoId, duration } = body || {};

            if (!videoId || typeof duration !== 'number' || duration < 0) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid videoId or duration' }));
                return;
            }

            // Read current watch time
            const watchTime = readUserWatchTime(userId);

            // Add to existing time for this video
            watchTime[videoId] = (watchTime[videoId] || 0) + Math.round(duration);

            // Save watch time
            if (writeUserWatchTime(userId, watchTime)) {
                console.log(`⏱️ User ${userId} watched ${videoId} for ${duration}s (total: ${watchTime[videoId]}s)`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, totalTime: watchTime[videoId] }));
            } else {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Failed to save watch time' }));
            }
        } catch (e) {
            console.error('Error saving watch time:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to save watch time' }));
        }
        return;
    }

    // =============================================
    // API PROXY ENDPOINTS (server-side API keys)
    // =============================================

    // Check API key availability (no auth required, just returns status)
    if (url.pathname === '/api/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            geminiConfigured: !!GEMINI_API_KEY,
            youtubeConfigured: !!YOUTUBE_API_KEY
        }));
        return;
    }

    // Gemini API proxy - requires authentication
    if (url.pathname === '/api/gemini' && req.method === 'POST') {
        const userId = authenticateRequest(req);

        if (!userId) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Authentication required' }));
            return;
        }

        if (!GEMINI_API_KEY) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Gemini API not configured on server' }));
            return;
        }

        try {
            const body = await parseBody(req);
            const { prompt, maxTokens = 2048, temperature = 0.3 } = body || {};

            if (!prompt) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Prompt is required' }));
                return;
            }

            // Call Gemini API
            const geminiResponse = await fetchUrl(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature, maxOutputTokens: maxTokens }
                    })
                }
            );

            if (geminiResponse.status !== 200) {
                console.error('Gemini API error:', geminiResponse.data);
                res.writeHead(geminiResponse.status, { 'Content-Type': 'application/json' });
                res.end(geminiResponse.data);
                return;
            }

            const geminiData = JSON.parse(geminiResponse.data);
            const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

            console.log(`🤖 Gemini API called by user ${userId}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ text: responseText }));
        } catch (e) {
            console.error('Gemini proxy error:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Gemini API request failed' }));
        }
        return;
    }

    // YouTube API proxy - requires authentication
    if (url.pathname === '/api/youtube/video' && req.method === 'GET') {
        const userId = authenticateRequest(req);

        if (!userId) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Authentication required' }));
            return;
        }

        if (!YOUTUBE_API_KEY) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'YouTube API not configured on server' }));
            return;
        }

        const videoId = url.searchParams.get('id');
        if (!videoId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Video ID is required' }));
            return;
        }

        try {
            const youtubeResponse = await fetchUrl(
                `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet&key=${YOUTUBE_API_KEY}`
            );

            if (youtubeResponse.status !== 200) {
                console.error('YouTube API error:', youtubeResponse.data);
                res.writeHead(youtubeResponse.status, { 'Content-Type': 'application/json' });
                res.end(youtubeResponse.data);
                return;
            }

            const youtubeData = JSON.parse(youtubeResponse.data);
            const video = youtubeData.items?.[0];

            if (!video) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Video not found' }));
                return;
            }

            console.log(`📺 YouTube API called for ${videoId} by user ${userId}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: video.id,
                title: video.snippet?.title,
                description: video.snippet?.description,
                publishedAt: video.snippet?.publishedAt,
                channelTitle: video.snippet?.channelTitle,
                thumbnails: video.snippet?.thumbnails
            }));
        } catch (e) {
            console.error('YouTube proxy error:', e.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'YouTube API request failed' }));
        }
        return;
    }

    // =============================================
    // PROTECTED ENDPOINTS (require authentication)
    // =============================================

    // Bookmarks API - requires authentication
    if (url.pathname === '/bookmarks') {
        const userId = authenticateRequest(req);

        if (!userId) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Authentication required' }));
            return;
        }

        if (req.method === 'GET') {
            const bookmarks = readUserBookmarks(userId);
            console.log(`📚 GET /bookmarks - returning ${bookmarks.length} bookmarks for user ${userId}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(bookmarks));
            return;
        }

        if (req.method === 'POST') {
            try {
                const bookmarks = await parseBody(req);
                if (Array.isArray(bookmarks)) {
                    writeUserBookmarks(userId, bookmarks);
                    console.log(`📚 POST /bookmarks - saved ${bookmarks.length} bookmarks for user ${userId}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, count: bookmarks.length }));
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Expected array of bookmarks' }));
                }
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }
    }

    // Categories API - requires authentication
    if (url.pathname === '/categories') {
        const userId = authenticateRequest(req);

        if (!userId) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Authentication required' }));
            return;
        }

        if (req.method === 'GET') {
            const categories = readUserCategories(userId);
            console.log(`📁 GET /categories - returning ${categories.length} categories for user ${userId}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(categories));
            return;
        }

        if (req.method === 'POST') {
            try {
                const categories = await parseBody(req);
                if (Array.isArray(categories)) {
                    writeUserCategories(userId, categories);
                    console.log(`📁 POST /categories - saved ${categories.length} categories for user ${userId}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, count: categories.length }));
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Expected array of categories' }));
                }
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }
    }

    // =============================================
    // PUBLIC ENDPOINTS (no authentication required)
    // =============================================

    if (url.pathname === '/transcript') {
        const videoId = url.searchParams.get('v');

        if (!videoId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing video ID parameter (v)' }));
            return;
        }

        try {
            console.log(`\n${'='.repeat(50)}`);
            console.log(`Request for video: ${videoId}`);
            console.log(`${'='.repeat(50)}`);

            const transcript = await getTranscript(videoId);
            console.log(`✅ Success! Got ${transcript.length} segments`);
            console.log(`First segment: [${transcript[0]?.start}s] ${transcript[0]?.text?.substring(0, 50)}...`);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ transcript }));
        } catch (error) {
            console.error(`❌ Error: ${error.message}`);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }

    if (url.pathname === '/test') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
    <title>Transcript Server</title>
    <style>
        body { font-family: system-ui, sans-serif; padding: 40px; max-width: 900px; margin: 0 auto; background: #1a1a2e; color: #eee; }
        h1 { color: #e94560; }
        .card { background: #16213e; padding: 20px; border-radius: 12px; margin: 20px 0; }
        input { padding: 12px; width: 300px; border-radius: 8px; border: 1px solid #444; background: #0f3460; color: #fff; font-size: 16px; }
        button { padding: 12px 24px; background: #e94560; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; margin-left: 10px; }
        button:hover { background: #ff6b6b; }
        pre { background: #0f3460; padding: 20px; border-radius: 8px; overflow: auto; max-height: 400px; white-space: pre-wrap; word-wrap: break-word; }
        .links a { display: inline-block; margin-right: 10px; padding: 10px 16px; background: #0f3460; border-radius: 8px; color: #e94560; text-decoration: none; }
        .links a:hover { background: #1a3a6e; }
        .success { color: #4ade80; }
        .error { color: #f87171; }
    </style>
</head>
<body>
    <h1>🎬 YouTube Transcript Server</h1>

    <div class="card">
        <h3>Test with sample videos:</h3>
        <div class="links">
            <a href="#" onclick="test('dQw4w9WgXcQ')">Rick Astley</a>
            <a href="#" onclick="test('jNQXAC9IVRw')">First YT Video</a>
            <a href="#" onclick="test('9bZkp7q19f0')">Gangnam Style</a>
        </div>
    </div>

    <div class="card">
        <h3>Or enter a video ID or URL:</h3>
        <input type="text" id="vid" placeholder="Video ID or YouTube URL">
        <button onclick="testInput()">Get Transcript</button>
    </div>

    <div class="card">
        <h3>Result:</h3>
        <pre id="result">Click a test link or enter a video ID above</pre>
    </div>

    <script>
        function extractVideoId(input) {
            // Handle full URLs
            const urlMatch = input.match(/(?:youtube\\.com\\/watch\\?v=|youtu\\.be\\/|youtube\\.com\\/embed\\/)([a-zA-Z0-9_-]{11})/);
            if (urlMatch) return urlMatch[1];
            // Handle plain video ID
            if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
            return null;
        }

        function testInput() {
            const input = document.getElementById('vid').value.trim();
            const videoId = extractVideoId(input);
            if (!videoId) {
                document.getElementById('result').innerHTML = '<span class="error">Invalid video ID or URL</span>';
                return;
            }
            test(videoId);
        }

        async function test(videoId) {
            document.getElementById('result').textContent = 'Loading...';
            try {
                const res = await fetch('/transcript?v=' + videoId);
                const data = await res.json();
                if (data.error) {
                    document.getElementById('result').innerHTML = '<span class="error">Error: ' + data.error + '</span>';
                } else {
                    const preview = data.transcript.slice(0, 15).map(t =>
                        '[' + t.start.toFixed(1) + 's] ' + t.text
                    ).join('\\n');
                    document.getElementById('result').innerHTML =
                        '<span class="success">✅ Found ' + data.transcript.length + ' segments</span>\\n\\n' + preview +
                        (data.transcript.length > 15 ? '\\n\\n... and ' + (data.transcript.length - 15) + ' more segments' : '');
                }
            } catch (e) {
                document.getElementById('result').innerHTML = '<span class="error">Network error: ' + e.message + '</span>';
            }
        }
    </script>
</body>
</html>
        `);
        return;
    }

    // Static file serving for production deployment
    // Serve index.html for root path and SPA routes (like /admin)
    const spaRoutes = ['/', '/admin'];
    let filePath = spaRoutes.includes(url.pathname) ? '/index.html' : url.pathname;

    // Security: prevent directory traversal
    filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(STATIC_DIR, filePath);

    // Check if file exists and is within STATIC_DIR
    if (!fullPath.startsWith(STATIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
    }

    try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            const ext = path.extname(fullPath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            const content = fs.readFileSync(fullPath);

            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
            });
            res.end(content);
            return;
        }
    } catch (e) {
        console.error('Static file error:', e.message);
    }

    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'='.repeat(50)}`);
    console.log('🎬 VideoNoteSnatch Server');
    console.log(`${'='.repeat(50)}`);
    console.log(`\nEnvironment: ${process.env.RAILWAY_ENVIRONMENT || 'local'}`);
    console.log(`Running at: http://0.0.0.0:${PORT}`);
    console.log(`\nAPI Status:`);
    console.log(`  Gemini AI: ${GEMINI_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`  YouTube Data: ${YOUTUBE_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`\nPress Ctrl+C to stop\n`);
});
