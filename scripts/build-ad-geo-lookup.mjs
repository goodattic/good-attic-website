#!/usr/bin/env node
// Build an offline, reviewed lookup for the three live ad-landing markets.
// Usage: node scripts/build-ad-geo-lookup.mjs [path/to/good-attic-ad-towns.json]
// This is a build-time tool: the landing page must use the generated lookup
// synchronously, without downloading geographic data on a visitor's phone.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const targetsFile = process.argv[2] || join(root, 'data/ad-target-towns.json');
const targets = JSON.parse(readFileSync(targetsFile, 'utf8'));
const output = join(root, 'data/ad-geo-lookup.json');
const report = join(root, 'outputs/lp-observed-geo-resolution.md');
const sources = {
  google: 'https://developers.google.com/static/google-ads/api/data/geo/geotargets-2026-08-12.csv.zip',
  censusCounty: 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt',
  censusPlace: 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_place20_natl.txt',
  censusPlaceCounty: 'https://www2.census.gov/geo/docs/reference/codes2020/national_place_by_county2020.txt',
  geoNames: 'https://download.geonames.org/export/zip/US.zip'
};
const marketFallbacks = { ut: 'Utah', mo_stl: 'St. Louis area', mo_kc: 'Kansas City area' };
const stateCodes = { Utah: ['UT', '49'], Missouri: ['MO', '29'], Kansas: ['KS', '20'] };
const temp = mkdtempSync(join(tmpdir(), 'good-attic-geo-'));

function download(url, name) {
  const path = join(temp, name);
  execFileSync('curl', ['-fLsS', '--retry', '2', '-o', path, url], { stdio: 'inherit' });
  return path;
}
function unzip(path, member) {
  return execFileSync('unzip', ['-p', path, member], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function csv(text) {
  // Google's CSV quotes names containing commas. Its records have no embedded newlines.
  const lines = text.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
  const parse = (line) => {
    const fields = []; let field = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') { field += '"'; i++; }
        else quoted = !quoted;
      } else if (char === ',' && !quoted) { fields.push(field); field = ''; }
      else field += char;
    }
    fields.push(field);
    return fields;
  };
  const headers = parse(lines.shift());
  return lines.filter(Boolean).map((line) => Object.fromEntries(parse(line).map((value, index) => [headers[index], value])));
}
function pipe(text) {
  const lines = text.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
  const headers = lines.shift().split('|');
  return lines.filter(Boolean).map((line) => Object.fromEntries(line.split('|').map((value, index) => [headers[index], value])));
}
function natural(name) {
  return name
    .replace(/\bLake Saint Louis\b/g, 'Lake St. Louis')
    .replace(/\bSaint (?=Ann\b|Charles\b|Louis\b|Paul\b|Peters\b)/g, 'St. ')
    .replace(/\bSt (?=Ann\b|Charles\b|Louis\b|Paul\b|Peters\b)/g, 'St. ')
    .replace(/\bLees Summit\b/g, "Lee's Summit")
    .replace(/\bMc Louth\b/g, 'McLouth')
    .replace(/\bPortage Des Sioux\b/g, 'Portage des Sioux');
}
function key(name) {
  return natural(name).replace(/\b(city|town|village|CDP|metro township)\b$/i, '')
    .replace(/[^a-z0-9]/gi, '').toLowerCase();
}
function placeName(name) {
  return natural(name.replace(/\s+(city|town|village|CDP|metro township)$/i, ''));
}
function sortedObject(entries) {
  return Object.fromEntries([...entries].sort(([a], [b]) => Number(a) - Number(b)));
}

