/* catches.js — catch log persistence + pattern learning.
 *
 * Catches are stored in localStorage. Each catch snapshots the conditions at
 * the time so we can (a) build location/condition patterns and (b) bias lure
 * recommendations toward what has actually worked for the user.
 */

const CATCH_KEY = 'basscast.catches.v1';

function loadCatches() {
  try {
    return JSON.parse(localStorage.getItem(CATCH_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCatches(list) {
  localStorage.setItem(CATCH_KEY, JSON.stringify(list));
}

function addCatch(entry) {
  const list = loadCatches();
  entry.id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  entry.timestamp = Date.now();
  list.unshift(entry);
  saveCatches(list);
  return entry;
}

function deleteCatch(id) {
  saveCatches(loadCatches().filter((c) => c.id !== id));
}

/**
 * Similarity between a logged catch's conditions and the current conditions.
 * Returns 0..1. Used to weight how relevant a past catch is right now.
 */
function conditionSimilarity(snap, cond) {
  if (!snap) return 0;
  let score = 0;
  let weight = 0;

  // Water temp (within 8°F = strong match).
  if (typeof snap.waterTempF === 'number' && typeof cond.waterTempF === 'number') {
    const d = Math.abs(snap.waterTempF - cond.waterTempF);
    score += Math.max(0, 1 - d / 12) * 3; weight += 3;
  }
  // Season exact match.
  if (snap.season && cond.season) {
    score += (snap.season === cond.season ? 1 : 0) * 2; weight += 2;
  }
  // Pressure trend.
  if (snap.pressureTrend && cond.pressureTrend) {
    score += (snap.pressureTrend === cond.pressureTrend ? 1 : 0) * 1.5; weight += 1.5;
  }
  // Clarity.
  if (snap.clarity && cond.clarity) {
    score += (snap.clarity === cond.clarity ? 1 : 0); weight += 1;
  }
  // Light condition.
  if (typeof snap.isLowLight === 'boolean') {
    score += (snap.isLowLight === cond.isLowLight ? 1 : 0) * 0.8; weight += 0.8;
  }
  return weight ? score / weight : 0;
}

/**
 * Build a learning function for the lure engine. Lures that caught fish in
 * conditions similar to now get a bonus (0..~28). Bigger/more recent fish and
 * closer condition matches count more.
 */
function makeLearningFn(cond) {
  const list = loadCatches();
  if (!list.length) return () => 0;

  const byLure = {};
  const now = Date.now();
  for (const c of list) {
    const sim = conditionSimilarity(c.conditions, cond);
    if (sim < 0.25) continue; // not relevant to current conditions
    // Recency: full weight < 1yr, decaying after.
    const ageDays = (now - (c.timestamp || now)) / 86400000;
    const recency = ageDays < 365 ? 1 : Math.max(0.3, 1 - (ageDays - 365) / 1095);
    const sizeBoost = 1 + Math.min(1, (parseFloat(c.weight) || 0) / 5); // up to 2x for a 5lb+
    const contribution = sim * recency * sizeBoost;
    byLure[c.lureType] = (byLure[c.lureType] || 0) + contribution;
  }

  return (lureId) => {
    const name = LURE_NAME_BY_ID[lureId];
    const raw = byLure[name] || 0;
    // Squash so a couple of good catches help, but it never dominates the base.
    return Math.min(28, Math.round(raw * 10));
  };
}

// Map lure ids <-> display names (must match lures.js names used in the form).
const LURE_NAME_BY_ID = Object.fromEntries(
  (window.LURE_DB || []).map((l) => [l.id, l.name])
);

/**
 * Aggregate logged catches into human-readable patterns.
 */
function analyzePatterns() {
  const list = loadCatches();
  if (!list.length) return { total: 0 };

  const tally = (key, transform = (x) => x) => {
    const m = {};
    for (const c of list) {
      const v = transform(c[key] ?? (c.conditions ? c.conditions[key] : undefined));
      if (v === undefined || v === null || v === '') continue;
      m[v] = (m[v] || 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };

  const condKey = (key) => {
    const m = {};
    for (const c of list) {
      const v = c.conditions ? c.conditions[key] : undefined;
      if (v === undefined || v === null || v === '') continue;
      m[v] = (m[v] || 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };

  // Best lure (by count and by total weight).
  const lureWeight = {};
  let totalWeight = 0;
  let biggest = null;
  for (const c of list) {
    const w = parseFloat(c.weight) || 0;
    lureWeight[c.lureType] = (lureWeight[c.lureType] || 0) + w;
    totalWeight += w;
    if (!biggest || w > (parseFloat(biggest.weight) || 0)) biggest = c;
  }

  return {
    total: list.length,
    totalWeight: +totalWeight.toFixed(1),
    biggest,
    topLures: tally('lureType'),
    topColors: tally('lureColor', (x) => (x ? String(x).toLowerCase() : x)),
    topCover: tally('cover'),
    bySeason: condKey('season'),
    byPressure: condKey('pressureTrend'),
    byClarity: condKey('clarity'),
    lureByWeight: Object.entries(lureWeight).sort((a, b) => b[1] - a[1]),
  };
}

window.loadCatches = loadCatches;
window.addCatch = addCatch;
window.deleteCatch = deleteCatch;
window.makeLearningFn = makeLearningFn;
window.analyzePatterns = analyzePatterns;
window.conditionSimilarity = conditionSimilarity;
