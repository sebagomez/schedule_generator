// Month and weekday names come from i18n.js (Intl-driven, so they follow the
// selected language automatically). Everything user-facing goes through t().

// Years offered in the year picker. Extend END_YEAR to go further out.
const START_YEAR = 2026;
const END_YEAR = 2031;
const DEFAULT_YEAR = 2026;

// Feature flag: the per-month fullscreen view (⛶ button, overlay, prev/next).
// Off because the normal grid already reads well on a phone. Flip to true to
// bring back the ⛶ buttons, the overlay and its keyboard shortcuts.
const ENABLE_FULLSCREEN_MONTH = false;

// Touch devices have no right-click and no hover, and long-press is owned by the
// browser/OS (text-selection callout), so trying to intercept it is unreliable.
// On these devices a plain tap opens the day menu instead. Desktop keeps
// right-click, where a tap-to-open menu would fight normal clicking.
const isTouchDevice = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(hover: none) and (pointer: coarse)').matches
    : false;

// Monday that starts an ODD week of the pattern. Week parity is derived by
// counting whole weeks from here, so the 2-2-3 cycle stays continuous across
// year boundaries. (A per-year, Jan-1-anchored week number silently flipped
// the parity between 2028 and 2029 and broke the cycle.)
const PATTERN_ANCHOR = new Date(2025, 11, 29);

let currentYear = DEFAULT_YEAR;

// Date (YYYY-MM-DD) -> 'work' | 'off' overrides created by day swaps, loaded from the server.
let swapOverrides = {};
let swapMode = false;
let selectedForSwap = [];
// Month index currently shown in the fullscreen view, or null when closed.
let fullscreenMonth = null;

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

// Monday = 0 ... Sunday = 6
function mondayBasedDay(date) {
    const dayOfWeek = date.getDay();
    return dayOfWeek === 0 ? 6 : dayOfWeek - 1;
}