try {
  const googleZip = download(sources.google, 'google.zip');
  const countyText = readFileSync(download(sources.censusCounty, 'county.txt'), 'utf8');
  const placeText = readFileSync(download(sources.censusPlace, 'place.txt'), 'utf8');
  const placeCountyText = readFileSync(download(sources.censusPlaceCounty, 'place-county.txt'), 'utf8');
  const geoNamesZip = download(sources.geoNames, 'geonames.zip');
  const google = csv(unzip(googleZip, 'third_party/devsite/developers/en/google-ads/api/data/geo/geotargets-2026-08-12.csv'));
  const byId = new Map(google.map((row) => [row['Criteria ID'], row]));
  const postal = google.filter((row) => row['Country Code'] === 'US' && row['Target Type'] === 'Postal Code' && row.Status === 'Active' && /^\d{5}$/.test(row.Name));
  const countyRows = pipe(countyText).filter((row) => row.GEOID_ZCTA5_20);
  const placeRows = pipe(placeText).filter((row) => row.GEOID_ZCTA5_20);
  const placeCountyRows = pipe(placeCountyText);
  const postalNames = new Map();
  for (const line of unzip(geoNamesZip, 'US.txt').trimEnd().split(/\r?\n/)) {
    const [country, zip, town, state, stateCode, county] = line.split('\t');
    if (country !== 'US') continue;
    if (!postalNames.has(zip)) postalNames.set(zip, []);
    postalNames.get(zip).push({ town: natural(town), stateCode, county });
  }
  const zctaCounties = new Map();
  for (const row of countyRows) {
    if (!zctaCounties.has(row.GEOID_ZCTA5_20)) zctaCounties.set(row.GEOID_ZCTA5_20, []);
    zctaCounties.get(row.GEOID_ZCTA5_20).push(row);
  }
  const zctaPlaces = new Map();
  for (const row of placeRows) {
    if (!zctaPlaces.has(row.GEOID_ZCTA5_20)) zctaPlaces.set(row.GEOID_ZCTA5_20, []);
    zctaPlaces.get(row.GEOID_ZCTA5_20).push(row);
  }

  const markets = {};
  const observed = [];
  const ambiguities = [];
  for (const market of Object.keys(marketFallbacks)) {
    const target = targets[market];
    const countyFips = new Set();
    const countyNames = new Set();
    for (const id of Object.keys(target.counties)) {
      const geo = byId.get(id);
      if (!geo || geo['Target Type'] !== 'County') throw new Error(`Missing Google county ${market}/${id}`);
      const state = geo['Canonical Name'].split(',').at(-2);
      const [stateCode, stateFips] = stateCodes[state] || [];
      if (!stateCode) throw new Error(`Unrecognized state for ${market}/${id}: ${state}`);
      const matching = countyRows.filter((row) => row.NAMELSAD_COUNTY_20 === geo.Name && row.GEOID_COUNTY_20.startsWith(stateFips));
      if (!matching.length) throw new Error(`Missing Census county ${market}/${id}: ${geo.Name}`);
      for (const row of matching) countyFips.add(row.GEOID_COUNTY_20);
      countyNames.add(`${stateCode}:${key(geo.Name.replace(/ County$/, ''))}`);
    }
    const targetCities = new Map(Object.entries(target.cities).map(([id, name]) => [id, natural(name)]));
    const targetTownByKey = new Map([...targetCities.values()].map((name) => [key(name), name]));
    for (const id of targetCities.keys()) {
      const geo = byId.get(id);
      if (!geo || geo['Target Type'] !== 'City' || geo.Status !== 'Active') throw new Error(`Missing active Google city ${market}/${id}`);
    }
    const cityEntries = [...targetCities.entries()];
    const postalEntries = [];
    for (const geo of postal) {
      const zip = geo.Name;
      const censusInside = (zctaCounties.get(zip) || []).some((row) => countyFips.has(row.GEOID_COUNTY_20));
      const names = postalNames.get(zip) || [];
      const geoNamesInside = names.some((row) => countyNames.has(`${row.stateCode}:${key(row.county)}`));
      if (!censusInside && !geoNamesInside) continue;
      const places = (zctaPlaces.get(zip) || [])
        .filter((row) => row.NAMELSAD_PLACE_20)
        .map((row) => ({
          town: placeName(row.NAMELSAD_PLACE_20),
          fraction: Number(row.AREALAND_PART) / Math.max(1, Number(row.AREALAND_ZCTA5_20))
        })).sort((a, b) => b.fraction - a.fraction);
      const targetedPlaces = places.filter((place) => targetTownByKey.has(key(place.town)));
      const bestTarget = targetedPlaces[0];
      const postalName = names.find((row) => countyNames.has(`${row.stateCode}:${key(row.county)}`))?.town || names[0]?.town;
      const targetedPostal = targetTownByKey.get(key(postalName || ''));
      // If a ZIP spans two targeted towns, prefer the larger targeted place.
      // With only one targeted town, require 15% ZIP land to avoid a tiny edge.
      // USPS-style "St. Louis" postal names also cover many separate St. Louis
      // County towns; use the dominant Census place when it covers >=20%.
      const dominantPlace = places[0];
      const genericStLouis = market === 'mo_stl' && key(postalName || '') === key('St. Louis')
        && dominantPlace && key(dominantPlace.town) !== key('St. Louis') && dominantPlace.fraction >= 0.20;
      const useTargetPlace = bestTarget && (targetedPlaces.length >= 2 || bestTarget.fraction >= 0.15);
      const town = useTargetPlace ? targetTownByKey.get(key(bestTarget.town))
        : genericStLouis ? dominantPlace.town : targetedPostal || postalName || places[0]?.town;
      if (!town) throw new Error(`No town for ${market}/${geo['Criteria ID']} ZIP ${zip}`);
      postalEntries.push([geo['Criteria ID'], natural(town)]);
      if (targetedPlaces.length > 1 || (bestTarget && bestTarget.fraction < 0.15) || (postalName && key(postalName) !== key(town))) {
        ambiguities.push({ market, id: geo['Criteria ID'], zip, chosen: natural(town), postalTown: natural(postalName || ''),
          targetedPlaces: targetedPlaces.slice(0, 3).map((p) => ({ town: targetTownByKey.get(key(p.town)), areaPercent: Math.round(p.fraction * 1000) / 10 })) });
      }
    }
    // Three observed city IDs belong to listed counties but are not explicitly
    // targeted. Verify two with Census's place-by-county file; Fort Leavenworth
    // is the GeoNames postal town in Leavenworth County (ZIP 66027).
    const otherCities = [];
    const observedIds = targets.observed_utm_location_examples[market];
    for (const id of observedIds) {
      const geo = byId.get(id);
      if (!geo || geo['Target Type'] !== 'City' || targetCities.has(id)) continue;
      const state = geo['Canonical Name'].split(',').at(-2);
      const stateFips = stateCodes[state]?.[1];
      const censusLocal = placeCountyRows.some((row) =>
        countyFips.has(`${row.STATEFP}${row.COUNTYFP}`) && row.STATEFP === stateFips && key(placeName(row.PLACENAME)) === key(geo.Name));
      const postalLocal = geo.Name === 'Fort Leavenworth' && namesForTown(postalNames, geo.Name)
        .some((row) => countyNames.has(`${row.stateCode}:${key(row.county)}`));
      if (censusLocal || postalLocal) otherCities.push([id, natural(geo.Name)]);
    }
    const result = {
      fallback: marketFallbacks[market],
      cities: sortedObject(cityEntries),
      postalCodes: sortedObject(postalEntries),
      otherObservedCities: sortedObject(otherCities)
    };
    markets[market] = result;
    for (const id of observedIds) {
      const geo = byId.get(id);
      const source = id in result.cities ? 'targeted-city' : id in result.postalCodes ? 'county-postal-code'
        : id in result.otherObservedCities ? 'verified-local-city' : 'fallback';
      observed.push({ market, id, type: geo?.['Target Type'] || 'Unknown', googleName: geo?.Name || '',
        town: result.cities[id] || result.postalCodes[id] || result.otherObservedCities[id] || result.fallback,
        source });
    }
    result.counts = { targetedCities: cityEntries.length, postalCodes: postalEntries.length, otherObservedCities: otherCities.length };
    if (target.postal_codes_targeted) {
      for (const id of Object.keys(target.postal_codes_targeted)) {
        if (!(id in result.postalCodes)) throw new Error(`Explicit KC postal target absent: ${id}`);
      }
    }
  }
  const artifact = {
    provenance: {
      generatedFrom: sources,
      targetConfig: 'data/ad-target-towns.json (copied from user-provided good-attic-ad-towns.json, 2026-10-07)',
      googleGeoTargetVersion: '2026-08-12',
      geoNamesAttribution: 'GeoNames postal code data: https://www.geonames.org/ (CC BY 4.0)',
      policy: 'Include active Google postal-code IDs whose 2020 Census ZCTA intersects a listed county or whose GeoNames ZIP county matches it. If a ZIP spans two targeted places, choose the larger targeted place. Otherwise prefer a targeted Census place covering >=15% of ZIP land; then a targeted postal town, then the postal town. Known observed non-target cities are included only with Census or GeoNames county evidence. Other IDs use the market fallback.',
      limitation: 'A ZIP can cross town and county lines. One town per ZIP cannot identify an individual home; Census ZCTAs approximate USPS ZIP boundaries.'
    },
    markets,
    observed,
    ambiguities
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
  const label = { ut: 'Utah', mo_stl: 'St. Louis', mo_kc: 'Kansas City' };
  const reportLines = [
    '# Observed ad location IDs',
    '',
    'The table shows every ID in the user-provided `observed_utm_location_examples` list and the town the preview landing pages will show. “Yes” means the market fallback is shown.',
    '',
    '| Market | ID | Google target type | Town shown | Fallback? |',
    '| --- | --- | --- | --- | --- |',
    ...observed.map((row) => `| ${label[row.market]} | ${row.id} | ${row.type} | ${row.town} | ${row.source === 'fallback' ? 'Yes' : 'No'} |`),
    '',
    'Fallback IDs: ' + observed.filter((row) => row.source === 'fallback').map((row) => `${label[row.market]} ${row.id}`).join(', ') + '.',
    '',
    'Sources: [Google Ads geo targets (2026-08-12)](https://developers.google.com/google-ads/api/data/geotargets), [Census 2020 ZCTA–county and ZCTA–place relationships](https://www.census.gov/geographies/reference-files/time-series/geo/relationship-files.2020.html), [Census place-by-county codes](https://www2.census.gov/geo/docs/reference/codes2020/), [GeoNames postal-code data](https://www.geonames.org/export/zip/), and `data/ad-target-towns.json` copied from the supplied town list. A ZIP can cross town or county boundaries; its one displayed town cannot identify an individual home.',
    ''
  ];
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, reportLines.join('\n'));
  console.log(output);
  console.log(report);
  for (const [market, value] of Object.entries(markets)) console.log(market, value.counts);
  console.log('observed fallbacks', observed.filter((item) => item.source === 'fallback').length);
  console.log('ambiguities', ambiguities.length);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function namesForTown(postalNames, town) {
  return [...postalNames.values()].flat().filter((row) => key(row.town) === key(town));
}
