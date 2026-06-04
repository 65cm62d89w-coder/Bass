/* app.js — UI controller. Wires weather + forecast + lures + catch log together. */

const LOC_KEY = 'basscast.location.v1';
const PREFS_KEY = 'basscast.prefs.v1';

const state = {
  location: null,      // { lat, lon, label }
  weather: null,
  conditions: null,
  prefs: loadPrefs(),
};

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || { clarity: 'stained', cover: 'any' }; }
  catch { return { clarity: 'stained', cover: 'any' }; }
}
function savePrefs() { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); }

// Prefs plus the current latitude, so the forecast can infer the hemisphere
// (autumn falls in different months north vs. south of the equator).
function condPrefs() {
  return { ...state.prefs, lat: state.location ? state.location.lat : undefined };
}

function loadLocation() {
  try { return JSON.parse(localStorage.getItem(LOC_KEY)); } catch { return null; }
}
function saveLocation(loc) { localStorage.setItem(LOC_KEY, JSON.stringify(loc)); }

/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setupTabs();
  setupModals();
  setupFilters();
  populateLureTypeSelect();

  document.getElementById('refresh-btn').addEventListener('click', () => loadForLocation(state.location, true));

  const saved = loadLocation();
  if (saved) {
    await loadForLocation(saved);
  } else {
    requestGeolocation();
  }
}

/* ---------- Tabs ---------- */
function setupTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'log') renderCatchLog();
      if (tab.dataset.tab === 'patterns') renderPatterns();
      if (tab.dataset.tab === 'lures') renderLures();
    });
  });
}

/* ---------- Location ---------- */
function requestGeolocation() {
  const label = document.getElementById('location-label');
  if (!navigator.geolocation) {
    label.textContent = '📍 Location unavailable — tap “change”';
    openLocationModal();
    return;
  }
  label.textContent = '📍 Locating you…';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const friendly = await reverseGeocode(lat, lon);
      const loc = { lat, lon, label: friendly };
      saveLocation(loc);
      await loadForLocation(loc);
    },
    () => {
      label.textContent = '📍 Location blocked — tap “change”';
      openLocationModal();
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
  );
}

async function loadForLocation(loc, force = false) {
  if (!loc) return;
  state.location = loc;
  document.getElementById('location-label').textContent = `📍 ${loc.label}`;
  document.getElementById('forecast-loading').classList.remove('hidden');
  document.getElementById('forecast-content').classList.add('hidden');
  document.getElementById('forecast-loading').textContent = 'Loading conditions…';

  try {
    state.weather = await fetchWeather(loc.lat, loc.lon);
    state.conditions = buildConditions(state.weather, condPrefs());
    renderForecast();
    renderLures();
    document.getElementById('forecast-loading').classList.add('hidden');
    document.getElementById('forecast-content').classList.remove('hidden');
  } catch (err) {
    document.getElementById('forecast-loading').textContent =
      `Couldn't load weather: ${err.message}. Check your connection and tap ⟳.`;
  }
}

/* ---------- Forecast render ---------- */
function renderForecast() {
  const w = state.weather;
  const c = state.conditions;
  const { score, rating, factors } = scoreActivity(w, c);

  const ring = document.getElementById('score-ring');
  ring.className = `score-ring ${rating.cls}`;
  ring.style.setProperty('--pct', score);
  document.getElementById('score-value').textContent = score;
  document.getElementById('score-rating').textContent = `${rating.emoji} ${rating.label}`;
  document.getElementById('score-summary').textContent = summaryLine(c, rating);

  const fl = document.getElementById('factor-list');
  fl.innerHTML = factors.map((f) =>
    `<li class="factor ${f.kind}"><span class="dot"></span>${escapeHtml(f.text)}</li>`).join('');

  document.getElementById('conditions-grid').innerHTML = conditionsHtml(w, c);

  const windows = bestWindows(w, c);
  const wd = document.getElementById('windows');
  if (!windows.length) {
    wd.innerHTML = '<p class="muted small">No standout windows in the next several hours — fish the low-light edges.</p>';
  } else {
    wd.innerHTML = windows.map((win) =>
      `<div class="window ${win.quality}">
        <span class="window-time">${win.label}</span>
        <span class="window-tag">${win.quality === 'prime' ? 'Prime' : 'Good'}</span>
      </div>`).join('');
  }
}

