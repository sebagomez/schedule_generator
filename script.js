const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Date (YYYY-MM-DD) -> 'work' | 'off' overrides created by day swaps, loaded from the server.
let swapOverrides = {};
let swapMode = false;
let selectedForSwap = [];

function formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// new Date("YYYY-MM-DD") parses as UTC midnight, which shifts to the previous
// day in negative-UTC-offset timezones. Build from local components instead
// so it matches the local dates used everywhere else (e.g. generateCalendar).
function parseDateKey(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function getBaseWorkSchedule(date) {
    // For work schedule purposes, Sunday belongs to the previous Monday-started week
    // So we need to adjust the date when calculating week number for Sundays
    let adjustedDate = new Date(date);
    if (date.getDay() === 0) {
        // If it's Sunday, subtract 1 day to get Saturday, which is in the correct week
        adjustedDate.setDate(adjustedDate.getDate() - 1);
    }

    // Get the week number using the adjusted date
    const yearStart = new Date(adjustedDate.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((adjustedDate - yearStart) / (1000 * 60 * 60 * 24));
    const weekNumber = Math.ceil((dayOfYear + yearStart.getDay() + 1) / 7);

    // Get day of week (0 = Sunday, 1 = Monday, etc.)
    const dayOfWeek = date.getDay();

    // Convert to Monday = 0, Sunday = 6
    const mondayBasedDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const isOddWeek = weekNumber % 2 === 1;

    // Pattern is always: 2, 2, 3 (2 days, then 2 days, then 3 days)
    // Odd weeks start with WORK, Even weeks start with OFF

    if (isOddWeek) {
        // Odd weeks: WORK 2 (Mon-Tue), OFF 2 (Wed-Thu), WORK 3 (Fri-Sun)
        if (mondayBasedDay >= 0 && mondayBasedDay <= 1) return 'work';  // Mon-Tue
        if (mondayBasedDay >= 2 && mondayBasedDay <= 3) return 'off';   // Wed-Thu
        if (mondayBasedDay >= 4 && mondayBasedDay <= 6) return 'work';  // Fri-Sun
    } else {
        // Even weeks: OFF 2 (Mon-Tue), WORK 2 (Wed-Thu), OFF 3 (Fri-Sun)
        if (mondayBasedDay >= 0 && mondayBasedDay <= 1) return 'off';   // Mon-Tue
        if (mondayBasedDay >= 2 && mondayBasedDay <= 3) return 'work';  // Wed-Thu
        if (mondayBasedDay >= 4 && mondayBasedDay <= 6) return 'off';   // Fri-Sun
    }

    return 'off';
}

function getWorkSchedule(date) {
    const override = swapOverrides[formatDateKey(date)];
    return override ? override.status : getBaseWorkSchedule(date);
}

async function loadSwapOverrides() {
    try {
        const res = await fetch('/api/swaps');
        if (res.ok) {
            swapOverrides = await res.json();
        }
    } catch (err) {
        // No server available (e.g. opened as a local file) - fall back to the regular pattern.
        console.warn('Could not load saved day swaps, continuing without them.', err);
    }
}

function toggleSwapMode() {
    swapMode = !swapMode;
    selectedForSwap.forEach(td => td.classList.remove('selected-for-swap'));
    selectedForSwap = [];

    const btn = document.getElementById('swapModeBtn');
    btn.textContent = swapMode ? '✅ Select 2 days to swap' : '🔀 Swap Days';
    btn.classList.toggle('active', swapMode);
}

async function onDayClick(date, td) {
    if (!swapMode) {
        if (swapOverrides[formatDateKey(date)]) {
            if (confirm(`Undo the change on ${date.toDateString()}?`)) {
                await revertOverride(date);
            }
        }
        return;
    }

    if (selectedForSwap.includes(td)) {
        return;
    }

    selectedForSwap.push(td);
    td.classList.add('selected-for-swap');

    if (selectedForSwap.length === 2) {
        await performSwap();
    }
}

async function performSwap() {
    const [tdA, tdB] = selectedForSwap;
    const dateA = parseDateKey(tdA.dataset.date);
    const dateB = parseDateKey(tdB.dataset.date);
    const statusA = getWorkSchedule(dateA);
    const statusB = getWorkSchedule(dateB);

    if (statusA === statusB) {
        alert('Pick one work day and one off day to swap.');
        selectedForSwap.forEach(td => td.classList.remove('selected-for-swap'));
        selectedForSwap = [];
        return;
    }

    try {
        const res = await fetch('/api/swaps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date1: tdA.dataset.date,
                status1: statusB,
                date2: tdB.dataset.date,
                status2: statusA
            })
        });
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        swapOverrides = await res.json();
    } catch (err) {
        alert('Could not save the swap. Is the server running?');
        console.error(err);
    }

    selectedForSwap = [];
    toggleSwapMode();
    generateCalendar();
}

