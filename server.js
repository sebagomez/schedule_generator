const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'swaps.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const VALID_STATUSES = ['work', 'off'];

const DEFAULT_PASSWORD = 'changeme';
const COOKIE_NAME = 'schedule_auth';
const COOKIE_MAX_AGE_DAYS = 30;
// Set COOKIE_SECURE=true when serving over HTTPS.
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

// Files that must stay reachable without a session, or the login page can't
// render. style.css is shared with the app but contains nothing sensitive.
const PUBLIC_FILES = ['/login', '/login.html', '/style.css', '/favicon.ico'];

function readSwaps() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (err) {
        return {};
    }
}

function writeSwaps(swaps) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(swaps, null, 2));
}

// settings.json holds the single shared password. sessionSecret is generated
// once and reused so a server restart doesn't log you out.
function readSettings() {
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch (err) {
        return {};
    }
}

function loadOrCreateSettings() {
    const settings = readSettings();
    let changed = false;

    if (typeof settings.password !== 'string' || settings.password === '') {
        settings.password = DEFAULT_PASSWORD;
        changed = true;
    }
    if (typeof settings.sessionSecret !== 'string' || settings.sessionSecret === '') {
        settings.sessionSecret = crypto.randomBytes(32).toString('hex');
        changed = true;
    }

    if (changed) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        console.log(`Wrote settings to ${SETTINGS_FILE}`);
    }
    if (settings.password === DEFAULT_PASSWORD) {
        console.warn(`WARNING: still using the default password "${DEFAULT_PASSWORD}". ` +
                     `Edit "password" in ${SETTINGS_FILE} and restart.`);
    }
    return settings;
}

const settings = loadOrCreateSettings();

// Constant-time compare so response timing doesn't leak the password.
function passwordMatches(candidate) {
    if (typeof candidate !== 'string') return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(readSettings().password || settings.password);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function sessionToken() {
    // Derived from the secret + current password, so changing the password
    // invalidates existing cookies.
    return crypto.createHmac('sha256', settings.sessionSecret)
        .update(readSettings().password || settings.password)
        .digest('hex');
}

function parseCookies(req) {
    const header = req.headers.cookie;
    if (!header) return {};
    return header.split(';').reduce((acc, part) => {
        const idx = part.indexOf('=');
        if (idx > -1) acc[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
        return acc;
    }, {});
}

function isAuthenticated(req) {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return false;
    const expected = sessionToken();
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

app.use(express.json());

// ---- Public: login page and login/logout endpoints ----

app.get('/login', (req, res) => {
    if (isAuthenticated(req)) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/api/login', (req, res) => {
    const { password } = req.body || {};

    if (!passwordMatches(password)) {
        // Small delay to take the edge off brute-force attempts.
        return setTimeout(() => res.status(401).json({ error: 'Incorrect password' }), 500);
    }

    res.cookie(COOKIE_NAME, sessionToken(), {
        httpOnly: true,
        sameSite: 'lax',
        secure: COOKIE_SECURE,
        maxAge: COOKIE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
    });
    res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME);
    res.json({ ok: true });
});

// ---- Gate the app pages behind the password ----
// The /api/swaps endpoints below are intentionally left open.

app.use((req, res, next) => {
    if (PUBLIC_FILES.includes(req.path) || req.path.startsWith('/api/')) return next();
    if (isAuthenticated(req)) return next();
    res.redirect('/login');
});

app.use(express.static(__dirname, { index: 'schedule_generator.html' }));

// ---- Schedule overrides API (no auth, by design) ----

app.get('/api/swaps', (req, res) => {
    res.json(readSwaps());
});

app.post('/api/swaps', (req, res) => {
    const { date1, status1, date2, status2 } = req.body || {};

    if (!date1 || !date2 || !VALID_STATUSES.includes(status1) || !VALID_STATUSES.includes(status2)) {
        return res.status(400).json({ error: 'date1, date2 and valid work/off statuses are required' });
    }

    const swaps = readSwaps();
    swaps[date1] = { status: status1, pairedWith: date2 };
    swaps[date2] = { status: status2, pairedWith: date1 };
    writeSwaps(swaps);
    res.json(swaps);
});

app.post('/api/swaps/single', (req, res) => {
    const { date, status } = req.body || {};

    if (!date || !VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'date and a valid work/off status are required' });
    }

    const swaps = readSwaps();
    swaps[date] = { status, pairedWith: null };
    writeSwaps(swaps);
    res.json(swaps);
});

app.delete('/api/swaps/:date', (req, res) => {
    const swaps = readSwaps();
    const entry = swaps[req.params.date];
    delete swaps[req.params.date];
    // A swap always involves two dates - undoing one side undoes both.
    if (entry && entry.pairedWith) {
        delete swaps[entry.pairedWith];
    }
    writeSwaps(swaps);
    res.json(swaps);
});

app.listen(PORT, () => {
    console.log(`Schedule generator listening on port ${PORT}`);
});