function summaryLine(c, rating) {
  const season = SEASON_LABELS[c.season] || c.season;
  return `${season} · water ~${fToC(c.waterTempF)}°C · ${c.pressureTrend} pressure`;
}

function conditionsHtml(w, c) {
  const moon = moonInfo(w.moonPhase);
  const cells = [
    ['🌡️', 'Air', `${fToC(w.tempF)}°C`],
    ['💧', 'Water (est.)', `${fToC(c.waterTempF)}°C`],
    ['🧭', `Pressure (${w.pressureTrend})`, `${Math.round(w.pressureHpa)} hPa ${trendArrow(w.pressureTrend)}`],
    ['💨', 'Wind', `${mphToKmh(w.windMph)} km/h ${degToCompass(w.windDir)}`],
    ['☁️', 'Cloud', `${Math.round(w.cloudPct)}%`],
    ['🌅', 'Sunrise', timeOnly(w.sunrise)],
    ['🌇', 'Sunset', timeOnly(w.sunset)],
    [moon.emoji, `Moon · ${moon.illum}% lit`, moon.name],
  ];
  return cells.map(([icon, label, val]) =>
    `<div class="cond-cell"><span class="cond-icon">${icon}</span>
      <span class="cond-val">${val}</span>
      <span class="cond-label">${label}</span></div>`).join('');
}

/* ---------- Lures render ---------- */
function setupFilters() {
  const clarity = document.getElementById('clarity-select');
  const cover = document.getElementById('cover-select');
  clarity.value = state.prefs.clarity;
  cover.value = state.prefs.cover;
  clarity.addEventListener('change', () => {
    state.prefs.clarity = clarity.value; savePrefs();
    if (state.weather) state.conditions = buildConditions(state.weather, condPrefs());
    renderLures();
  });
  cover.addEventListener('change', () => {
    state.prefs.cover = cover.value; savePrefs();
    if (state.weather) state.conditions = buildConditions(state.weather, condPrefs());
    renderLures();
  });
}

function renderLures() {
  const list = document.getElementById('lure-list');
  if (!state.conditions) {
    list.innerHTML = '<p class="muted">Load the forecast first to get condition-based picks.</p>';
    return;
  }
  const learnFn = makeLearningFn(state.conditions);
  const recs = recommendLures(state.conditions, learnFn);

  const ctx = document.getElementById('lure-context');
  const learned = recs.some((r) => r.learnBonus > 0);
  ctx.textContent = learned
    ? '⭐ Picks boosted by lures that worked for you in similar conditions.'
    : 'Recommendations adapt to live weather. Log catches to personalize them.';

  list.innerHTML = recs.map((r, i) => `
    <div class="lure-card ${i === 0 ? 'top' : ''}">
      <div class="lure-rank">${i + 1}</div>
      <div class="lure-icon">${r.icon}</div>
      <div class="lure-body">
        <div class="lure-name">${escapeHtml(r.name)}
          ${r.learnBonus > 0 ? '<span class="learn-badge" title="Boosted by your catches">⭐</span>' : ''}
        </div>
        <div class="lure-color">🎨 ${escapeHtml(r.color || '—')}</div>
        <div class="lure-blurb">${escapeHtml(r.blurb)}</div>
      </div>
      <div class="lure-score">
        <div class="lure-bar"><span style="width:${r.total}%"></span></div>
        <div class="lure-score-num">${r.total}</div>
      </div>
    </div>`).join('');
}

/* ---------- Catch log ---------- */
function populateLureTypeSelect() {
  const sel = document.getElementById('lure-type-input');
  sel.innerHTML = (window.LURE_DB || [])
    .map((l) => `<option value="${l.name}">${l.name}</option>`).join('');
}

