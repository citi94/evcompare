#!/usr/bin/env node
// Builds data/prices.json with current UK average pump prices.
//
// Sources, in order of preference:
//   1. GOV.UK Fuel Finder API (statutory, ~7,500 forecourts) — used when
//      FUEL_FINDER_CLIENT_ID and FUEL_FINDER_CLIENT_SECRET are set.
//   2. CMA open-data retailer feeds (no key needed, ~2,500 forecourts).
//
// The electricity section of prices.json is hand-maintained and preserved.
// Node 20+, no dependencies. Run: node scripts/update-prices.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'prices.json');

const PRICE_FLOOR = 80;     // p/litre — anything outside is a data-entry error
const PRICE_CEILING = 300;
const MAX_FEED_AGE_DAYS = 7;
const HISTORY_DAYS = 180;

const RETAILER_FEEDS = [
    { brand: 'Asda', url: 'https://storelocator.asda.com/fuel_prices_data.json', supermarket: true },
    { brand: 'Esso', url: 'https://fuelprices.esso.co.uk/latestdata.json' },
    { brand: 'MFG', url: 'https://fuel.motorfuelgroup.com/fuel_prices_data.json' },
    { brand: 'Rontec', url: 'https://www.rontec-servicestations.co.uk/fuel-prices/data/fuel_prices_data.json' },
    { brand: 'Applegreen', url: 'https://applegreenstores.com/fuel-prices/data.json' },
    { brand: 'Morrisons', url: 'https://www.morrisons.com/fuel-prices/fuel.json', supermarket: true },
    { brand: 'Sainsbury\'s', url: 'https://api.sainsburys.co.uk/v1/exports/latest/fuel_prices_data.json', supermarket: true },
    { brand: 'Tesco', url: 'https://www.tesco.com/fuel_prices/fuel_prices_data.json', supermarket: true },
    { brand: 'BP', url: 'https://www.bp.com/en_gb/united-kingdom/home/fuelprices/fuel_prices_data.json' },
    { brand: 'Shell', url: 'https://www.shell.co.uk/fuel-prices-data.html' },
    { brand: 'Jet', url: 'https://jetlocal.co.uk/fuel_prices_data.json' },
    { brand: 'Moto', url: 'https://moto-way.com/fuel-price/fuel_prices.json', motorway: true },
];

// Map every source's grade codes onto the four grades the app shows.
function gradeOf(code) {
    const c = String(code).toUpperCase();
    if (c === 'E10') return 'petrol';
    if (c === 'E5') return 'superPetrol';
    if (c === 'SDV' || c.includes('PREMIUM') || c.includes('SUPER')) return 'premiumDiesel';
    if (c.startsWith('B7')) return 'diesel';
    return null;
}

function median(values) {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values) {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

const round1 = v => (v == null ? null : Math.round(v * 10) / 10);

// Some feeds occasionally publish pounds (1.729) or tenths (1729) instead of pence.
function normalisePence(raw) {
    let p = Number(raw);
    if (!Number.isFinite(p) || p <= 0) return null;
    if (p < 5) p *= 100;
    else if (p > 1000 && p / 10 <= PRICE_CEILING) p /= 10;
    return p >= PRICE_FLOOR && p <= PRICE_CEILING ? p : null;
}

// "25/09/2026 11:04:22" → Date
function parseUkTimestamp(s) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
    if (!m) return new Date(s);
    return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)));
}

