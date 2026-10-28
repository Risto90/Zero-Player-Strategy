import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Game } from '../game/game.ts';
import { MAP_WIDTH } from '../game/config.ts';
import { MapRenderer, hexToRgb } from '../game/render.ts';
import { cityInfluenceRadius } from '../game/settlements.ts';
import { World } from '../game/world.ts';
import { hasMapObjectList } from '../game/mapModeCapabilities.ts';
import { circleHatchLines } from '../components/map/cityInfluenceHatching.ts';
import {
  cityProfileRoute,
  countryProfileRoute,
  cultureProfileRoute,
  raceProfileRoute,
  religionProfileRoute,
} from '../game/profileRoutes.ts';

const root = resolve(process.cwd());
const legendPanel = readFileSync(resolve(root, 'components/game/LegendPanel.tsx'), 'utf8');
const modes = readFileSync(resolve(root, 'components/game/ModeTabs.tsx'), 'utf8');
const rendererSource = readFileSync(resolve(root, 'game/render.ts'), 'utf8');
const webMap = readFileSync(resolve(root, 'components/map/MapView.web.tsx'), 'utf8');

assert.match(legendPanel, /function EntityRow/u);
assert.match(legendPanel, /function EntityRows/u);
assert.match(legendPanel, /styles\.rowBar[\s\S]*row\.percent[\s\S]*backgroundColor: row\.color/u,
  'the shared row keeps the original proportional, entity-colored background bar');
assert.doesNotMatch(legendPanel, /ShareDiagram|react-native-svg/u,
  'share visualization uses the established horizontal bar, not a replacement chart');
for (const name of ['countryProfileRoute', 'cultureProfileRoute', 'religionProfileRoute', 'raceProfileRoute', 'cityProfileRoute']) {
  assert.match(legendPanel, new RegExp(name));
}
assert.match(legendPanel, /showShare=\{false\} showSwatch=\{false\}/u,
  'city rows show only their name and absolute population, with no share diagram');
assert.match(legendPanel, /profileRouteForId=\{cityProfileRoute\}/u,
  'cities open their profile from the separate trailing button');
assert.match(legendPanel, /game\.selectCity\(row\.id\)/u, 'city-row selection drives the map selection');
assert.match(legendPanel, /game\.showCountryOnMap\(row\.id\)/u, 'country rows select both settled and nomadic countries');
assert.doesNotMatch(modes, /id: 'nomads'/u, 'the map mode menu has no separate nomadic mode');
assert.doesNotMatch(rendererSource, /'nomads'\s*:/u, 'the map renderer exposes no nomadic mode');
assert.equal(
  existsSync(resolve(root, 'components/map/MapView.tsx')),
  false,
  'the browser-only project has no separate native map implementation',
);
assert.match(webMap, /cityInfluenceRadius\(game\.world, city\)/u, 'the web map draws calculated city spheres');
assert.match(webMap, /if \(selected\) \{[\s\S]*circleHatchLines/u, 'only the selected city is hatched on web');
assert.match(webMap, /ctx\.arc\(centerX, centerY, radius, 0, Math\.PI \* 2\)[\s\S]*ctx\.clip\(\)/u,
  'the selected web hatch is clipped to the calculated circular radius');
assert.match(webMap, /centerX \+ radius < 0/u, 'web sphere outlines are culled to the viewport');
const hatch = circleHatchLines(30, 40, 50, 8);
assert.ok(hatch.length > 10, 'a full circle receives evenly spaced hatch lines');
for (const line of hatch) {
  assert.ok(Math.abs(Math.hypot(line.x1 - 30, line.y1 - 40) - 50) < 1e-8,
    'each hatch segment starts at the circle boundary');
  assert.ok(Math.abs(Math.hypot(line.x2 - 30, line.y2 - 40) - 50) < 1e-8,
    'each hatch segment ends at the circle boundary');
}
const hatchMidpoints = hatch.map((line) => ({
  x: (line.x1 + line.x2) / 2,
  y: (line.y1 + line.y2) / 2,
}));
assert.ok(hatchMidpoints.some(({ x, y }) => Math.abs(Math.hypot(x - 30, y - 40)) < 1e-8),
  'the hatch crosses the circle center');
assert.ok(hatchMidpoints.some(({ x, y }) => Math.abs(Math.hypot(x - 30, y - 40) - 50) < 1e-8),
  'hatch lines reach the full radius instead of stopping short of the circle edge');
assert.equal(hasMapObjectList('political'), true);
assert.equal(hasMapObjectList('cities'), true);
assert.equal(hasMapObjectList('cultures'), true);
assert.equal(hasMapObjectList('religions'), true);
assert.equal(hasMapObjectList('origins'), true);
assert.deepEqual(countryProfileRoute(2), { pathname: '/country/[id]', params: { id: '2' } });
assert.deepEqual(cultureProfileRoute(3), { pathname: '/culture/[id]', params: { id: '3' } });
assert.deepEqual(religionProfileRoute(4), { pathname: '/religion/[id]', params: { id: '4' } });
assert.deepEqual(raceProfileRoute('pygmy'), { pathname: '/race/[id]', params: { id: 'pygmy' } });
assert.deepEqual(cityProfileRoute(5), { pathname: '/city/[id]', params: { id: '5' } });

const world = World.create('random', 51612);
const culture = world.newCulture(null, 1000);
const settled = world.newCountry({
  rank: 'Тестовое государство',
  cultureId: culture.id,
  religionId: null,
  density: 50,
  foundedYear: 1000,
  parentId: null,
});
const inside = world.landIndex.find((pixel) => {
  const x = pixel % MAP_WIDTH;
  const y = Math.floor(pixel / MAP_WIDTH);
  if (x < 3 || y < 3 || x >= MAP_WIDTH - 3 || y >= world.land.length / MAP_WIDTH - 3) return false;
  if ((x + y) % 7 >= 3) return false;
  for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
    const point = pixel + dy * MAP_WIDTH + dx;
    if (!world.land[point] || world.rivers[point] > 0) return false;
  }
  return true;
});
assert.notEqual(inside, undefined, 'test map has a non-coastal, river-free land patch');
const center = inside;
const patch = [];
for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) patch.push(center + dy * MAP_WIDTH + dx);
for (const pixel of patch) {
  world.setOwner(pixel, settled.id + 1);
  world.density[pixel] = 50;
}
world.recountCountries();
const nomad = world.newCountry({
  rank: 'Кочевье',
  cultureId: culture.id,
  religionId: null,
  density: 0,
  foundedYear: 1000,
  parentId: null,
});
nomad.type = 'nomadic';
nomad.range = patch;
nomad.cells = [{
  pixel: center,
  population: 50,
  cultureMix: world.cultureTable.single(culture.id, 100),
  religionMix: 0,
  humanOriginMix: world.humanOriginTable.single(0, 100),
}];
const city = world.addCity(settled.id, center, 2, true);
const laterCity = world.addCity(settled.id, patch[1], 2);
assert.ok(city);
assert.ok(laterCity);
const game = new Game(world, 'observer');
game.renderer.flush();
const packed = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
};
const blend = (base, overlay, share) => {
  const a = hexToRgb(base);
  const b = hexToRgb(overlay);
  const mixed = a.map((channel, i) => Math.round(channel + (b[i] - channel) * share));
  return ((255 << 24) | (mixed[2] << 16) | (mixed[1] << 8) | mixed[0]) >>> 0;
};
const stripePixel = center;
game.setMapMode('political');
game.renderer.flush();
assert.equal(game.renderer.pixels[stripePixel], blend(settled.color, nomad.color, 0.48),
  'unselected nomadic land uses a translucent hatch over the settled political fill');
