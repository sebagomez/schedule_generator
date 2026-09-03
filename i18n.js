/**
 * Translations and language handling, shared by the app and the login page.
 *
 * Default language is Spanish. The flag shown for Spanish is the Uruguayan one
 * (deliberately, not Spain's) - see LANGUAGES below.
 *
 * Month and weekday names are NOT stored here: they come from Intl with the
 * locale below, so there are no 36 extra strings to keep in sync.
 *
 * NOTE: this file is served to the login page too, so it must stay in
 * PUBLIC_FILES in server.js or the login page breaks for logged-out users.
 */

const DEFAULT_LANG = 'es';
const LANG_STORAGE_KEY = 'schedule_lang';

const LANGUAGES = [
  { code: 'es', label: 'Español', flag: '🇺🇾', locale: 'es-UY' },
  { code: 'en', label: 'English', flag: '🇬🇧', locale: 'en-GB' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹', locale: 'it-IT' }
];

const TRANSLATIONS = {
  es: {
    appTitle: 'Calendario de Turnos',
    subtitle: 'Tu turno: Semanas impares: Trabajo 2, Libre 2, Trabajo 3 | Semanas pares: Libre 2, Trabajo 2, Libre 3',
    langLabel: 'Idioma',
    yearLabel: 'Año',
    swapDays: '🔀 Intercambiar días',
    swapActive: '✅ Elegí 2 días para intercambiar',
    hintPointer: 'Para intercambiar días: hacé clic en "Intercambiar días" y después elegí un día de trabajo y uno libre. Hacé clic derecho en cualquier día para más opciones (marcar como trabajo/libre, deshacer). Hacé clic en un día marcado (🔀/✏️) para deshacerlo rápido.',
    hintTouch: 'Para intercambiar días: tocá "Intercambiar días" y después elegí un día de trabajo y uno libre. Tocá cualquier día para ver las opciones (marcar como trabajo/libre, deshacer).',
    hintFullscreen: ' Tocá ⛶ en cualquier mes para verlo en pantalla completa.',
    legend: 'Referencias:',
    workDay: 'Día de trabajo',
    offDay: 'Día libre',
    swappedDay: 'Día intercambiado',
    manualDay: 'Día editado manualmente',
    statusWork: 'Trabajo',
    statusOff: 'Libre',
    markAsWork: 'Marcar como Trabajo',
    markAsOff: 'Marcar como Libre',
    undoChange: '↩ Deshacer cambio',
    cancel: 'Cancelar',
    confirmUndo: '¿Deshacer el cambio del {date}?',
    pickOneEach: 'Elegí un día de trabajo y uno libre para intercambiar.',
    errSwap: 'No se pudo guardar el intercambio. ¿Está corriendo el servidor?',
    errUndo: 'No se pudo deshacer el cambio. ¿Está corriendo el servidor?',
    errSave: 'No se pudo guardar el cambio. ¿Está corriendo el servidor?',
    titleSwapped: 'Día intercambiado: tocá para deshacer',
    titleManual: 'Día editado manualmente: tocá para deshacer',
    expandTitle: 'Ver {month} en pantalla completa',
    fsPrev: '‹ Anterior',
    fsNext: 'Siguiente ›',
    fsClose: '✕ Cerrar',
    loginTitle: 'Calendario de Turnos',
    loginHint: 'Ingresá la contraseña para ver el calendario.',
    passwordLabel: 'Contraseña',
    signIn: 'Ingresar',
    errWrongPassword: 'Contraseña incorrecta. Probá de nuevo.',
    errSignIn: 'No se pudo ingresar (error {status}).',
    errNetwork: 'No se pudo conectar con el servidor.'
  },

  en: {
    appTitle: 'Work Schedule Calendar',
    subtitle: 'Your schedule: Odd weeks: Work 2, Off 2, Work 3 | Even weeks: Off 2, Work 2, Off 3',
    langLabel: 'Language',
    yearLabel: 'Year',
    swapDays: '🔀 Swap Days',
    swapActive: '✅ Select 2 days to swap',
    hintPointer: 'To swap days: click "Swap Days", then pick one work day and one off day. Right-click any day for more options (mark as work/off, undo). Click a marked day (🔀/✏️) to quickly undo it.',
    hintTouch: 'To swap days: tap "Swap Days", then pick one work day and one off day. Tap any day for options (mark as work/off, undo).',
    hintFullscreen: ' Tap ⛶ on any month to open it fullscreen for a screenshot.',
    legend: 'Legend:',
    workDay: 'Work Day',
    offDay: 'Off Day',
    swappedDay: 'Swapped Day',
    manualDay: 'Manually Edited Day',
    statusWork: 'Work',
    statusOff: 'Off',
    markAsWork: 'Mark as Work',
    markAsOff: 'Mark as Off',
    undoChange: '↩ Undo change',
    cancel: 'Cancel',
    confirmUndo: 'Undo the change on {date}?',
    pickOneEach: 'Pick one work day and one off day to swap.',
    errSwap: 'Could not save the swap. Is the server running?',
    errUndo: 'Could not undo the change. Is the server running?',
    errSave: 'Could not save the change. Is the server running?',
    titleSwapped: 'Swapped day - tap to undo',
    titleManual: 'Manually edited day - tap to undo',
    expandTitle: 'View {month} fullscreen',
    fsPrev: '‹ Prev',
    fsNext: 'Next ›',
    fsClose: '✕ Close',
    loginTitle: 'Work Schedule',
    loginHint: 'Enter the password to view the schedule.',
    passwordLabel: 'Password',
    signIn: 'Sign in',
    errWrongPassword: 'Incorrect password. Try again.',
    errSignIn: 'Could not sign in (error {status}).',
    errNetwork: 'Could not reach the server.'
  },

  it: {
    appTitle: 'Calendario dei Turni',
    subtitle: 'Il tuo turno: Settimane dispari: Lavoro 2, Libero 2, Lavoro 3 | Settimane pari: Libero 2, Lavoro 2, Libero 3',
    langLabel: 'Lingua',
    yearLabel: 'Anno',
    swapDays: '🔀 Scambia giorni',
    swapActive: '✅ Scegli 2 giorni da scambiare',
    hintPointer: 'Per scambiare i giorni: clicca "Scambia giorni", poi scegli un giorno di lavoro e uno libero. Clicca con il tasto destro su un giorno per altre opzioni (segna come lavoro/libero, annulla). Clicca su un giorno segnato (🔀/✏️) per annullarlo rapidamente.',
    hintTouch: 'Per scambiare i giorni: tocca "Scambia giorni", poi scegli un giorno di lavoro e uno libero. Tocca un giorno qualsiasi per le opzioni (segna come lavoro/libero, annulla).',
    hintFullscreen: ' Tocca ⛶ su un mese per aprirlo a schermo intero.',
    legend: 'Legenda:',
    workDay: 'Giorno di lavoro',
    offDay: 'Giorno libero',
    swappedDay: 'Giorno scambiato',
    manualDay: 'Giorno modificato manualmente',
    statusWork: 'Lavoro',
    statusOff: 'Libero',
    markAsWork: 'Segna come Lavoro',
    markAsOff: 'Segna come Libero',
    undoChange: '↩ Annulla modifica',
    cancel: 'Annulla',
    confirmUndo: 'Annullare la modifica del {date}?',
    pickOneEach: 'Scegli un giorno di lavoro e uno libero da scambiare.',
    errSwap: 'Impossibile salvare lo scambio. Il server è attivo?',
    errUndo: 'Impossibile annullare la modifica. Il server è attivo?',
    errSave: 'Impossibile salvare la modifica. Il server è attivo?',
    titleSwapped: 'Giorno scambiato: tocca per annullare',
    titleManual: 'Giorno modificato manualmente: tocca per annullare',
    expandTitle: 'Vedi {month} a schermo intero',
    fsPrev: '‹ Prec.',
    fsNext: 'Succ. ›',
    fsClose: '✕ Chiudi',
    loginTitle: 'Calendario dei Turni',
    loginHint: 'Inserisci la password per vedere il calendario.',
    passwordLabel: 'Password',
    signIn: 'Accedi',
    errWrongPassword: 'Password errata. Riprova.',
    errSignIn: 'Impossibile accedere (errore {status}).',
    errNetwork: 'Impossibile raggiungere il server.'
  }
};

let currentLang = DEFAULT_LANG;

function isSupported(code) {
  return LANGUAGES.some(l => l.code === code);
}

function getLang() {
  return currentLang;
}

function getLocale() {
  const entry = LANGUAGES.find(l => l.code === currentLang);
  return entry ? entry.locale : 'es-UY';
}

function loadLang() {
  let stored = null;
  try {
    stored = localStorage.getItem(LANG_STORAGE_KEY);
  } catch (err) {
    // Private mode / storage disabled - fall back to the default.
  }
  currentLang = isSupported(stored) ? stored : DEFAULT_LANG;
  return currentLang;
}

function setLang(code) {
  if (!isSupported(code)) return currentLang;
  currentLang = code;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, code);
  } catch (err) {
    // Not fatal: the choice just won't survive a reload.
  }
  document.documentElement.lang = code;
  return currentLang;
}

