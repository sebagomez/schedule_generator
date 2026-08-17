# AGENTS.md

Guidance for any AI coding agent working in this repository. This is the single
source of truth — other agent-specific files (e.g. `CLAUDE.md`) just point here.

## Overview

This app renders a work/off-day calendar for a repeating weekly shift pattern as
a grid of 12 monthly tables, lets individual days be overridden (either paired as
a swap — e.g. a colleague covers a work day in exchange for an off day — or
edited singly, e.g. a public holiday), lets any single month be opened fullscreen
for screenshots, and gates the whole UI behind one shared password.

It's a static frontend — [schedule_generator.html](schedule_generator.html),
[login.html](login.html), [style.css](style.css), [script.js](script.js) —
served by a small Express backend ([server.js](server.js)) that persists
overrides and settings to flat JSON files. It also ships as a Docker image.

Single-user personal tool: no database, no user accounts, no build step, no tests.

## Running it

- **Local**: install deps, then `npm start` (i.e. `node server.js`) on port 3000. Visit `http://localhost:3000`.
  - ⚠️ In this environment `npm install` is blocked ("npm is no longer supported in a global context"). Use **`pnpm install`** — that's why `pnpm-lock.yaml` exists alongside `package-lock.json`.
- **First start** creates `data/settings.json` with the default password `changeme` and logs a warning. Edit `password` there and restart before exposing the app.
- **Opening `schedule_generator.html` directly as a file no longer works properly** — the page is served behind the auth gate, and there's no CSV fallback anymore. Run the server.
- **Docker**: `docker compose up --build`. Compose bind-mounts `./data:/app/data`, so `data/*.json` appears in the project folder on the host and survives rebuilds. Don't run without something mounted at `/app/data` if persistence matters. `PORT`, `DATA_DIR` and `COOKIE_SECURE` are env-configurable.

## Architecture

### [script.js](script.js) — all client-side

- **Year selection**: `START_YEAR` (2026) / `END_YEAR` (2031) / `DEFAULT_YEAR` (2026) constants drive a `<select id="yearSelect">` built by `populateYearSelect()`. The visible year lives in the `currentYear` global. To offer more years, bump `END_YEAR` — nothing else is year-specific.
- **Schedule logic (`getBaseWorkSchedule(date)`)**: the core rule engine. Maps day-of-week to `'work'` or `'off'` using a fixed 2-2-3 repeating pattern:
  - Odd weeks: Work Mon–Tue, Off Wed–Thu, Work Fri–Sun
  - Even weeks: Off Mon–Tue, Work Wed–Thu, Off Fri–Sun
  - **Week parity comes from `PATTERN_ANCHOR` (Mon 2025-12-29, the start of an odd week)**, counting whole weeks from that anchor to the Monday of the date's week. Anchoring on a fixed Monday is deliberate:
    - It keeps the 2-2-3 cycle continuous across year boundaries. The previous implementation derived a per-year, Jan-1-anchored week number, which flipped parity between 2028 and 2029 and broke the cycle mid-rotation.
    - Because the week's Monday is used (rather than the date), Sunday naturally belongs to the week it started in — this replaces an older explicit "subtract a day if Sunday" special case.
    - Verified byte-identical to the old logic for 2026, 2027 and 2028, and continuous through 2039.
  - If you change parity derivation, re-verify that `sched(d) === sched(d + 14 days)` holds across year boundaries.
- **`getWorkSchedule(date)`**: the actual source of truth used everywhere else. Wraps `getBaseWorkSchedule` and checks `swapOverrides` first (keyed by `YYYY-MM-DD`, via `formatDateKey`) — an overridden day's status wins over the pattern.
- **Overrides (`swapOverrides`)**: each entry is `{ status: 'work'|'off', pairedWith: <dateKey>|null }`. A two-day swap sets both dates' entries pointing at each other via `pairedWith`; a single-day edit sets `pairedWith: null`. `revertOverride(date)` `DELETE`s a day's override, and the server cascades the delete to `pairedWith` too — **undoing either side of a swap reverts both days**, which is the whole reason `pairedWith` exists (a flat one-day-at-a-time override map previously left the other side of a swap stuck).
  - Keys are full dates, so overrides are inherently year-agnostic: switching the year picker changes only what's rendered, and the server needs no year awareness.