function renderCatchLog() {
  const list = loadCatches();
  const el = document.getElementById('catch-list');
  if (!list.length) {
    el.innerHTML = '<p class="muted center empty">No catches logged yet. Tap “+ Log a catch” after you land one — every entry sharpens your recommendations.</p>';
    return;
  }
  el.innerHTML = list.map((c) => {
    const cond = c.conditions || {};
    const date = new Date(c.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    const size = [c.weight ? `${c.weight} lb` : null, c.length ? `${c.length}"` : null].filter(Boolean).join(' · ');
    return `
      <div class="catch-card" data-id="${c.id}">
        <div class="catch-top">
          <div>
            <span class="catch-species">${escapeHtml(c.species || 'Bass')}</span>
            ${size ? `<span class="catch-size">${escapeHtml(size)}</span>` : ''}
          </div>
          <button class="link-btn danger" data-del="${c.id}">delete</button>
        </div>
        <div class="catch-lure">${escapeHtml(c.lureType)}${c.lureColor ? ` — ${escapeHtml(c.lureColor)}` : ''}</div>
        <div class="catch-meta">
          ${chip(date)}
          ${c.cover ? chip(coverLabel(c.cover)) : ''}
          ${c.depth ? chip(`${c.depth} ft`) : ''}
          ${cond.waterTempF ? chip(`${fToC(cond.waterTempF)}°C`) : ''}
          ${cond.season ? chip(SEASON_LABELS[cond.season] || cond.season) : ''}
          ${cond.pressureTrend ? chip(`${cond.pressureTrend} baro`) : ''}
        </div>
        ${c.notes ? `<div class="catch-notes">“${escapeHtml(c.notes)}”</div>` : ''}
      </div>`;
  }).join('');

  el.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (confirm('Delete this catch?')) { deleteCatch(btn.dataset.del); renderCatchLog(); }
    });
  });
}

/* ---------- Patterns ---------- */
function renderPatterns() {
  const p = analyzePatterns();
  const el = document.getElementById('patterns-content');
  if (!p.total) {
    el.innerHTML = '<p class="muted center empty">Patterns appear once you log catches. The app cross-references your catches with the conditions at the time to surface what’s working — and where.</p>';
    return;
  }
  const topList = (arr, fmt = (k, v) => `${k} <span class="muted">×${v}</span>`) =>
    arr.slice(0, 4).map(([k, v]) => `<li>${fmt(k, v)}</li>`).join('') || '<li class="muted">—</li>';

  const big = p.biggest;
  el.innerHTML = `
    <div class="stat-row">
      <div class="stat"><div class="stat-num">${p.total}</div><div class="stat-label">catches</div></div>
      <div class="stat"><div class="stat-num">${p.totalWeight || 0}</div><div class="stat-label">total lb</div></div>
      <div class="stat"><div class="stat-num">${big && big.weight ? big.weight : '—'}</div><div class="stat-label">personal best (lb)</div></div>
    </div>

    <h3 class="section-title">Your most productive lures</h3>
    <ul class="pattern-list">${topList(p.topLures)}</ul>

    <h3 class="section-title">Top colors</h3>
    <ul class="pattern-list">${topList(p.topColors)}</ul>

    <h3 class="section-title">Where they're biting</h3>
    <ul class="pattern-list">${topList(p.topCover.map(([k, v]) => [coverLabel(k), v]))}</ul>

    <h3 class="section-title">Conditions that produce</h3>
    <ul class="pattern-list">
      ${topList(p.bySeason.map(([k, v]) => [SEASON_LABELS[k] || k, v]))}
      ${topList(p.byPressure.map(([k, v]) => [`${k} pressure`, v]))}
      ${topList(p.byClarity.map(([k, v]) => [`${k} water`, v]))}
    </ul>

    <div class="insight">${escapeHtml(buildInsight(p))}</div>
  `;
}

function buildInsight(p) {
  const bits = [];
  if (p.topLures[0]) bits.push(`Your go-to is the ${p.topLures[0][0]} (${p.topLures[0][1]} fish)`);
  if (p.bySeason[0]) bits.push(`you score most during ${SEASON_LABELS[p.bySeason[0][0]] || p.bySeason[0][0]}`);
  if (p.byPressure[0]) bits.push(`often on ${p.byPressure[0][0]} pressure`);
  if (p.topCover[0]) bits.push(`around ${coverLabel(p.topCover[0][0]).toLowerCase()}`);
  return bits.length ? `💡 ${bits.join(', ')}.` : '';
}

