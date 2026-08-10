const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'swaps.json');
const VALID_STATUSES = ['work', 'off'];

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

app.use(express.json());
app.use(express.static(__dirname, { index: 'schedule_generator.html' }));

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
