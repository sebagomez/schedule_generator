# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This app generates a full-year work/off-day calendar (currently hardcoded to 2026) for a repeating weekly shift pattern, renders it as a grid of monthly tables, lets individual days be overridden (either paired as a swap — e.g. a colleague covers a work day in exchange for an off day — or edited singly, e.g. a public holiday), and exports the schedule as a CSV. It's a static frontend — [schedule_generator.html](schedule_generator.html), [style.css](style.css), [script.js](script.js) — served by a small Express backend ([server.js](server.js)) that persists overrides to a flat JSON file. It also ships as a Docker image so it can run on any host.

## Running it

- **Local, no persistence**: open `schedule_generator.html` directly in a browser. Overrides won't save (no server to call), but the calendar and CSV export work standalone.
- **Local, with persistence**: `npm install`, then `npm start` (runs [server.js](server.js) on port 3000, default). Visit `http://localhost:3000`. Data is read/written at `data/swaps.json` (created on first override).
- **Docker**: `docker compose up --build`, or `docker build -t schedule-generator . && docker run -p 3000:3000 -v "$(pwd)/data:/app/data" schedule-generator`. Compose bind-mounts `./data` (relative to the repo) to `/app/data`, so `data/swaps.json` shows up directly in the project folder on the host — that's what makes overrides survive container rebuilds, and it's how you'd back up or inspect the file directly. Don't run without something mounted at `/app/data` if persistence matters. `PORT` and `DATA_DIR` are configurable via env vars (see [server.js](server.js)).

## Architecture

- **[style.css](style.css)**: styles for the controls panel, the per-month calendar grid (`.calendar-grid` → `.month` → `.calendar-table`), the work/off-day legend, override states (`.selected-for-swap`, `.swapped`, `.manual-edit`), and the right-click `.context-menu`.
- **[script.js](script.js)** (runs entirely client-side):
  - **Schedule logic (`getBaseWorkSchedule(date)`)**: the core rule engine. It computes an ISO-ish week number for a given date, determines whether that week is odd or even, and maps the day-of-week to `'work'` or `'off'` using a fixed 2-2-3 repeating pattern:
    - Odd weeks: Work Mon–Tue, Off Wed–Thu, Work Fri–Sun
    - Even weeks: Off Mon–Tue, Work Wed–Thu, Off Fri–Sun
    - Sunday is treated as belonging to the previous (Monday-started) week for pattern purposes, so the date is adjusted back one day before the week number is calculated.
  - **`getWorkSchedule(date)`**: the actual source of truth used everywhere else. Wraps `getBaseWorkSchedule` and checks `swapOverrides` first (keyed by `YYYY-MM-DD`, via `formatDateKey`) — an overridden day's status wins over the pattern.
  - **Overrides (`swapOverrides`)**: each entry is `{ status: 'work'|'off', pairedWith: <dateKey>|null }`. A two-day swap sets both dates' entries pointing at each other via `pairedWith`; a single-day edit (from the right-click menu) sets `pairedWith: null`. `revertOverride(date)` `DELETE`s a day's override, and the server cascades the delete to `pairedWith` too — **undoing either side of a swap reverts both days**, which is the whole reason `pairedWith` exists (a flat one-day-at-a-time override map previously left the other side of a swap stuck).
  - **Swap UI**: `swapOverrides` is loaded from `GET /api/swaps` on startup (`loadSwapOverrides`, fails soft if there's no server). `toggleSwapMode()` + `onDayClick()` drive the click-two-days-to-swap flow; `performSwap()` validates the pair has different statuses (a swap only makes sense between one work day and one off day) and `POST`s the pair to `/api/swaps`. **Important**: when reconstructing a `Date` from a stored `YYYY-MM-DD` key, always use `parseDateKey()`, never `new Date(dateKey)` — the latter parses as UTC midnight and silently shifts a day in negative-UTC timezones, which previously caused swaps to compute against the wrong day (see `performSwap`).
  - **Single-day edit UI**: right-clicking any day calls `showContextMenu()`, which offers "Mark as Work/Off" (`setManualOverride()`, `POST`s to `/api/swaps/single`) and, if the day already has an override, "Undo change". Left-clicking an already-overridden day (outside swap mode) is a shortcut for the same undo, via a `confirm()` prompt.
  - **Rendering (`generateCalendar()`)**: builds the 12 month tables (day-of-week headers, leading empty cells, one `<td>` per day tagged `work-day`/`off-day`, plus `swapped` or `manual-edit` depending on `pairedWith`, a click handler, and a `contextmenu` handler) and injects them into `#calendarContainer`. Runs on load (after overrides are fetched) and again on "Refresh Calendar".
  - **Export (`downloadCSV()`)**: independently recomputes the week number for every day (duplicated logic, not reused from `getWorkSchedule`) and streams a CSV (`Month,Date,Day of Week,Week Number,Week Type,Status,Swapped`) as a downloaded Blob named `2026_work_schedule.csv`. The `Swapped` column is really "has any override," paired or not.
- **[server.js](server.js)**: Express app. Serves the static frontend files and a minimal REST API — `GET /api/swaps`, `POST /api/swaps` (body: `{date1, status1, date2, status2}`, sets a paired override on both dates), `POST /api/swaps/single` (body: `{date, status}`, sets an unpaired override), `DELETE /api/swaps/:date` (deletes that date's override and, if it was paired, its partner's too) — backed by a flat JSON file at `DATA_DIR/swaps.json` (`DATA_DIR` defaults to `./data`, overridden to `/app/data` in Docker). No database, no auth — this is a single-user personal tool.
- **[Dockerfile](Dockerfile)** / **[docker-compose.yml](docker-compose.yml)**: `node:20-alpine` image running `server.js`; compose bind-mounts `./data:/app/data` so history isn't lost when the container is rebuilt or recreated.

## Notes for changes

- The target year (2026) is hardcoded in multiple places (`monthNames` loop bounds via `new Date(2026, ...)` in both `generateCalendar()` and `downloadCSV()`, plus the CSV filename and page title/header text). If making the year configurable, update all of these together.
- Week-number calculation logic is currently duplicated between `getBaseWorkSchedule()` and `downloadCSV()` — keep both in sync if you change how week numbers are derived, or better, factor it into a shared function.
- `data/swaps.json`'s schema is `{ [dateKey]: { status, pairedWith } }` with no version marker — if the shape changes again, older files won't migrate themselves.