- **Swap UI**: `swapOverrides` is loaded from `GET /api/swaps` on startup (`loadSwapOverrides`, fails soft). `toggleSwapMode()` + `onDayClick()` drive the click-two-days-to-swap flow; `performSwap()` validates the pair has different statuses (a swap only makes sense between one work day and one off day) and `POST`s the pair to `/api/swaps`. **Important**: when reconstructing a `Date` from a stored `YYYY-MM-DD` key, always use `parseDateKey()`, never `new Date(dateKey)` — the latter parses as UTC midnight and silently shifts a day in negative-UTC timezones.
- **Single-day edit UI (`showDayMenu()`)**: offers "Mark as Work/Off" (`setManualOverride()`, `POST`s to `/api/swaps/single`) and, if the day already has an override, "Undo change". How it opens depends on the device, via the `isTouchDevice` check (`matchMedia('(hover: none) and (pointer: coarse)')`):
  - **Desktop**: right-click opens it, positioned at the cursor and clamped inside the viewport by `clampToViewport()`. Left-clicking an already-overridden day stays a `confirm()` quick-undo shortcut.
  - **Touch**: a plain **tap** opens it as a bottom sheet (`.context-menu--sheet`) with 44px targets, a date/status heading, a Cancel button and a tap-anywhere backdrop. **Do not try to implement long-press for this.** Mobile browsers fire no usable `contextmenu`, and long-press is owned by the OS text-selection callout; intercepting it with `touchstart` timers is unreliable and interferes with scrolling. The `contextmenu` handler on each cell only calls `preventDefault()` on touch, and `.calendar-table td` sets `-webkit-touch-callout: none` + `user-select: none`, to suppress that native menu.
  - Swap mode takes precedence on both: while `swapMode` is on, a tap/click selects the day rather than opening the menu.
  - The instruction text has two variants in the markup (`#pointerHint`, `#touchHint`); `showDeviceHint()` reveals whichever matches, so phones aren't told to "right-click".
- **Rendering**: `createDayCell(date)` builds one `<td>` (tagged `work-day`/`off-day`, plus `swapped` or `manual-edit` depending on `pairedWith`, with click and contextmenu handlers). `buildMonth(year, month, { expandable })` builds one month block. `generateCalendar()` loops 12 months into `#calendarContainer`.
- **Fullscreen month view — behind a feature flag, currently OFF**: `ENABLE_FULLSCREEN_MONTH = false`. The normal grid reads fine on a phone, so the feature was disabled rather than deleted; flip the constant to `true` to restore it. When off, `setupFullscreen()` removes `#fullscreenOverlay` and `#fullscreenHint` from the DOM, `buildMonth()` skips the `⛶` button, and `openFullscreen()` / `renderFullscreen()` / the arrow-key handler all no-op — so no dead UI is reachable.
  - When on: `fullscreenMonth` holds the month index being shown, or `null`. `openFullscreen()` / `closeFullscreen()` / `stepFullscreen(±1)` drive a `#fullscreenOverlay` modal with larger cells, intended for screenshots. Prev/Next buttons, `←`/`→` keys, `Esc` and click-outside all work. Days stay fully interactive there because it reuses the same `buildMonth`/`createDayCell` builders.
  - The `@media print` rules that hide the full-year grid are scoped to `body.fullscreen-open`, so printing with the feature off still prints the grid rather than a blank page. Keep that scoping if you touch the print styles.
- **`render()` is the single re-render entry point** — it calls `generateCalendar()` *and* `renderFullscreen()` so the grid and the open fullscreen month can never drift apart. Always call `render()` (not `generateCalendar()`) after mutating `swapOverrides`.
- **`logout()`**: `POST`s `/api/logout` and redirects to `/login`.

