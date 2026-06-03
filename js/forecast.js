/* forecast.js — turns weather into a bass activity forecast.
 *
 * Bass feeding is driven by water temperature, barometric pressure (and its
 * trend), light level / cloud cover, wind, time of day, and season. We combine
 * these into a 0..100 activity score with human-readable reasons.
 */

/**
 * Estimate water (surface) temperature from recent air temps. Water lags and
 * dampens air swings, so we bias toward the daily mean. Good enough to drive
 * seasonal lure logic without a sensor.
 */
function estimateWaterTempF(weather) {
  const mean = (weather.hiF + weather.loF) / 2;
  // Surface water tends to sit a touch below the air mean in most seasons.
  return Math.round(mean - 2);
}

/** Derive a coarse seasonal phase from water temp. */
function deriveSeason(waterTempF) {
  if (waterTempF < 45) return 'winter';
  if (waterTempF < 58) return 'prespawn';
  if (waterTempF < 68) return 'spawn';
  if (waterTempF < 74) return 'postspawn';
  if (waterTempF < 86) return 'summer';
  return 'summer';
}

const SEASON_LABELS = {
  winter: 'Winter (cold-water)',
  prespawn: 'Pre-spawn',
  spawn: 'Spawn',
  postspawn: 'Post-spawn',
  summer: 'Summer',
  fall: 'Fall',
};

/** Is it within ~1h of sunrise/sunset (prime low-light feeding)? */
function lowLightInfo(weather, now = new Date()) {
  if (!weather.sunrise || !weather.sunset) {
    return { isLowLight: false, isBright: false };
  }
  const sr = new Date(weather.sunrise).getTime();
  const ss = new Date(weather.sunset).getTime();
  const t = now.getTime();
  const hour = 60 * 60 * 1000;
  const nearSunrise = Math.abs(t - sr) <= 1.25 * hour;
  const nearSunset = Math.abs(t - ss) <= 1.25 * hour;
  const isLowLight = nearSunrise || nearSunset || weather.cloudPct >= 80;
  const midday = t > sr + 3 * hour && t < ss - 3 * hour;
  const isBright = midday && weather.cloudPct < 30 && weather.isDay;
  return { isLowLight, isBright };
}

/**
 * Build the conditions object consumed by the lure engine + scorer.
 */
function buildConditions(weather, userPrefs = {}, now = new Date()) {
  const waterTempF = estimateWaterTempF(weather);
  let season = deriveSeason(waterTempF);
  // Cooling water in autumn months behaves like "fall" pattern.
  const month = now.getMonth(); // 0-based
  const northernFall = month >= 8 && month <= 10; // Sep-Nov
  const southernFall = month >= 2 && month <= 4;   // Mar-May (S. hemisphere)
  if ((season === 'summer' || season === 'postspawn') && (northernFall || southernFall)) {
    season = 'fall';
  }
  const light = lowLightInfo(weather, now);

  return {
    waterTempF,
    season,
    clarity: userPrefs.clarity || 'stained',
    cover: userPrefs.cover || 'any',
    cloudPct: weather.cloudPct,
    windMph: weather.windMph,
    pressureTrend: weather.pressureTrend,
    pressureState: weather.pressureState,
    pressureInHg: weather.pressureInHg,
    isLowLight: light.isLowLight,
    isBright: light.isBright,
    isDay: weather.isDay,
    precip: weather.precip,
  };
}

/**
 * Score bass activity 0..100 with weighted factors and explanatory reasons.
 */
