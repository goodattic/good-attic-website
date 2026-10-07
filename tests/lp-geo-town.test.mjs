import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const targets = JSON.parse(fs.readFileSync(new URL('data/ad-target-towns.json', root), 'utf8'));
const lookup = JSON.parse(fs.readFileSync(new URL('data/ad-geo-lookup.json', root), 'utf8'));
const markets = {ut: 'salt-lake-city-ut', mo_stl: 'st-louis-mo', mo_kc: 'kansas-city-mo'};
const services = ['attic-insulation', 'insulation-removal'];

function page(market, service) {
  return fs.readFileSync(new URL(`${markets[market]}/lp/${service}/index.html`, root), 'utf8');
}
function resolveFromPage(html, id) {
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(source => source.includes('goodAtticLpTownResolution'));
  assert.ok(inline, 'page embeds its geo lookup');
  const context = {location: {search: id ? `?utm_location=${id}` : ''}, URLSearchParams};
  context.window = context;
  vm.runInNewContext(inline, context);
  return JSON.parse(JSON.stringify(context.goodAtticLpTownResolution));
}

test('every targeted Google city ID and county postal ID resolves in the initial HTML without a network lookup', () => {
  assert.equal(Object.values(targets).filter(item => item?.cities).reduce((count, item) => count + Object.keys(item.cities).length, 0), 111);
  for (const [market, slug] of Object.entries(markets)) {
    const entry = lookup.markets[market];
    assert.deepEqual(Object.keys(entry.cities).sort(), Object.keys(targets[market].cities).sort());
    assert.ok(Object.keys(entry.postalCodes).length >= 60, `${market} has county postal IDs`);
    for (const id of Object.keys(targets[market].postal_codes_targeted || {}))
      assert.ok(entry.postalCodes[id], `${market} targeted postal ${id}`);
    for (const service of services) {
      const html = page(market, service);
      assert.ok(html.indexOf('goodAtticLpTownResolution') < html.indexOf('data-lp-fit-headline'), 'lookup runs before headline parses');
      assert.match(html, /<span data-lp-town><script>document\.currentScript\.replaceWith/);
      assert.ok(!html.includes('ad-geo-lookup.json'), 'visitor makes no geo lookup request');
      for (const [type, values] of [['city', entry.cities], ['postal_code', entry.postalCodes], ['other_city', entry.otherObservedCities]]) {
        for (const [id, town] of Object.entries(values)) {
          assert.deepEqual(resolveFromPage(html, id), {id, type, town}, `${slug}/${service} ${id}`);
        }
      }
      assert.deepEqual(resolveFromPage(html, ''), {id:'', type:'fallback', town:entry.fallback});
      assert.deepEqual(resolveFromPage(html, '999999999'), {id:'999999999', type:'fallback', town:entry.fallback});
    }
  }
});

test('observed IDs resolve to their audited towns or an explicit market fallback', () => {
  const expected = Object.values(targets.observed_utm_location_examples)
    .filter(Array.isArray).reduce((sum, ids) => sum + ids.length, 0);
  assert.equal(lookup.observed.length, expected);
  for (const item of lookup.observed) {
    const html = page(item.market, 'attic-insulation');
    const resolved = resolveFromPage(html, item.id);
    assert.equal(resolved.town, item.town, `${item.market}/${item.id}`);
    assert.equal(resolved.type === 'fallback', item.source === 'fallback');
  }
  assert.equal(resolveFromPage(page('ut', 'attic-insulation'), '9029705').town, 'Lehi');
  assert.equal(resolveFromPage(page('mo_stl', 'attic-insulation'), '1020613').town, 'St. Charles');
});

test('Kansas City landing pages still make no review claim', () => {
  for (const service of services) {
    const html = page('mo_kc', service);
    assert.doesNotMatch(html, /five-star reviews|5-star reviews|Google review/i);
  }
});

test('the approved 32px mobile headline fit runs synchronously after every resolved headline', () => {
  const css = fs.readFileSync(new URL('assets/ad-landing.css', root), 'utf8');
  assert.match(css, /\.lp-hero h1\{font-size:32px;line-height:1\.05/);
  for (const market of Object.keys(markets)) {
    for (const service of services) {
      const html = page(market, service);
      const headlineEnd = html.indexOf('</h1>');
      const fitStart = html.indexOf('const headline = document.currentScript.previousElementSibling;', headlineEnd);
      const supportStart = html.indexOf('class="lp-hero-support"', headlineEnd);
      assert.ok(headlineEnd >= 0 && fitStart > headlineEnd && supportStart > fitStart,
        `${market}/${service} fits after the town resolves and before following content parses`);
      assert.match(html.slice(fitStart, supportStart), /for \(let size = 32; size >= 26; size -= 0\.5\)/);
    }
  }
});
