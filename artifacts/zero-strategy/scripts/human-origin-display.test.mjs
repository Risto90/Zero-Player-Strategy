import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Game } from '../game/game.ts';
import { MAP_WIDTH } from '../game/config.ts';
import { HUMAN_ORIGINS, HUMAN_ORIGIN_COLORS, humanOriginIndex, humanOriginShares } from '../game/human.ts';
import { MapRenderer, hexToRgb } from '../game/render.ts';
import { cityComposition } from '../game/settlements.ts';
import { World } from '../game/world.ts';
import { createPerson } from '../game/government.ts';
import { hasMapObjectList } from '../game/mapModeCapabilities.ts';
import { raceProfileRoute } from '../game/profileRoutes.ts';

const root = resolve(process.cwd());
const world = World.create('random', 15501);
const culture = world.newCulture(null, 1000);
const country = world.newCountry({
  rank: 'тест',
  cultureId: culture.id,
  religionId: null,
  density: 80,
  foundedYear: 1000,
  parentId: null,
});

const hasLandNeighbours = (pixel) => {
  const x = pixel % MAP_WIDTH;
  return x > 0 && x < MAP_WIDTH - 1 &&
    world.land[pixel - 1] && world.land[pixel + 1] &&
    world.land[pixel - MAP_WIDTH] && world.land[pixel + MAP_WIDTH] &&
    world.rivers[pixel] === 0;
};
const cityPixel = world.landIndex.find(hasLandNeighbours);
const ruralPixel = world.landIndex.find((pixel) => pixel !== cityPixel && hasLandNeighbours(pixel));
assert.ok(cityPixel !== undefined && ruralPixel !== undefined, 'fixture includes interior points');

for (const pixel of [cityPixel, cityPixel - 1, cityPixel + 1, cityPixel - MAP_WIDTH, cityPixel + MAP_WIDTH, ruralPixel]) {
  world.setOwner(pixel, country.id + 1);
}
world.density[cityPixel] = 100;
world.density[ruralPixel] = 100;
world.culture[cityPixel] = world.cultureTable.single(culture.id, 100);
world.culture[ruralPixel] = world.cultureTable.single(culture.id, 100);
const europeanMix = world.humanOriginTable.single(humanOriginIndex('european'), 100);
const pygmyMix = world.humanOriginTable.intern(new Map([
  [humanOriginIndex('european'), 25],
  [humanOriginIndex('pygmy'), 75],
]));
world.humanOrigins[cityPixel] = world.humanOriginTable.intern(new Map([
  [humanOriginIndex('european'), 75],
  [humanOriginIndex('pygmy'), 25],
]));
world.humanOrigins[ruralPixel] = europeanMix;

const city = world.addCity(country.id, cityPixel, 1, true);
city.population = 100;
city.populationGroups = [{ cultureId: culture.id, religionId: null, population: 100, humanOriginMix: pygmyMix }];
world.recountCountries();

const nomad = world.newCountry({
  rank: 'кочевье',
  cultureId: culture.id,
  religionId: null,
  density: 0,
  foundedYear: 1000,
  parentId: null,
});
nomad.type = 'nomadic';
nomad.range = [ruralPixel];
nomad.cells = [{
  pixel: ruralPixel,
  population: 300,
  cultureMix: world.cultureTable.single(culture.id, 100),
  religionMix: 0,
  humanOriginMix: world.humanOriginTable.intern(new Map([
    [humanOriginIndex('european'), 25],
    [humanOriginIndex('bushman'), 75],
  ])),
}];

const game = new Game(world, 'observer');
const inspect = (pixel) => game.inspect(pixel % MAP_WIDTH, Math.floor(pixel / MAP_WIDTH));
const point = inspect(cityPixel);
assert.deepEqual(point.humanOrigins.map(({ id, share }) => [id, share]), [
  ['european', 75], ['pygmy', 25],
], 'point inspector keeps the selected raster mix, independent of city groups');
assert.equal(point.humanClimateSuitability !== null, true, 'populated points include the existing climate score');
assert.equal(inspect(cityPixel + 2).humanOrigins, null, 'empty owned land is distinct from a real 100% origin mix');
assert.deepEqual(humanOriginShares({ ids: ['european'], shares: [100] }).map(({ share }) => share), [100]);
assert.equal(humanOriginShares(null), null);
assert.equal(humanOriginShares({ ids: ['european', 'pygmy'], shares: [75, 20] }), null,
  'incomplete compositions are not presented as complete data');

const cityData = cityComposition(world, city);
assert.deepEqual(cityData.humanOrigins, { ids: ['european', 'pygmy'], shares: [25, 75] },
  'city composition comes from urban groups, not the raster');
const countryData = game.countryComposition(country.id);
assert.deepEqual(countryData.humanOrigins.map(({ id, share }) => [id, share]), [
  ['european', 75], ['pygmy', 25],
], 'country composition weights actual rural and urban residents');
const emptyCountry = world.newCountry({
  rank: 'пустая',
  cultureId: culture.id,
  religionId: null,
  density: 0,
  foundedYear: 1000,
  parentId: null,
});
assert.equal(game.countryComposition(emptyCountry.id).humanOrigins, null);
const person = createPerson(1000, 30);
person.humanOrigin = { ids: ['bushman', 'veddoid'], shares: [25, 75] };
assert.deepEqual(humanOriginShares(person.humanOrigin).map(({ id, share }) => [id, share]), [
  ['bushman', 25], ['veddoid', 75],
], 'person display uses that person’s own record');
person.humanOrigin = undefined;
assert.equal(humanOriginShares(person.humanOrigin), null, 'missing person records remain unknown');