function scoreActivity(weather, conditions, now = new Date()) {
  const factors = [];
  let score = 50; // neutral baseline

  // --- Water temperature (the master variable) ---
  const wt = conditions.waterTempF;
  if (wt >= 58 && wt <= 74) {
    score += 14; factors.push(good(`Water ~${wt}°F is in the prime bass feeding range`));
  } else if (wt >= 50 && wt < 58) {
    score += 6; factors.push(ok(`Water ~${wt}°F — bass active but metabolism slowing`));
  } else if (wt > 74 && wt <= 84) {
    score += 4; factors.push(ok(`Water ~${wt}°F — warm; fish early, late, or deep`));
  } else if (wt < 50) {
    score -= 10; factors.push(bad(`Water ~${wt}°F is cold — slow finesse presentations`));
  } else {
    score -= 8; factors.push(bad(`Water ~${wt}°F is hot — bite likely only at low light`));
  }

  // --- Barometric pressure trend (huge for bass) ---
  if (conditions.pressureTrend === 'falling') {
    score += 16; factors.push(good('Falling pressure ahead of a front — classic feeding window'));
  } else if (conditions.pressureTrend === 'rising') {
    score -= 10; factors.push(bad('Rising pressure (post-front) — expect a tougher, tighter bite'));
  } else {
    score += 4; factors.push(ok('Steady pressure — consistent, predictable bite'));
  }
  if (conditions.pressureState === 'high') {
    score -= 6; factors.push(bad('High barometric pressure — fish tight to cover, downsize'));
  } else if (conditions.pressureState === 'low') {
    score += 6; factors.push(good('Low pressure — bass tend to roam and feed'));
  }

  // --- Light / cloud cover ---
  if (conditions.isLowLight) {
    score += 12; factors.push(good('Low light — peak movement and feeding'));
  } else if (conditions.isBright) {
    score -= 6; factors.push(bad('Bright midday sun — bass hold to shade and cover'));
  } else if (conditions.cloudPct >= 50) {
    score += 6; factors.push(ok('Overcast — fish roam farther from cover'));
  }

  // --- Wind ---
  if (conditions.windMph >= 6 && conditions.windMph <= 15) {
    score += 8; factors.push(good(`${Math.round(conditions.windMph)} mph wind — light chop activates feeding`));
  } else if (conditions.windMph > 18) {
    score -= 6; factors.push(bad(`${Math.round(conditions.windMph)} mph wind — tough to fish, find protected water`));
  } else if (conditions.windMph < 3) {
    score -= 2; factors.push(ok('Slick calm — finesse and topwater at first/last light'));
  }

  // --- Precipitation ---
  if (conditions.precip > 0 && conditions.precip < 0.1) {
    score += 4; factors.push(ok('Light rain — can spark a feed, reaction baits shine'));
  } else if (conditions.precip >= 0.2) {
    score -= 3; factors.push(ok('Heavy rain — runoff and mud; fish current breaks'));
  }

  // --- Season nudge ---
  if (conditions.season === 'prespawn' || conditions.season === 'fall') {
    score += 6; factors.push(good(`${SEASON_LABELS[conditions.season]} — aggressive feeding period`));
  } else if (conditions.season === 'spawn') {
    score += 3; factors.push(ok('Spawn — sight-fish beds; reaction strikes over hunger'));
  } else if (conditions.season === 'winter') {
    factors.push(ok('Winter — target warmest water in the afternoon'));
  }

  score = Math.max(2, Math.min(98, Math.round(score)));
  return { score, rating: ratingFor(score), factors };
}

function ratingFor(score) {
  if (score >= 80) return { label: 'Excellent', cls: 'excellent', emoji: '🔥' };
  if (score >= 65) return { label: 'Good', cls: 'good', emoji: '👍' };
  if (score >= 45) return { label: 'Fair', cls: 'fair', emoji: '🆗' };
  if (score >= 30) return { label: 'Slow', cls: 'slow', emoji: '😐' };
  return { label: 'Tough', cls: 'tough', emoji: '🥶' };
}

/**
 * Identify the best fishing windows today from the hourly series.
 * Returns up to 3 windows with a small per-hour heuristic score.
 */
function bestWindows(weather, conditions) {
  const h = weather.raw?.hourly;
  if (!h?.time) return [];
  const now = Date.now();
  const sr = weather.sunrise ? new Date(weather.sunrise).getTime() : null;
  const ss = weather.sunset ? new Date(weather.sunset).getTime() : null;
  const hour = 3600 * 1000;

  const scored = h.time.map((t, i) => {
    const ms = new Date(t).getTime();
    let s = 50;
    const cloud = h.cloud_cover?.[i] ?? 50;
    const wind = h.wind_speed_10m?.[i] ?? 5;
    const isDay = h.is_day?.[i] === 1;
    if (sr && Math.abs(ms - sr) <= 1.25 * hour) s += 25;
    if (ss && Math.abs(ms - ss) <= 1.25 * hour) s += 25;
    if (cloud >= 60 && isDay) s += 8;
    if (wind >= 6 && wind <= 15) s += 8;
    if (wind > 20) s -= 8;
    if (!isDay) s -= 30; // skip the dead of night
    return { ms, t, s, isDay };
  }).filter((x) => x.ms >= now - hour && x.ms <= now + 18 * hour);

  // Pick local maxima / top distinct hours.
  return scored
    .sort((a, b) => b.s - a.s)
    .filter((x, _, arr) => x.s >= 60)
    .slice(0, 4)
    .sort((a, b) => a.ms - b.ms)
    .map((x) => ({
      time: new Date(x.ms),
      label: new Date(x.ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      quality: x.s >= 80 ? 'prime' : 'good',
    }));
}

window.buildConditions = buildConditions;
window.scoreActivity = scoreActivity;
window.bestWindows = bestWindows;
window.estimateWaterTempF = estimateWaterTempF;
window.deriveSeason = deriveSeason;
window.SEASON_LABELS = SEASON_LABELS;

// Tiny tagged-factor helpers.
function good(t) { return { kind: 'good', text: t }; }
function ok(t) { return { kind: 'ok', text: t }; }
function bad(t) { return { kind: 'bad', text: t }; }