### [login.html](login.html)

Standalone password page with an inline script: posts `{ password }` to
`POST /api/login`, redirects to `/` on success, shows an inline error and stays
put on failure. Shares [style.css](style.css) (`.login-*` rules).

### [style.css](style.css)

Styles for the login card, controls panel, per-month calendar grid
(`.calendar-grid` → `.month` → `.calendar-table`), work/off legend, override
states (`.selected-for-swap`, `.swapped`, `.manual-edit`), the right-click
`.context-menu`, the `.expand-btn` / `.fullscreen-*` month view (unused while
the fullscreen flag is off, retained so flipping it back needs no CSS work), and
a `@media print` block.

### [server.js](server.js)

Express app serving the static frontend plus a minimal REST API.

**Auth (UI-level only, deliberately basic):**
- `data/settings.json` = `{ password, sessionSecret }`. `loadOrCreateSettings()` creates it on first run (default password `changeme`, random 32-byte hex secret) and warns while the default is unchanged.
- `POST /api/login` compares with `crypto.timingSafeEqual` and delays failures ~500ms to blunt brute-forcing; on success sets an `HttpOnly`, `SameSite=Lax` cookie (`schedule_auth`, 30 days). Set `COOKIE_SECURE=true` behind HTTPS.
- The cookie value is `HMAC(sessionSecret, current password)` — so the session survives restarts (secret is persisted) but **changing the password invalidates all existing cookies**.
- A gate middleware redirects unauthenticated requests to `/login`. `PUBLIC_FILES` must include everything the login page needs — currently `/login`, `/login.html`, `/style.css`, `/favicon.ico`. **`/style.css` has to stay public or the login page renders unstyled.**
- **`/api/*` is intentionally exempt from the gate.** This was an explicit product decision. Consequences to keep in mind: anyone who can reach the host can still read and rewrite the schedule via `curl /api/swaps`, so the password only hides the UI. To close it, delete the `req.path.startsWith('/api/')` exemption in the gate middleware.

**Endpoints:**
- `GET /api/swaps`
- `POST /api/swaps` — `{date1, status1, date2, status2}`, sets a paired override on both dates
- `POST /api/swaps/single` — `{date, status}`, sets an unpaired override
- `DELETE /api/swaps/:date` — deletes that date's override and, if paired, its partner's too
- `POST /api/login`, `POST /api/logout`, `GET /login`

Backed by flat JSON at `DATA_DIR/swaps.json` (`DATA_DIR` defaults to `./data`, `/app/data` in Docker).

### [Dockerfile](Dockerfile) / [docker-compose.yml](docker-compose.yml)

`node:20-alpine` running `server.js`; compose bind-mounts `./data:/app/data`.
**The Dockerfile `COPY`s frontend files by name** — if you add a new HTML/CSS/JS
file, add it to that `COPY` line or it will 404 in the image.

## Notes for changes

- `data/` is gitignored and dockerignored, so `settings.json` (with the password) is never committed or baked into an image.
- **Removed / disabled features — don't reintroduce them without being asked**: CSV export (`downloadCSV()`, the "📥 Download CSV" button) and the "🔄 Refresh Calendar" button were deliberately deleted. Re-rendering is automatic via `render()`. The fullscreen month view is intentionally flagged off (see `ENABLE_FULLSCREEN_MONTH`).
  - Deleting the CSV removed the only consumer of literal *week numbers*, which is what made the `PATTERN_ANCHOR` parity refactor safe. Nothing displays a week number anymore.
- Neither JSON file in `data/` carries a version marker — if a schema changes, old files won't migrate themselves.
- There is no test suite. Verify changes by running the server and exercising the endpoints with `curl` (auth gate, login/logout, override create/delete) plus a browser pass over the calendar, year picker and fullscreen view.
  - When testing login with `curl`, put the JSON body in a file and use `--data @file`. Inline `-d '{"password":"..."}'` inside shell command substitution gets its quotes mangled and yields a misleading `400`.