// t('confirmUndo', { date: '...' })
function t(key, vars) {
  const table = TRANSLATIONS[currentLang] || TRANSLATIONS[DEFAULT_LANG];
  let text = table[key] != null ? table[key] : (TRANSLATIONS[DEFAULT_LANG][key] || key);
  if (vars) {
    Object.keys(vars).forEach(name => {
      text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), vars[name]);
    });
  }
  return text;
}

// ---- Locale-driven date names (no hand-maintained month/day lists) ----

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function monthName(monthIndex) {
  const formatted = new Intl.DateTimeFormat(getLocale(), { month: 'long' })
    .format(new Date(2026, monthIndex, 1));
  return capitalise(formatted);
}

// Short weekday names, Monday first.
function weekdayNames() {
  const formatter = new Intl.DateTimeFormat(getLocale(), { weekday: 'short' });
  const names = [];
  // 2026-01-05 is a Monday.
  for (let i = 0; i < 7; i++) {
    const day = new Date(2026, 0, 5 + i);
    names.push(capitalise(formatter.format(day).replace(/\.$/, '')));
  }
  return names;
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat(getLocale(), {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  }).format(date);
}

// ---- DOM helpers ----

// Applies translations to any element carrying data-i18n / data-i18n-title.
function applyStaticTranslations(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  scope.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  const titleKey = document.body && document.body.dataset.i18nTitle;
  if (titleKey) document.title = t(titleKey);
  document.documentElement.lang = currentLang;
}

// Renders the flag buttons. onChange is called after the language switches.
function buildLanguageSwitcher(container, onChange) {
  if (!container) return;
  container.innerHTML = '';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', t('langLabel'));

  LANGUAGES.forEach(lang => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lang-btn' + (lang.code === currentLang ? ' active' : '');
    btn.dataset.lang = lang.code;
    btn.title = lang.label;
    btn.setAttribute('aria-label', lang.label);
    btn.setAttribute('aria-pressed', String(lang.code === currentLang));

    const flag = document.createElement('span');
    flag.className = 'lang-flag';
    flag.textContent = lang.flag;
    btn.appendChild(flag);

    btn.addEventListener('click', () => {
      if (getLang() === lang.code) return;
      setLang(lang.code);
      buildLanguageSwitcher(container, onChange);
      applyStaticTranslations();
      if (typeof onChange === 'function') onChange(lang.code);
    });

    container.appendChild(btn);
  });
}

loadLang();
