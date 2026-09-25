# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-page web app comparing running costs of an electric car against a petrol or diesel car, using live UK prices. The app is `index.html` (embedded CSS and JavaScript) plus live price data in `data/prices.json`.

## Architecture

- **Question flow (`STEPS`)**: four steps (current car, EV, charging, mileage) shown on first visit; answers are saved to `localStorage` (`evcompare.v2`) so returning visitors land on results. "Start over" reopens it.
- **Results**: headline saving, cost bars, week/month/year toggle, fine-tune panels (preset dropdowns + sliders), break-even figures and the April 2028 card.
- **State**: one `state` object in canonical units - `miPerKwh`, `pPerKwh`, `mpg` (UK), `pPerLitre`, `annualMiles` - plus display `units` and chosen `presets`. All maths (`compute`, `breakEven`) uses canonical values; unit tables (`EV_EFF_UNITS`, `FUEL_EFF_UNITS`, `FUEL_VOL_UNITS`, `distanceUnit()`) only convert for display.
- **Fields (`FIELDS`)**: each slider + number box maps to one canonical value. Moving one clears its preset (shows "Custom").
- **`render()`** redraws everything from `state` and saves it; there is no other update path.
- **Advanced mode** (`state.advanced`): brings back the original calculator's extras. "Lock to break-even" (`state.lock`, `touched()`, `LOCK_PARAMS`) recalculates the least recently changed of efficiency, electricity price, economy or fuel price so both cars cost the same. Units marked `advanced: true` (m/kJ, J/m, p/Wh, p/MJ) appear only in this mode, as does the £/$/€ switch. Currencies are cosmetic: 1p = 1¢ = 1c.

## Live Data & Presets

- `data/prices.json` holds UK average pump prices (auto-generated) and electricity tariff presets (hand-maintained - edit the `electricity.tariffs` list when the Ofgem cap or network prices change; the updater preserves it).
- `scripts/update-prices.mjs` (Node 20+, no deps) rebuilds the fuel section from the CMA retailer open-data feeds, or the GOV.UK Fuel Finder API when `FUEL_FINDER_CLIENT_ID`/`FUEL_FINDER_CLIENT_SECRET` are set. `.github/workflows/update-prices.yml` runs it twice daily and commits changes.
- The page fetches `./data/prices.json` and the raw GitHub copy, using whichever is newer; a snapshot is embedded in `index.html` (`DEFAULT_PRICE_DATA`) as an offline fallback.
- Car presets (`EV_MODELS` in mi/kWh battery-to-wheel from ev-database.org; `ICE_MODELS` in UK mpg from Fuelly US-gallon figures × 1.20095, filtered to the named engine, 10+ owners) and the 2028 eVED/fuel duty assumptions (`REEVES_2028`) live in `index.html`.
- `sw.js` is network-first so price updates arrive immediately; bump `CACHE_NAME` on releases.

## Development Notes

- No build process or runtime dependencies; vanilla JS
- CSS uses custom properties with a dark theme via `prefers-color-scheme`
- Colours: blue for EV, orange for petrol/diesel, green for savings

## Testing

Serve the folder (e.g. `python3 -m http.server`) so `data/prices.json` loads, then check: the question flow, sliders and number boxes, unit switching, week/month/year, reload persistence, phone width (no sideways scroll) and dark mode. Clear `localStorage` to see the questions again.