async function fetchJson(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: { 'User-Agent': 'evcompare-price-bot (+https://github.com/citi94/evcompare)', Accept: 'application/json', ...options.headers },
        signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// Returns [{ brand, supermarket, motorway, prices: { petrol, diesel, ... } }]
async function collectRetailerFeeds() {
    const stations = [];
    const used = [];
    const now = Date.now();

    await Promise.all(RETAILER_FEEDS.map(async feed => {
        try {
            const data = await fetchJson(feed.url);
            const updated = parseUkTimestamp(data.last_updated);
            const ageDays = (now - updated.getTime()) / 86400000;
            if (!(ageDays <= MAX_FEED_AGE_DAYS)) {
                console.warn(`skip ${feed.brand}: stale (${data.last_updated})`);
                return;
            }
            let count = 0;
            for (const s of data.stations || []) {
                const prices = {};
                for (const [code, raw] of Object.entries(s.prices || {})) {
                    const grade = gradeOf(code);
                    const p = normalisePence(raw);
                    if (grade && p) prices[grade] = p;
                }
                if (Object.keys(prices).length) {
                    stations.push({ brand: feed.brand, supermarket: !!feed.supermarket, motorway: !!feed.motorway, prices });
                    count++;
                }
            }
            used.push({ brand: feed.brand, stations: count, updated: updated.toISOString() });
        } catch (err) {
            console.warn(`skip ${feed.brand}: ${err.message}`);
        }
    }));

    return { stations, sources: used.sort((a, b) => b.stations - a.stations) };
}

async function collectFuelFinder(clientId, clientSecret) {
    const BASE = 'https://www.fuel-finder.service.gov.uk';
    const tokenRes = await fetch(`${BASE}/api/v1/oauth/generate_access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
        signal: AbortSignal.timeout(30000),
    });
    if (!tokenRes.ok) throw new Error(`token HTTP ${tokenRes.status}`);
    const token = (await tokenRes.json()).data.access_token;
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    // Paginated in batches of 500; a 404 or empty page marks the end.
    async function allBatches(path) {
        const out = [];
        for (let batch = 1; batch < 100; batch++) {
            let page;
            try {
                page = await fetchJson(`${BASE}${path}?batch-number=${batch}`, auth);
            } catch (err) {
                if (err.message === 'HTTP 404') break;
                throw err;
            }
            if (!Array.isArray(page) || !page.length) break;
            out.push(...page);
            await new Promise(r => setTimeout(r, 2100)); // stay under 30 requests/minute
        }
        return out;
    }

    const info = new Map((await allBatches('/api/v1/pfs')).map(s => [s.node_id, s]));
    const stations = [];
    for (const rec of await allBatches('/api/v1/pfs/fuel-prices')) {
        const site = info.get(rec.node_id) || {};
        if (site.temporary_closure || site.permanent_closure) continue;
        const prices = {};
        for (const fp of rec.fuel_prices || []) {
            const grade = gradeOf(fp.fuel_type);
            const p = normalisePence(fp.price);
            if (grade && p) prices[grade] = p;
        }
        if (Object.keys(prices).length) {
            stations.push({
                brand: (site.brand_name || '').trim(),
                supermarket: !!site.is_supermarket_service_station,
                motorway: !!site.is_motorway_service_station,
                prices,
            });
        }
    }
    return { stations, sources: [{ brand: 'GOV.UK Fuel Finder', stations: stations.length, updated: new Date().toISOString() }] };
}

function summarise(stations) {
    const grades = ['petrol', 'diesel', 'superPetrol', 'premiumDiesel'];
    const out = {};
    for (const g of grades) {
        const pick = filter => stations.filter(filter).map(s => s.prices[g]).filter(Boolean);
        const all = pick(s => !s.motorway);
        if (all.length < 20) continue;
        const supermarket = pick(s => s.supermarket);
        const motorway = pick(s => s.motorway);
        const sorted = [...all].sort((a, b) => a - b);
        out[g] = {
            average: round1(mean(all)),
            median: round1(median(all)),
            supermarket: supermarket.length >= 20 ? round1(median(supermarket)) : null,
            motorway: motorway.length >= 5 ? round1(median(motorway)) : null,
            cheapest10pc: round1(sorted[Math.floor(sorted.length * 0.1)]),
            stations: all.length,
        };
    }
    return out;
}

async function main() {
    let existing = {};
    try { existing = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }

    let result;
    const { FUEL_FINDER_CLIENT_ID: id, FUEL_FINDER_CLIENT_SECRET: secret } = process.env;
    if (id && secret) {
        try {
            result = await collectFuelFinder(id, secret);
            console.log(`Fuel Finder: ${result.stations.length} stations`);
        } catch (err) {
            console.warn(`Fuel Finder failed (${err.message}); falling back to retailer feeds`);
        }
    }
    if (!result || result.stations.length < 500) {
        result = await collectRetailerFeeds();
        console.log(`Retailer feeds: ${result.stations.length} stations from ${result.sources.map(s => s.brand).join(', ')}`);
    }

    const fuel = summarise(result.stations);
    if (!fuel.petrol || !fuel.diesel) {
        console.error('Not enough data to publish; leaving prices.json unchanged.');
        process.exit(1);
    }

    // Avoid a commit when nothing moved.
    if (JSON.stringify(existing.fuel) === JSON.stringify(fuel)) {
        console.log('Prices unchanged.');
        return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const history = (existing.fuelHistory || []).filter(h => h.date !== today);
    history.push({ date: today, petrol: fuel.petrol.average, diesel: fuel.diesel.average });
    const cutoff = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);

    const output = {
        ...existing,
        fuelUpdated: new Date().toISOString(),
        fuelSources: result.sources,
        fuel,
        fuelHistory: history.filter(h => h.date >= cutoff).sort((a, b) => a.date.localeCompare(b.date)),
    };

    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(output, null, 2) + '\n');
    console.log(`petrol ${fuel.petrol.average}p, diesel ${fuel.diesel.average}p → ${OUT}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
