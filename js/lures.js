/* lures.js — Bass lure database + condition-aware recommendation engine.
 *
 * Each lure has scoring functions over the current conditions. We produce a
 * base score per lure, then app.js blends in a learning bonus from the user's
 * logged catches so recommendations improve over time.
 */

// Season is derived from water temperature (estimated) + month so it works in
// both hemispheres reasonably well via the caller passing the right month.
const LURE_DB = [
  {
    id: 'jig',
    name: 'Football / Flipping Jig',
    icon: '🪨',
    blurb: 'Bottom-contact bait that mimics crawfish. Slow it down in cold or tough conditions.',
    bestColors: {
      clear: ['green pumpkin', 'brown/orange'],
      stained: ['black/blue', 'green pumpkin'],
      muddy: ['black/blue', 'black/red'],
    },
    cover: ['rock', 'wood', 'docks', 'weeds'],
    score: (c) => {
      let s = 50;
      if (c.waterTempF < 55) s += 25;          // cold water staple
      if (c.waterTempF >= 50 && c.waterTempF <= 70) s += 10;
      if (c.pressureTrend === 'rising' || c.pressureState === 'high') s += 15; // tough bite
      if (c.cover === 'rock' || c.cover === 'wood' || c.cover === 'docks') s += 15;
      if (c.windMph > 12) s += 5;
      return s;
    },
  },
  {
    id: 'spinnerbait',
    name: 'Spinnerbait',
    icon: '🌀',
    blurb: 'Flash and vibration for active, roaming fish. Shines in wind and stain.',
    bestColors: {
      clear: ['white', 'white/chartreuse'],
      stained: ['white/chartreuse', 'chartreuse'],
      muddy: ['chartreuse', 'firetiger'],
    },
    cover: ['weeds', 'wood', 'open'],
    score: (c) => {
      let s = 45;
      if (c.windMph >= 8) s += 20;             // loves chop
      if (c.cloudPct >= 50) s += 12;
      if (c.clarity === 'stained') s += 12;
      if (c.clarity === 'muddy') s += 8;
      if (c.waterTempF >= 55 && c.waterTempF <= 72) s += 12;
      if (c.pressureTrend === 'falling') s += 12;
      return s;
    },
  },
  {
    id: 'chatterbait',
    name: 'Bladed Jig (Chatterbait)',
    icon: '⚡',
    blurb: 'Hard-thumping bait that calls fish in stained water and around grass.',
    bestColors: {
      clear: ['green pumpkin', 'shad'],
      stained: ['white', 'black/blue'],
      muddy: ['black/blue', 'chartreuse'],
    },
    cover: ['weeds', 'open'],
    score: (c) => {
      let s = 45;
      if (c.clarity === 'stained') s += 15;
      if (c.cover === 'weeds') s += 15;
      if (c.windMph >= 6) s += 8;
      if (c.waterTempF >= 50 && c.waterTempF <= 70) s += 12;
      if (c.pressureTrend === 'falling') s += 10;
      return s;
    },
  },
  {
    id: 'crankbait',
    name: 'Crankbait',
    icon: '🐟',
    blurb: 'Cover water fast. Squarebills shallow, deep divers on ledges in summer.',
    bestColors: {
      clear: ['shad', 'natural'],
      stained: ['chartreuse/black', 'sexy shad'],
      muddy: ['firetiger', 'chartreuse'],
    },
    cover: ['rock', 'wood', 'open'],
    score: (c) => {
      let s = 45;
      if (c.waterTempF >= 55 && c.waterTempF <= 75) s += 15;
      if (c.cover === 'rock' || c.cover === 'wood') s += 12;
      if (c.windMph >= 6) s += 8;
      if (c.season === 'prespawn' || c.season === 'fall') s += 12;
      return s;
    },
  },
  {
    id: 'topwater',
    name: 'Topwater (Walking / Popper / Frog)',
    icon: '💥',
    blurb: 'Explosive surface strikes. Best low-light, calm-to-light wind, warm water.',
    bestColors: {
      clear: ['bone', 'natural shad'],
      stained: ['black', 'bone'],
      muddy: ['black', 'white'],
    },
    cover: ['weeds', 'open', 'docks'],
    score: (c) => {
      let s = 35;
      if (c.waterTempF >= 60) s += 18;
      if (c.isLowLight) s += 20;               // dawn/dusk
      if (c.windMph <= 8) s += 8;
      if (c.cloudPct >= 40) s += 6;
      if (c.cover === 'weeds') s += 8;
      if (c.season === 'summer' || c.season === 'postspawn' || c.season === 'fall') s += 8;
      return s;
    },
  },
  {
    id: 'softplastic',
    name: 'Soft Plastic Worm / Creature (Texas rig)',
    icon: '🪱',
    blurb: 'The do-everything bait. Slow, weedless, deadly when the bite is tough.',
    bestColors: {
      clear: ['green pumpkin', 'watermelon red'],
      stained: ['junebug', 'black/blue'],
      muddy: ['black/blue', 'junebug'],
    },
    cover: ['weeds', 'wood', 'docks', 'rock'],
    score: (c) => {
      let s = 55;                              // reliable baseline
      if (c.pressureTrend === 'rising' || c.pressureState === 'high') s += 12;
      if (c.isBright) s += 10;
      if (c.waterTempF >= 55) s += 8;
      if (c.cover !== 'open') s += 8;
      return s;
    },
  },
  {
    id: 'nedrig',
    name: 'Ned Rig / Finesse',
    icon: '🥄',
    blurb: 'Small, subtle, hard to refuse. Cold fronts, clear water, pressured fish.',
    bestColors: {
      clear: ['green pumpkin', 'natural'],
      stained: ['green pumpkin', 'pumpkin/chartreuse'],
      muddy: ['black/blue'],
    },
    cover: ['rock', 'open', 'docks'],
    score: (c) => {
      let s = 40;
      if (c.pressureTrend === 'rising' || c.pressureState === 'high') s += 20; // post-front hero
      if (c.clarity === 'clear') s += 12;
      if (c.waterTempF < 60) s += 10;
      if (c.windMph <= 8) s += 6;
      return s;
    },
  },
  {
    id: 'jerkbait',
    name: 'Jerkbait',
    icon: '🎯',
    blurb: 'Suspends in cold, clear water. Long pauses trigger lethargic bass.',
    bestColors: {
      clear: ['natural shad', 'ghost minnow'],
      stained: ['chartreuse shad', 'clown'],
      muddy: ['firetiger'],
    },
    cover: ['open', 'rock'],
    score: (c) => {
      let s = 40;
      if (c.waterTempF >= 40 && c.waterTempF <= 58) s += 22; // cold-water clear-water king
      if (c.clarity === 'clear') s += 12;
      if (c.season === 'prespawn' || c.season === 'winter') s += 10;
      if (c.cloudPct >= 40) s += 5;
      return s;
    },
  },
  {
    id: 'lipless',
    name: 'Lipless Crankbait',
    icon: '🔔',
    blurb: 'Search bait that rips through grass. Prespawn and fall shad migrations.',
    bestColors: {
      clear: ['shad', 'chrome/blue'],
      stained: ['red craw', 'gold'],
      muddy: ['red craw', 'firetiger'],
    },
    cover: ['weeds', 'open'],
    score: (c) => {
      let s = 42;
      if (c.season === 'prespawn' || c.season === 'fall') s += 16;
      if (c.cover === 'weeds') s += 12;
      if (c.windMph >= 6) s += 8;
      if (c.waterTempF >= 45 && c.waterTempF <= 65) s += 10;
      return s;
    },
  },
  {
    id: 'swimbait',
    name: 'Swimbait (Paddle-tail / Glide)',
    icon: '🐠',
    blurb: 'Imitates baitfish. Scales from finesse to big-fish glide baits.',
    bestColors: {
      clear: ['natural shad', 'ghost'],
      stained: ['sexy shad', 'white'],
      muddy: ['white', 'chartreuse'],
    },
    cover: ['open', 'weeds', 'rock'],
    score: (c) => {
      let s = 45;
      if (c.waterTempF >= 50 && c.waterTempF <= 75) s += 12;
      if (c.clarity === 'clear') s += 8;
      if (c.season === 'prespawn' || c.season === 'postspawn' || c.season === 'fall') s += 10;
      if (c.cloudPct >= 40) s += 6;
      return s;
    },
  },
];

/**
 * Pick the best color string for a lure given clarity.
 */
function lureColorFor(lure, clarity) {
  const list = lure.bestColors[clarity] || lure.bestColors.stained || [];
  return list.join(' / ');
}

/**
 * Produce ranked recommendations. `learnFn(lureId)` optionally returns a bonus
 * (0..30) derived from the user's catch history for similar conditions.
 */
function recommendLures(conditions, learnFn) {
  const cover = conditions.cover || 'any';
  return LURE_DB.map((lure) => {
    let base = lure.score(conditions);
    // Cover filter: soft penalty if the lure doesn't fit the chosen cover.
    if (cover !== 'any' && !lure.cover.includes(cover)) base -= 12;
    const learnBonus = learnFn ? learnFn(lure.id) : 0;
    const total = Math.max(0, Math.min(100, Math.round(base + learnBonus)));
    return {
      ...lure,
      baseScore: base,
      learnBonus,
      total,
      color: lureColorFor(lure, conditions.clarity || 'stained'),
    };
  }).sort((a, b) => b.total - a.total);
}

// Expose for plain-script usage.
window.LURE_DB = LURE_DB;
window.recommendLures = recommendLures;
window.lureColorFor = lureColorFor;
