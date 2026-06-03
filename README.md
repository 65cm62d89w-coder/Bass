# 🎣 BassCast — Bass Fishing Forecast

A self-contained web app that tells you **when** the bass bite will be on, **what lure** to throw, and **learns your patterns** from the fish you catch.

No build step, no backend, no API keys. Open `index.html` and go.

## Features

### 🌦️ Live weather forecast
- Uses your **device location** (or search any lake/city) to pull live weather from the free, keyless [Open-Meteo](https://open-meteo.com/) API.
- Computes a **0–100 bass activity score** with a plain-English breakdown of *why*, driven by the factors that actually move bass:
  - Estimated **water temperature** and seasonal phase (pre-spawn → spawn → post-spawn → summer → fall → winter)
  - **Barometric pressure** and its 3-hour **trend** (falling fronts = feeding windows; post-front high pressure = tough)
  - **Cloud cover / light level** and dawn–dusk low-light windows
  - **Wind** (light chop is your friend), precipitation, moon phase
- Highlights the **best fishing windows** in the hours ahead.

### 🪤 Condition-aware lure recommendations
- Ranks 10 core bass techniques (jig, spinnerbait, chatterbait, crankbait, topwater, Texas-rig plastics, Ned rig, jerkbait, lipless, swimbait) for *right now*.
- Suggests **colors** tuned to your selected **water clarity**, and lets you filter by **cover/structure**.

### 📒 Catch log + pattern learning
- Log each catch with species, size, lure, color, cover, depth, and notes.
- Every catch **snapshots the live conditions** at the time.
- The app **cross-references** your catches with current conditions and **boosts lure recommendations** that have actually worked for you in similar weather (look for the ⭐).
- The **Patterns** tab surfaces your most productive lures, colors, cover, and the conditions that produce — building a picture for your water.

## How it works

| File | Responsibility |
|------|----------------|
| `js/weather.js` | Fetches weather + geocoding from Open-Meteo; computes pressure trend |
| `js/forecast.js` | Estimates water temp/season, scores bass activity, finds best windows |
| `js/lures.js` | Lure database + condition-aware scoring engine |
| `js/catches.js` | localStorage catch log + condition-similarity learning + pattern analysis |
| `js/app.js` | UI controller tying it all together |

All data (catches, location, preferences) is stored **locally in your browser** — nothing leaves your device except the anonymous weather lookup.

## Running it

It's a static site. Any of these work:

```bash
# Python
python3 -m http.server 8000
# then open http://localhost:8000

# Or just open index.html directly in a browser
```

> **Tip:** Geolocation requires either `localhost` or HTTPS. If you open the file directly and location is blocked, use the **change → search** option to set your spot by name.

## Notes & disclaimers
- Water temperature is **estimated** from air temperature trends — treat it as a guide, not a sensor reading. If you have a real reading, the seasonal logic will line up better over the year.
- The forecast is a heuristic model of well-established bass behavior, not a guarantee. Fish don't read the forecast. 🐟
