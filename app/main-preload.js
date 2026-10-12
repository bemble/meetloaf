// Preload for the main MeetLoaf (Meet) window.
//
// This file is not loaded as-is: main assembles the real preload at launch by
// prepending Dark Reader's source (see buildMeetPreload in main.js). It runs
// in the sandboxed isolated world, which shares the page's DOM but not its
// JavaScript, so the page never sees `window.DarkReader` and we never see
// Meet's globals.
const { ipcRenderer } = require('electron');

// Bridge for the injected content script: it can't reach IPC directly
// (different JS world under contextIsolation), so it postMessages to us
// and we forward to main. Origin check is loose because Meet uses several
// google.com subdomains internally.
window.addEventListener('message', (e) => {
  if (!e.data || e.data.source !== 'meetloaf-injected') return;
  if (e.data.type === 'open-settings') {
    ipcRenderer.send('main:open-settings');
  }
  if (e.data.type === 'present-tab') {
    ipcRenderer.send('main:present-tab');
  }
  // Call-phase transitions from the DOM watcher — main turns these into the
  // Home Assistant join/leave events (and gates always-on-top).
  if (e.data.type === 'meeting-phase') {
    ipcRenderer.send('main:meeting-phase', String(e.data.phase || 'unknown'));
  }
});

// ─── Dark theme for Meet's home page ───────────────────────────────────────
//
// Dark Reader is enabled from here, before Meet parses a single byte of its
// document, rather than at dom-ready: by then the page has already painted in
// light, and every full load (launch, home → pre-join, rejoin) flashed light
// until the dark overrides landed. Run this early, Dark Reader drops a dark
// fallback stylesheet into the document before the first paint and styles
// each node as the parser adds it — the same trick the extension uses by
// running at document_start. Main says whether dark is wanted; it decides
// (OS theme, the setting, the call phase), we just apply.

// Only Meet itself and the signed-out landing page it bounces to. Google's
// sign-in pages render fine in dark mode on their own and are best not touched.
const THEMED_HOSTS = ['meet.google.com', 'workspace.google.com'];

const MEET_DARK_THEME = { mode: 1, brightness: 100, contrast: 100, sepia: 0, grayscale: 0 };
// Dark Reader also injects a small <script> to proxy CSSOM rule insertion and
// custom-element registration. Meet enforces Trusted Types, which blocks that
// script, and Meet styles through <style> elements anyway, so the proxies are
// switched off here. The injection attempt itself is unconditional and still
// logs two Trusted Types errors in the page console per enable; harmless.
const MEET_DARK_FIXES = {
  invert: [], css: '', ignoreInlineStyle: [], ignoreImageAnalysis: [], ignoreCSSUrl: [],
  disableStyleSheetsProxy: true,
  disableCustomElementRegistryProxy: true
};

(function bootMeetTheme() {
  const dr = window.DarkReader;
  if (!dr || !THEMED_HOSTS.includes(location.hostname)) return;
  // Dark Reader fetches stylesheets to analyse them; the page's own fetch is
  // the right one here (the default is meant for the extension's background).
  dr.setFetchMethod(window.fetch);

  // Idempotent: safe to call on every push from main.
  const apply = (want) => {
    try {
      if (want) { if (!dr.isEnabled()) dr.enable(MEET_DARK_THEME, MEET_DARK_FIXES); }
      else if (dr.isEnabled()) dr.disable();
    } catch (err) {
      console.warn('[meetloaf] dark theme failed:', err.message);
    }
  };

  // Dark Reader copes with a document that has no <head> yet, but it needs
  // the root element to hang its fallback style on. A preload can run before
  // even <html> exists, so wait for it if it isn't there.
  const whenRootReady = (fn) => {
    if (document.documentElement) { fn(); return; }
    const mo = new MutationObserver(() => {
      if (!document.documentElement) return;
      mo.disconnect();
      fn();
    });
    mo.observe(document, { childList: true });
  };

  // Synchronous on purpose: the answer has to be in hand before the first
  // paint, and there's nothing else to do until then.
  let want = false;
  try { want = !!ipcRenderer.sendSync('main:meet-dark-wanted'); } catch { /* main not listening */ }
  ipcRenderer.on('main:meet-dark', (_e, next) => { want = !!next; whenRootReady(() => apply(want)); });
  whenRootReady(() => apply(want));
})();