const renderer = new MapRenderer(world);
renderer.setView('origins', null);
renderer.flush();
const packed = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
};
const packedShade = (hex, factor) => {
  const [r, g, b] = hexToRgb(hex).map((channel) => Math.round(channel * factor));
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
};
const packedBlend = (hex, share) => {
  const [r, g, b] = hexToRgb(hex).map((channel, index) =>
    Math.round([238, 233, 218][index] + (channel - [238, 233, 218][index]) * share));
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
};
const ruralHasCountryBorder = [
  ruralPixel - 1, ruralPixel + 1, ruralPixel - MAP_WIDTH, ruralPixel + MAP_WIDTH,
].some((pixel) => world.land[pixel] && world.owner[pixel] !== world.owner[ruralPixel]);
assert.equal(renderer.pixels[cityPixel], packed(HUMAN_ORIGIN_COLORS.pygmy),
  'the origin map chooses the city groups’ leading category');
assert.equal(renderer.pixels[ruralPixel], ruralHasCountryBorder
  ? packedShade(HUMAN_ORIGIN_COLORS.bushman, 0.7)
  : packed(HUMAN_ORIGIN_COLORS.bushman),
  'overlapping nomadic cohorts contribute their population-weighted origins');
renderer.setView('origins', { kind: 'origin', id: humanOriginIndex('pygmy') });
renderer.flush();
assert.equal(renderer.pixels[cityPixel], packedBlend(HUMAN_ORIGIN_COLORS.pygmy, 0.75),
  'selecting a race renders its mixed share as a dedicated map layer');
game.showLayer({ kind: 'origin', id: humanOriginIndex('pygmy') });
assert.equal(game.getSnapshot().mapMode, 'origins', 'race selection keeps the dedicated race map mode');
assert.equal(game.getSnapshot().layer?.kind, 'origin', 'race selection is recorded as an entity layer');

const modeTabs = readFileSync(resolve(root, 'components/game/ModeTabs.tsx'), 'utf8');
const legend = readFileSync(resolve(root, 'components/game/MapLegend.tsx'), 'utf8');
const legendPanel = readFileSync(resolve(root, 'components/game/LegendPanel.tsx'), 'utf8');
const inspectCard = readFileSync(resolve(root, 'components/game/InspectCard.tsx'), 'utf8');
const racePage = readFileSync(resolve(root, 'app/race/[id].tsx'), 'utf8');
const routeSource = readFileSync(resolve(root, 'game/profileRoutes.ts'), 'utf8');
const originComposition = readFileSync(resolve(root, 'components/profiles/OriginComposition.tsx'), 'utf8');
const profiles = [
  readFileSync(resolve(root, 'app/country/[id].tsx'), 'utf8'),
  readFileSync(resolve(root, 'app/city/[id].tsx'), 'utf8'),
  readFileSync(resolve(root, 'app/person/[id].tsx'), 'utf8'),
];
assert.match(modeTabs, /\{ id: 'origins', label: 'Расы' \}/u,
  'the shared mode picker exposes the new map mode on mobile and web');
assert.equal(hasMapObjectList('origins'), true, 'the races mode opens the standard object list');
assert.match(legendPanel, /mapMode === 'cultures' \|\| mapMode === 'religions' \|\| mapMode === 'origins'[\s\S]*?legend\.origins/u,
  'the standard list is built from the race categories currently present on the map');
assert.match(legendPanel, /function EntityRow/u,
  'races, cultures, religions, countries, and cities use the shared entity row');
assert.match(legendPanel, /titleName = .*'Расы'/u, 'the list is titled with the requested term');
assert.match(legendPanel, /isReligion \? 'веру' : 'расу'/u, 'the race list supports the same name search as culture and religion lists');
assert.match(legendPanel, /kind, id: row\.id/u,
  'selecting a race list row opens its map layer');
assert.match(legendPanel, /raceProfileRoute\(HUMAN_ORIGINS\[id\]\.id\)/u,
  'every present race row links to its profile');
assert.match(legendPanel, /showShare=\{false\}/u, 'city rows disable both the share percentage and diagram');
assert.match(legendPanel, /profileRouteForId=\{cityProfileRoute\}/u, 'city profiles use the separate profile button');
assert.match(legend, /origins: 'Расы'/u, 'the map mode uses the requested label');
const raceRows = game.getSnapshot().legend.origins;
assert.deepEqual(new Set(raceRows.map(({ id }) => id)), new Set([
  humanOriginIndex('bushman'), humanOriginIndex('european'), humanOriginIndex('pygmy'),
]), 'the list includes only races with real population on the map');
assert.ok(raceRows.every(({ value }) => value > 0), 'race rows never contain absent categories');
assert.deepEqual(raceRows.map(({ value }) => value), [...raceRows.map(({ value }) => value)].sort((a, b) => b - a),
  'race rows are sorted by population');
assert.deepEqual(raceProfileRoute('pygmy'), { pathname: '/race/[id]', params: { id: 'pygmy' } });
assert.match(routeSource, /export function raceProfileRoute/u);
assert.match(racePage, /КАРТОЧКА РАСЫ/u);
assert.match(racePage, /showChronicleTab=\{false\}/u);
assert.match(originComposition, /raceProfileRoute\(row\.id\)/u,
  'origin composition rows link to race profiles too');
assert.match(inspectCard, /inspect-human-origins/u);
assert.match(inspectCard, /Игровая агрегированная оценка/u);
assert.ok(profiles.every((source) => /OriginComposition/u.test(source)),
  'country, city, and character profiles render the shared composition');

console.log('Human-origin display, profiles, point inspector, and map rendering passed.');
