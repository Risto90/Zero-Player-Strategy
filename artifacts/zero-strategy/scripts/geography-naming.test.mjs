import assert from 'node:assert/strict';
import { drawCountryCard, setCardDrawTraceListener } from '../game/cards.ts';
import { World } from '../game/world.ts';

const world = World.create('random', 199_001);
const [insideRiverPixel, insidePeakPixel, outsidePixel] = Array.from(world.landIndex.slice(0, 3));
const culture = world.newCulture(null, 1000);
const country = world.newCountry({
  rank: 'test',
  cultureId: culture.id,
  religionId: null,
  density: 10,
  foundedYear: 1000,
  parentId: null,
});
const neighbor = world.newCountry({
  rank: 'test',
  cultureId: culture.id,
  religionId: null,
  density: 10,
  foundedYear: 1000,
  parentId: null,
});

world.setOwner(insideRiverPixel, country.id + 1);
world.setOwner(insidePeakPixel, country.id + 1);
world.setOwner(outsidePixel, neighbor.id + 1);

world.riverFeatures = [
  { id: 901, scaleRank: 2, paths: [], pixels: [insideRiverPixel], name: null, discoveredBy: [country.id] },
  { id: 902, scaleRank: 2, paths: [], pixels: [outsidePixel], name: null, discoveredBy: [country.id] },
];
world.peaks = [
  { id: 801, pixel: insidePeakPixel, elevation: 1200, name: null, discoveredBy: [country.id] },
  { id: 802, pixel: outsidePixel, elevation: 900, name: null, discoveredBy: [country.id] },
];
world.volcanoes = [
  { id: 701, pixel: outsidePixel, elevation: 2400, name: null, active: false, discoveredBy: [country.id] },
];

const targetIds = () => world.unnamedGeographyForCountry(country.id).map(({ id }) => id).sort((a, b) => a - b);
assert.deepEqual(targetIds(), [801, 901],
  'a settled country can name only discovered features on its currently owned pixels');

const traces = [];
setCardDrawTraceListener((event) => traces.push(event));
try {
  drawCountryCard(world, country, 1000);
  const nameOption = traces.at(-1).choices.find(({ key }) => key === 'nameGeography');
  assert.equal(nameOption?.programmedWeight, 2,
    'the naming-card weight equals the number of eligible unnamed features on current territory');

  world.setOwner(insidePeakPixel, neighbor.id + 1);
  assert.deepEqual(targetIds(), [901], 'losing a point immediately removes its features from naming eligibility');
  drawCountryCard(world, country, 1001);
  assert.equal(traces.at(-1).choices.find(({ key }) => key === 'nameGeography')?.programmedWeight, 1,
    'the cached naming-card weight updates after territory changes');

  world.setOwner(insideRiverPixel, neighbor.id + 1);
  assert.deepEqual(targetIds(), [], 'a country with no feature on its territory has no naming candidates');
  drawCountryCard(world, country, 1002);
  assert.equal(traces.at(-1).choices.some(({ key }) => key === 'nameGeography'), false,
    'the naming card is not drawn when no eligible geography remains');
} finally {
  setCardDrawTraceListener(null);
}

const nomad = world.newCountry({
  rank: 'test',
  cultureId: culture.id,
  religionId: null,
  density: 10,
  foundedYear: 1000,
  parentId: null,
});
nomad.type = 'nomadic';
nomad.range = [outsidePixel];
world.markNomadicRangeExpanded();
world.riverFeatures[1].discoveredBy.push(nomad.id);
world.peaks[1].discoveredBy.push(nomad.id);
world.volcanoes[0].discoveredBy.push(nomad.id);
assert.deepEqual(
  world.unnamedGeographyForCountry(nomad.id).map(({ id }) => id).sort((a, b) => a - b),
  [701, 802, 902],
  'a nomadic country can name only discovered features inside its current range',
);

console.log('Проверено именование географии только на текущей территории страны.');