/* ---------- Modals ---------- */
function setupModals() {
  const catchModal = document.getElementById('catch-modal');
  document.getElementById('add-catch-btn').addEventListener('click', openCatchModal);
  document.getElementById('close-modal').addEventListener('click', () => catchModal.classList.add('hidden'));
  document.getElementById('cancel-catch').addEventListener('click', () => catchModal.classList.add('hidden'));
  document.getElementById('catch-form').addEventListener('submit', onSaveCatch);

  const locModal = document.getElementById('location-modal');
  document.getElementById('change-location').addEventListener('click', openLocationModal);
  document.getElementById('close-location').addEventListener('click', () => locModal.classList.add('hidden'));
  document.getElementById('use-gps').addEventListener('click', () => {
    locModal.classList.add('hidden'); requestGeolocation();
  });
  document.getElementById('location-form').addEventListener('submit', onLocationSearch);

  [catchModal, locModal].forEach((m) =>
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }));
}

function openCatchModal() {
  const note = document.getElementById('catch-conditions-note');
  note.textContent = state.conditions
    ? `Saving current conditions: ${SEASON_LABELS[state.conditions.season]}, water ~${fToC(state.conditions.waterTempF)}°C, ${state.conditions.pressureTrend} pressure, ${state.prefs.clarity} water.`
    : 'Load the forecast first to attach live conditions (you can still log the catch).';
  document.getElementById('catch-modal').classList.remove('hidden');
}

function onSaveCatch(e) {
  e.preventDefault();
  const f = e.target;
  const entry = {
    species: f.species.value,
    weight: f.weight.value,
    length: f.length.value,
    lureType: f.lureType.value,
    lureColor: f.lureColor.value.trim(),
    cover: f.cover.value,
    depth: f.depth.value,
    notes: f.notes.value.trim(),
    location: state.location ? { lat: state.location.lat, lon: state.location.lon, label: state.location.label } : null,
    conditions: state.conditions ? { ...state.conditions } : null,
  };
  addCatch(entry);
  f.reset();
  document.getElementById('catch-modal').classList.add('hidden');
  renderCatchLog();
  renderLures(); // immediately reflect learning
  toast('Catch logged — recommendations updated 🎣');
}

function openLocationModal() {
  document.getElementById('geo-results').innerHTML = '';
  document.getElementById('location-query').value = '';
  document.getElementById('location-modal').classList.remove('hidden');
}

async function onLocationSearch(e) {
  e.preventDefault();
  const q = document.getElementById('location-query').value.trim();
  if (!q) return;
  const results = document.getElementById('geo-results');
  results.innerHTML = '<p class="muted small">Searching…</p>';
  try {
    const places = await geocodePlace(q);
    if (!places.length) { results.innerHTML = '<p class="muted small">No matches found.</p>'; return; }
    results.innerHTML = places.map((p, i) =>
      `<button class="geo-result" data-i="${i}">
        <strong>${escapeHtml(p.name)}</strong><span class="muted">${escapeHtml(p.admin)}</span>
      </button>`).join('');
    results.querySelectorAll('.geo-result').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const p = places[+btn.dataset.i];
        const loc = { lat: p.lat, lon: p.lon, label: `${p.name}${p.admin ? ', ' + p.admin.split(',')[0] : ''}` };
        saveLocation(loc);
        document.getElementById('location-modal').classList.add('hidden');
        await loadForLocation(loc);
      });
    });
  } catch (err) {
    results.innerHTML = `<p class="muted small">Search failed: ${escapeHtml(err.message)}</p>`;
  }
}

/* ---------- Helpers ---------- */
function chip(text) { return `<span class="chip">${escapeHtml(String(text))}</span>`; }

function coverLabel(v) {
  return ({ open: 'Open water', weeds: 'Weeds/grass', wood: 'Wood/laydowns', rock: 'Rock/riprap', docks: 'Docks' }[v]) || v;
}

function trendArrow(t) { return t === 'falling' ? '↓' : t === 'rising' ? '↑' : '→'; }

function degToCompass(deg) {
  if (deg == null) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function timeOnly(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}


function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

let toastTimer;
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