function getBaseWorkSchedule(date) {
    const dayIndex = mondayBasedDay(date);

    // Monday that starts this date's week. Using the Monday (rather than the
    // date itself) is what makes Sunday belong to the week it started in.
    const weekStart = new Date(date);
    weekStart.setDate(weekStart.getDate() - dayIndex);

    const weeksFromAnchor = Math.floor(Math.round((weekStart - PATTERN_ANCHOR) / 86400000) / 7);
    // Anchor week is odd, so an even offset means an odd week.
    const isOddWeek = ((weeksFromAnchor % 2) + 2) % 2 === 0;

    // Pattern is always 2, 2, 3. Odd weeks start with WORK, even weeks with OFF.
    if (isOddWeek) {
        // Odd weeks: WORK 2 (Mon-Tue), OFF 2 (Wed-Thu), WORK 3 (Fri-Sun)
        if (dayIndex <= 1) return 'work';
        if (dayIndex <= 3) return 'off';
        return 'work';
    }
    // Even weeks: OFF 2 (Mon-Tue), WORK 2 (Wed-Thu), OFF 3 (Fri-Sun)
    if (dayIndex <= 1) return 'off';
    if (dayIndex <= 3) return 'work';
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

function clearSwapSelection() {
    selectedForSwap.forEach(td => td.classList.remove('selected-for-swap'));
    selectedForSwap = [];
}

function toggleSwapMode() {
    swapMode = !swapMode;
    clearSwapSelection();

    const btn = document.getElementById('swapModeBtn');
    btn.textContent = swapMode ? t('swapActive') : t('swapDays');
    btn.classList.toggle('active', swapMode);
}

async function onDayClick(date, td, event) {
    if (!swapMode) {
        // Touch: tap is the only gesture available, so it opens the menu
        // (which itself offers Undo). Desktop keeps the quick-undo shortcut.
        if (isTouchDevice) {
            showDayMenu(event, date);
            return;
        }
        if (swapOverrides[formatDateKey(date)]) {
            if (confirm(t('confirmUndo', { date: formatLongDate(date) }))) {
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
        alert(t('pickOneEach'));
        clearSwapSelection();
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
        alert(t('errSwap'));
        console.error(err);
    }

    selectedForSwap = [];
    toggleSwapMode();
    render();
}

async function revertOverride(date) {
    const dateKey = formatDateKey(date);
    try {
        const res = await fetch(`/api/swaps/${dateKey}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        swapOverrides = await res.json();
    } catch (err) {
        alert(t('errUndo'));
        console.error(err);
        return;
    }
    render();
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
        alert(t('errSave'));
        console.error(err);
        return;
    }
    render();
}

let openContextMenu = null;
let openBackdrop = null;

function closeContextMenu() {
    if (openBackdrop) {
        openBackdrop.remove();
        openBackdrop = null;
    }
    if (openContextMenu) {
        openContextMenu.remove();
        openContextMenu = null;
        document.removeEventListener('click', closeContextMenu);
    }
}

// Keeps a cursor-anchored menu inside the viewport instead of overflowing
// off the right/bottom edge on small screens.
function clampToViewport(menu, x, y) {
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin));
    const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

// Day action menu. Opened by right-click on desktop, by tap on touch devices,
// where it renders as a bottom sheet with large tap targets.
function showDayMenu(event, date) {
    if (event) event.preventDefault();
    closeContextMenu();

    const dateKey = formatDateKey(date);
    const currentStatus = getWorkSchedule(date);
    const oppositeStatus = currentStatus === 'work' ? 'off' : 'work';
    const hasOverride = Boolean(swapOverrides[dateKey]);

    const menu = document.createElement('div');
    menu.className = isTouchDevice ? 'context-menu context-menu--sheet' : 'context-menu';

    const title = document.createElement('div');
    title.className = 'context-menu__title';
    title.textContent = `${formatLongDate(date)} — ${t(currentStatus === 'work' ? 'statusWork' : 'statusOff')}`;
    menu.appendChild(title);

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.textContent = t(oppositeStatus === 'work' ? 'markAsWork' : 'markAsOff');
    toggleBtn.onclick = () => {
        closeContextMenu();
        setManualOverride(date, oppositeStatus);
    };
    menu.appendChild(toggleBtn);

    if (hasOverride) {
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.textContent = t('undoChange');
        undoBtn.onclick = () => {
            closeContextMenu();
            revertOverride(date);
        };
        menu.appendChild(undoBtn);
    }

    if (isTouchDevice) {
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'context-menu__cancel';
        cancelBtn.textContent = t('cancel');
        cancelBtn.onclick = closeContextMenu;
        menu.appendChild(cancelBtn);

        const backdrop = document.createElement('div');
        backdrop.className = 'context-menu-backdrop';
        backdrop.addEventListener('click', closeContextMenu);
        document.body.appendChild(backdrop);
        openBackdrop = backdrop;
    }

    document.body.appendChild(menu);
    openContextMenu = menu;

    if (!isTouchDevice) {
        clampToViewport(menu, event.clientX, event.clientY);
        // Deferred so the click that opened the menu doesn't immediately close it.
        setTimeout(() => document.addEventListener('click', closeContextMenu), 0);
    }
}

function createDayCell(date) {
    const td = document.createElement('td');
    td.textContent = date.getDate();
    td.dataset.date = formatDateKey(date);

    const schedule = getWorkSchedule(date);
    td.className = schedule === 'work' ? 'work-day' : 'off-day';

    const override = swapOverrides[td.dataset.date];
    if (override) {
        if (override.pairedWith) {
            td.classList.add('swapped');
            td.title = t('titleSwapped');
        } else {
            td.classList.add('manual-edit');
            td.title = t('titleManual');
        }
    }

    td.addEventListener('click', (e) => onDayClick(date, td, e));
    // Also suppresses the browser's own long-press menu on touch devices.
    td.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!isTouchDevice) showDayMenu(e, date);
    });
    return td;
}

// Builds one month block. `expandable` adds the click-to-fullscreen affordance.
function buildMonth(year, month, { expandable = true } = {}) {
    const monthDiv = document.createElement('div');
    monthDiv.className = 'month';

    const monthLabel = `${monthName(month)} ${year}`;

    const monthTitle = document.createElement('div');
    monthTitle.className = 'month-name';
    monthTitle.textContent = monthLabel;

    if (expandable && ENABLE_FULLSCREEN_MONTH) {
        monthDiv.classList.add('expandable');
        const expandBtn = document.createElement('button');
        expandBtn.className = 'expand-btn';
        expandBtn.type = 'button';
        expandBtn.textContent = '⛶';
        expandBtn.title = t('expandTitle', { month: monthLabel });
        expandBtn.setAttribute('aria-label', t('expandTitle', { month: monthLabel }));
        expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openFullscreen(month);
        });
        monthTitle.appendChild(expandBtn);
    }

    monthDiv.appendChild(monthTitle);

    const table = document.createElement('table');
    table.className = 'calendar-table';

    const headerRow = document.createElement('tr');
    weekdayNames().forEach(day => {
        const th = document.createElement('th');
        th.textContent = day;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startingDayOfWeek = mondayBasedDay(new Date(year, month, 1));

    let weekRow = document.createElement('tr');
    for (let i = 0; i < startingDayOfWeek; i++) {
        const td = document.createElement('td');
        td.className = 'empty-day';
        weekRow.appendChild(td);
    }

    let currentDayOfWeek = startingDayOfWeek;
    for (let day = 1; day <= daysInMonth; day++) {
        weekRow.appendChild(createDayCell(new Date(year, month, day)));
        currentDayOfWeek++;

        if (currentDayOfWeek % 7 === 0 || day === daysInMonth) {
            table.appendChild(weekRow);
            weekRow = document.createElement('tr');
        }
    }

    monthDiv.appendChild(table);
    return monthDiv;
}

function generateCalendar() {
    const container = document.getElementById('calendarContainer');
    container.innerHTML = '';

    for (let month = 0; month < 12; month++) {
        container.appendChild(buildMonth(currentYear, month));
    }
}

function renderFullscreen() {
    if (!ENABLE_FULLSCREEN_MONTH) return;
    const overlay = document.getElementById('fullscreenOverlay');
    const body = document.getElementById('fullscreenMonth');
    if (!overlay || !body) return;
    if (fullscreenMonth === null) {
        overlay.hidden = true;
        document.body.classList.remove('fullscreen-open');
        return;
    }

    body.innerHTML = '';
    body.appendChild(buildMonth(currentYear, fullscreenMonth, { expandable: false }));
    overlay.hidden = false;
    document.body.classList.add('fullscreen-open');
}

function openFullscreen(month) {
    if (!ENABLE_FULLSCREEN_MONTH) return;
    clearSwapSelection();
    fullscreenMonth = month;
    renderFullscreen();
}

function closeFullscreen() {
    if (fullscreenMonth === null) return;
    clearSwapSelection();
    fullscreenMonth = null;
    renderFullscreen();
}

function stepFullscreen(delta) {
    if (fullscreenMonth === null) return;
    const next = fullscreenMonth + delta;
    if (next < 0 || next > 11) return;
    openFullscreen(next);
}

// Single entry point so the grid and the fullscreen view never drift apart.
function render() {
    generateCalendar();
    renderFullscreen();
}

function populateYearSelect() {
    const select = document.getElementById('yearSelect');
    for (let year = START_YEAR; year <= END_YEAR; year++) {
        const option = document.createElement('option');
        option.value = String(year);
        option.textContent = String(year);
        option.selected = year === DEFAULT_YEAR;
        select.appendChild(option);
    }
    select.addEventListener('change', () => {
        currentYear = Number(select.value);
        // Overrides are keyed by full date, so they stay put across years;
        // only the visible year changes.
        closeFullscreen();
        render();
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeContextMenu();
    if (!ENABLE_FULLSCREEN_MONTH || fullscreenMonth === null) return;
    if (e.key === 'Escape') closeFullscreen();
    if (e.key === 'ArrowLeft') stepFullscreen(-1);
    if (e.key === 'ArrowRight') stepFullscreen(1);
});

// No logout button by design: this is a shared household calendar and the
// session is meant to persist. POST /api/logout still exists server-side if a
// session ever needs clearing.

function setupFullscreen() {
    const overlay = document.getElementById('fullscreenOverlay');
    const hint = document.getElementById('fullscreenHint');

    if (!ENABLE_FULLSCREEN_MONTH) {
        // Drop the markup entirely so a disabled feature can't be reached.
        if (overlay) overlay.remove();
        if (hint) hint.remove();
        return;
    }

    if (hint) hint.hidden = false;
    document.getElementById('fullscreenClose').addEventListener('click', closeFullscreen);
    document.getElementById('fullscreenPrev').addEventListener('click', () => stepFullscreen(-1));
    document.getElementById('fullscreenNext').addEventListener('click', () => stepFullscreen(1));
    overlay.addEventListener('click', (e) => {
        if (e.target.id === 'fullscreenOverlay') closeFullscreen();
    });
}

function showDeviceHint() {
    const pointerHint = document.getElementById('pointerHint');
    const touchHint = document.getElementById('touchHint');
    if (pointerHint) pointerHint.hidden = isTouchDevice;
    if (touchHint) touchHint.hidden = !isTouchDevice;
}

// Re-applies every piece of text that isn't rebuilt by render(): the static
// markup, the swap button (whose label depends on swapMode) and the hints.
function refreshLanguage() {
    applyStaticTranslations();
    showDeviceHint();

    const btn = document.getElementById('swapModeBtn');
    if (btn) btn.textContent = swapMode ? t('swapActive') : t('swapDays');

    closeContextMenu();
    render();
}

function init() {
    applyStaticTranslations();
    buildLanguageSwitcher(document.getElementById('langSwitcher'), refreshLanguage);
    populateYearSelect();
    showDeviceHint();
    setupFullscreen();

    // Load any saved swaps, then draw the calendar.
    loadSwapOverrides().then(render);
}

init();
