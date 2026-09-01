const express = require('express');
const crypto = require('crypto');
const path = require('path');
const storage = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;
const VALID_STATUSES = ['work', 'off'];

const DEFAULT_PASSWORD = 'changeme';
const COOKIE_NAME = 'schedule_auth';
const COOKIE_MAX_AGE_DAYS = 30;
// Set COOKIE_SECURE=true when serving over HTTPS (required on Azure).
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
// Optional: supply the secrets via app settings instead of settings.json.
// Preferred on Azure, where secrets belong in configuration, not in a data blob.
// Set BOTH and settings.json is never created or read at all.
const PASSWORD_FROM_ENV = process.env.SCHEDULE_PASSWORD || '';
const SESSION_SECRET_FROM_ENV = process.env.SESSION_SECRET || '';

// Files that must stay reachable without a session, or the login page can't
// render. style.css is shared with the app but contains nothing sensitive.
const PUBLIC_FILES = ['/login', '/login.html', '/style.css', '/favicon.ico'];

// Shallow copy: handlers mutate the result in place, and a failed save must not
// leave the cached document holding changes that were never persisted. Entries
// are always replaced wholesale, never mutated, so one level is enough.
function readSwaps() {
    return { ...storage.getSwaps() };
}

async function writeSwaps(swaps) {
    await storage.saveSwaps(swaps);
}

// settings holds the single shared password. sessionSecret is generated once
// and reused so a server restart doesn't log you out.
async function loadOrCreateSettings() {
    // Only fields NOT supplied by the environment need to be stored. If both
    // come from env vars, settings.json is never written - no stale, ignored
    // password sitting in the data store pretending to be live.
    const settings = storage.getSettings();
    let changed = false;

    if (!PASSWORD_FROM_ENV && (typeof settings.password !== 'string' || settings.password === '')) {
        settings.password = DEFAULT_PASSWORD;
        changed = true;
    }
    if (!SESSION_SECRET_FROM_ENV && (typeof settings.sessionSecret !== 'string' || settings.sessionSecret === '')) {
        settings.sessionSecret = crypto.randomBytes(32).toString('hex');
        changed = true;
    }

    if (changed) {
        await storage.saveSettings(settings);
        console.log('Wrote settings to storage.');
    }

    if (PASSWORD_FROM_ENV && SESSION_SECRET_FROM_ENV) {
        console.log('Auth fully configured from the environment; settings.json not used.');
    } else if (PASSWORD_FROM_ENV) {
        console.log('Password from SCHEDULE_PASSWORD; sessionSecret from settings.json.');
    } else if (currentPassword() === DEFAULT_PASSWORD) {
        console.warn(`WARNING: still using the default password "${DEFAULT_PASSWORD}". ` +
                     'Change it (settings.json "password", or the SCHEDULE_PASSWORD env var) and restart.');
    }
    return settings;
}

function currentPassword() {
    return PASSWORD_FROM_ENV || storage.getSettings().password || '';
}

function sessionSecret() {
    return SESSION_SECRET_FROM_ENV || storage.getSettings().sessionSecret || '';
}

// Constant-time compare so response timing doesn't leak the password.
function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function passwordMatches(candidate) {
    if (typeof candidate !== 'string' || candidate === '') return false;
    return safeEqual(candidate, currentPassword());
}

function sessionToken() {
    // Derived from the secret + current password, so changing the password
    // invalidates existing cookies.
    return crypto.createHmac('sha256', sessionSecret())
        .update(currentPassword())
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
    return safeEqual(token, sessionToken());
}

app.use(express.json());

// Startup state. The server listens immediately and reports its readiness here,
// rather than staying dark until storage is up - otherwise a storage failure
// looks like "connection refused" and the real reason is invisible to probes.
const startup = { ready: false, error: null };

// LIVENESS: 200 as long as the process is alive, even while storage is broken.
// Returning 503 here would make the platform kill a container that is only
// misconfigured, hiding the error behind a crash loop.
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        ready: startup.ready,
        storage: storage.backend,
        error: startup.error
    });
});

// READINESS: only 200 once storage has loaded, so traffic isn't routed early.
app.get('/api/ready', (req, res) => {
    if (startup.ready) return res.json({ ready: true, storage: storage.backend });
    res.status(503).json({ ready: false, storage: storage.backend, error: startup.error });
});

// Everything else needs storage; fail clearly instead of serving empty data.
app.use((req, res, next) => {
    if (startup.ready || req.path === '/api/health' || req.path === '/api/ready') return next();
    res.status(503).json({ error: 'Starting up - storage is not ready yet.', detail: startup.error });
});

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

app.post('/api/swaps', async (req, res, next) => {
    const { date1, status1, date2, status2 } = req.body || {};

    if (!date1 || !date2 || !VALID_STATUSES.includes(status1) || !VALID_STATUSES.includes(status2)) {
        return res.status(400).json({ error: 'date1, date2 and valid work/off statuses are required' });
    }

    try {
        const swaps = readSwaps();
        swaps[date1] = { status: status1, pairedWith: date2 };
        swaps[date2] = { status: status2, pairedWith: date1 };
        await writeSwaps(swaps);
        res.json(swaps);
    } catch (err) {
        next(err);
    }
});

app.post('/api/swaps/single', async (req, res, next) => {
    const { date, status } = req.body || {};

    if (!date || !VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'date and a valid work/off status are required' });
    }

    try {
        const swaps = readSwaps();
        swaps[date] = { status, pairedWith: null };
        await writeSwaps(swaps);
        res.json(swaps);
    } catch (err) {
        next(err);
    }
});

app.delete('/api/swaps/:date', async (req, res, next) => {
    try {
        const swaps = readSwaps();
        const entry = swaps[req.params.date];
        delete swaps[req.params.date];
        // A swap always involves two dates - undoing one side undoes both.
        if (entry && entry.pairedWith) {
            delete swaps[entry.pairedWith];
        }
        await writeSwaps(swaps);
        res.json(swaps);
    } catch (err) {
        next(err);
    }
});

// Surfacing storage failures instead of hanging the request.
app.use((err, req, res, next) => {
    console.error('Request failed:', err);
    if (err && err.conflict) {
        return res.status(409).json({
            error: 'That change conflicted with another update. Reload and try again.'
        });
    }
    res.status(500).json({ error: 'Storage error - could not save changes.' });
});

// Listen first so health probes and logs can report what's wrong, then bring up
// storage. Keeping the process alive on failure beats crash-looping: the error
// is readable at /api/health and in the console instead of vanishing with the
// container.
function start() {
    app.listen(PORT, () => {
        console.log(`Schedule generator listening on port ${PORT} (storage initialising)`);
    });

    storage.init()
        .then(loadOrCreateSettings)
        .then(() => {
            startup.ready = true;
            console.log('Storage ready; serving requests.');
        })
        .catch(err => {
            startup.error = err.message;
            console.error('STORAGE INITIALISATION FAILED:', err.message);
            console.error('The app is listening but will return 503 until this is fixed.');
        });
}

start();