game.showCountryOnMap(nomad.id);
assert.equal(game.getSnapshot().mapMode, 'political', 'selecting a nomadic country uses political mode');
assert.equal(game.getSnapshot().selectedCountryId, nomad.id);
game.renderer.flush();
assert.equal(game.renderer.pixels[center], packed(nomad.color), 'the selected nomadic country is drawn solid on top');
game.showCountryOnMap(nomad.id);
assert.equal(game.getSnapshot().selectedCountryId, null, 'selecting the same country again removes the selection');
game.showCountryOnMap(settled.id);
assert.equal(game.getSnapshot().selectedCountryId, settled.id);
game.renderer.flush();
assert.equal(game.renderer.pixels[center], packed(settled.color), 'the selected settled country is drawn solid on top');
game.setMapMode('cultures');
assert.equal(game.getSnapshot().selectedCountryId, null, 'changing map mode removes the country selection');

game.showLayer({ kind: 'culture', id: culture.id });
assert.equal(game.getSnapshot().mapMode, 'cultures');
assert.equal(game.getSnapshot().layer?.kind, 'culture');
game.showLayer(null);
assert.equal(game.getSnapshot().layer, null, 'the active culture layer can be cleared');
game.selectCity(city.id);
assert.equal(game.getSnapshot().mapMode, 'cities');
assert.equal(game.getSnapshot().selectedCityId, city.id);
assert.ok(cityInfluenceRadius(world, city) > 0, 'the selected city sphere uses its existing calculated radius');
game.selectCity(city.id);
assert.equal(game.getSnapshot().selectedCityId, null, 'the selected city can be deselected');
game.setMapMode('political');
assert.equal(game.getSnapshot().selectedCityId, null, 'changing map mode clears city selection');
game.selectCity(laterCity.id);
world.removeCity(city.id);
game.setMapMode('cities');
assert.equal(game.getSnapshot().selectedCityId, laterCity.id, 'the selected city stays selected if an earlier city is removed');
game.selectCity(laterCity.id);
assert.equal(game.getSnapshot().selectedCityId, null, 'selection still clears after city ids shift');

console.log('Unified entity rows, map selections, nomadic overlays, and city influence checks passed.');