async function revertOverride(date) {
    const dateKey = formatDateKey(date);
    try {
        const res = await fetch(`/api/swaps/${dateKey}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        swapOverrides = await res.json();
    } catch (err) {
        alert('Could not undo the change. Is the server running?');
        console.error(err);
        return;
    }
    generateCalendar();
}

async function setManualOverride(date, status) {
    try {
        const res = await fetch('/api/swaps/single', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: formatDateKey(date), status })
        });
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        swapOverrides = await res.json();
    } catch (err) {
        alert('Could not save the change. Is the server running?');
        console.error(err);
        return;
    }
    generateCalendar();
}

let openContextMenu = null;

function closeContextMenu() {
    if (openContextMenu) {
        openContextMenu.remove();
        openContextMenu = null;
        document.removeEventListener('click', closeContextMenu);
    }
}

function showContextMenu(event, date, td) {
    event.preventDefault();
    closeContextMenu();

    const dateKey = formatDateKey(date);
    const currentStatus = getWorkSchedule(date);
    const oppositeStatus = currentStatus === 'work' ? 'off' : 'work';
    const hasOverride = Boolean(swapOverrides[dateKey]);

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = `Mark as ${oppositeStatus === 'work' ? 'Work' : 'Off'}`;
    toggleBtn.onclick = () => {
        closeContextMenu();
        setManualOverride(date, oppositeStatus);
    };
    menu.appendChild(toggleBtn);

    if (hasOverride) {
        const undoBtn = document.createElement('button');
        undoBtn.textContent = '↩ Undo change';
        undoBtn.onclick = () => {
            closeContextMenu();
            revertOverride(date);
        };
        menu.appendChild(undoBtn);
    }

    document.body.appendChild(menu);
    openContextMenu = menu;
    // Deferred so the click that opened the menu doesn't immediately close it.
    setTimeout(() => document.addEventListener('click', closeContextMenu), 0);
}

function generateCalendar() {
    const container = document.getElementById('calendarContainer');
    container.innerHTML = '';

    for (let month = 0; month < 12; month++) {
        const monthDiv = document.createElement('div');
        monthDiv.className = 'month';

        const monthTitle = document.createElement('div');
        monthTitle.className = 'month-name';
        monthTitle.textContent = monthNames[month] + ' 2026';
        monthDiv.appendChild(monthTitle);

        const table = document.createElement('table');
        table.className = 'calendar-table';

        // Header row
        const headerRow = document.createElement('tr');
        dayNames.forEach(day => {
            const th = document.createElement('th');
            th.textContent = day;
            headerRow.appendChild(th);
        });
        table.appendChild(headerRow);

        // Get first day of month and days in month
        const firstDay = new Date(2026, month, 1);
        const lastDay = new Date(2026, month + 1, 0);
        const daysInMonth = lastDay.getDate();

        // Convert Sunday (0) to 6, and shift Monday to 0
        let startingDayOfWeek = firstDay.getDay();
        startingDayOfWeek = startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1;

        let dayCounter = 1;
        let weekRow = document.createElement('tr');

        // Empty cells before first day
        for (let i = 0; i < startingDayOfWeek; i++) {
            const td = document.createElement('td');
            td.className = 'empty-day';
            weekRow.appendChild(td);
        }

        // Fill in the days
        let currentDayOfWeek = startingDayOfWeek;
        for (let day = 1; day <= daysInMonth; day++) {
            const currentDate = new Date(2026, month, day);
            const td = document.createElement('td');
            td.textContent = day;
            td.dataset.date = formatDateKey(currentDate);

            const dateKey = formatDateKey(currentDate);
            const schedule = getWorkSchedule(currentDate);
            td.className = schedule === 'work' ? 'work-day' : 'off-day';
            const override = swapOverrides[dateKey];
            if (override) {
                if (override.pairedWith) {
                    td.classList.add('swapped');
                    td.title = 'Swapped day - click to undo, right-click for options';
                } else {
                    td.classList.add('manual-edit');
                    td.title = 'Manually edited day - click to undo, right-click for options';
                }
            }
            td.addEventListener('click', () => onDayClick(currentDate, td));
            td.addEventListener('contextmenu', (e) => showContextMenu(e, currentDate, td));

            weekRow.appendChild(td);
            currentDayOfWeek++;

            if (currentDayOfWeek % 7 === 0 || day === daysInMonth) {
                table.appendChild(weekRow);
                weekRow = document.createElement('tr');
            }
        }

        monthDiv.appendChild(table);
        container.appendChild(monthDiv);
    }
}

function downloadCSV() {
    const dayNamesForCSV = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let csv = 'Month,Date,Day of Week,Week Number,Week Type,Status,Swapped\n';

    for (let month = 0; month < 12; month++) {
        const daysInMonth = new Date(2026, month + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const currentDate = new Date(2026, month, day);
            const schedule = getWorkSchedule(currentDate);
            const dayOfWeek = dayNamesForCSV[currentDate.getDay()];
            const dateStr = `${month + 1}/${day}/2026`;
            const isSwapped = Boolean(swapOverrides[formatDateKey(currentDate)]);

            // Calculate week number
            const yearStart = new Date(currentDate.getFullYear(), 0, 1);
            const dayOfYear = Math.floor((currentDate - yearStart) / (1000 * 60 * 60 * 24));
            const weekNumber = Math.ceil((dayOfYear + yearStart.getDay() + 1) / 7);
            const weekType = weekNumber % 2 === 1 ? 'Odd' : 'Even';

            csv += `${monthNames[month]},${dateStr},${dayOfWeek},${weekNumber},${weekType},${schedule === 'work' ? 'WORK' : 'OFF'},${isSwapped ? 'Yes' : 'No'}\n`;
        }
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '2026_work_schedule.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// Load any saved swaps, then generate the calendar on load
loadSwapOverrides().then(generateCalendar);
